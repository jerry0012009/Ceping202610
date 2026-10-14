import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateReport} from '../scoring.js';
import {createReportSummary,selectReportFeatures,TOTAL_EXPLANATIONS,DIMENSION_EXPLANATIONS} from '../report-summary.js';

const labels=['较低','稍低','平均','稍高','较高'];
const groups=[['ST1','ST2','WV_STABILITY','WV_GROWTH','WV_REWARD'],['PF1','PF2','PF3','PF4','PF5','PF6','PF7','SJ1','SJ2','SJ3'],['MH1','MH2','MH3','MH4','MH5','MH6']];
const codes=[...groups.flat(),'RV1','RV2','RV3'];
const row=(code,label='平均',score=50,extra={})=>({code,name:'合成维度'+code+'项目',label,score,mean:50,lower:30,upper:70,...extra});
const totalNames={ST:'职业稳定性',PF:'职业性格',MH:'心理困扰倾向',RV:'作答质量'};
const report=()=>({totals:['ST','PF','MH','RV'].map(code=>row(code,'平均',50,{name:totalNames[code]})),dimensions:codes.map(code=>row(code))});
const setDimension=(r,code,label,score,extra={})=>Object.assign(r.dimensions.find(value=>value.code===code),{label,score,...extra});
const setTotal=(r,code,label,score)=>Object.assign(r.totals.find(value=>value.code===code),{label,score});
const length=value=>Array.from(value).length;
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;};
const includes=(text,expected,description)=>assert.ok(text.includes(expected),description+': '+expected+'\nActual: '+text);
const concreteMeaning=text=>text.split(/，(?:不等于|不代表|不证明|不表示)/)[0];
const assertOverviewStyle=(r,text)=>{
 const paragraphs=text.trim().split(/\n\s*\n/);
 assert.equal(paragraphs.length,3,'ST, PF and MH each form one natural paragraph');
 const names=['职业稳定性','职业性格','心理困扰倾向'];
 for(const [index,code]of ['ST','PF','MH'].entries()){
  const total=r.totals.find(value=>value.code===code);
  assert.ok(paragraphs[index].startsWith((index===0?'该被试':'')+names[index]+total.label),code+' paragraph opens directly with its actual band: '+paragraphs[index]);
 }
 assert.doesNotMatch(text,/综合分包含|分开理解|分项帮助说明|临床诊断|不作诊断|资格判断|资格结论|能力证明|真实性保证|内容必然真实|工作能力|抗压能力/);
};

test('all three totals have five distinct, nonempty band explanations and use the exact band',()=>{
 assert.deepEqual(Object.keys(TOTAL_EXPLANATIONS).sort(),['MH','PF','ST']);
 const all=[];
 for(const code of ['ST','PF','MH']){
  assert.deepEqual(Object.keys(TOTAL_EXPLANATIONS[code]).sort(),[...labels].sort());
  for(const label of labels){
   const explanation=TOTAL_EXPLANATIONS[code][label];assert.equal(typeof explanation,'string');assert.ok(explanation.trim());all.push(explanation);
   const r=report();setTotal(r,code,label,labels.indexOf(label)*20+10);
   assert.equal(createReportSummary(r).cards.find(card=>card.code===code).interpretation,explanation);
  }
 }
 assert.equal(new Set(all).size,15,'neighboring bands cannot silently reuse the same explanation');
});

test('all 24 dimensions have distinct high/low meanings; selected traits retain their names and meanings',()=>{
 assert.deepEqual(Object.keys(DIMENSION_EXPLANATIONS).sort(),[...codes].sort());
 for(const code of codes){
  const meanings=DIMENSION_EXPLANATIONS[code];
  for(const direction of ['high','low']){assert.equal(typeof meanings[direction],'string',code+'.'+direction);assert.ok(meanings[direction].trim(),code+'.'+direction);}
  assert.notEqual(meanings.high,meanings.low,code+' directions differ');
  if(code.startsWith('RV'))continue;
  for(const [direction,label,score]of [['high','较高',90],['low','较低',10]]){
   const r=report();setDimension(r,code,label,score);const text=createReportSummary(r).overview;
   includes(text,r.dimensions.find(value=>value.code===code).name,code+' name accompanies selected feature');
   includes(text,concreteMeaning(meanings[direction]),code+' concrete meaning accompanies selected direction');
  }
 }
});

test('feature ranking uses reference width rather than raw score distance, with deterministic ties',()=>{
 for(const [label,aScore,bScore]of [['较高',80,65],['较低',20,35]]){
  const r=report();
  setDimension(r,'ST1',label,aScore,{lower:5,upper:95}); // raw deviation 30; standardized deviation smaller
  setDimension(r,'ST2',label,bScore,{lower:45,upper:55}); // raw deviation 15; standardized deviation larger
  const text=createReportSummary(r).overview;
  includes(text,r.dimensions.find(value=>value.code==='ST2').name,'stronger relative deviation is selected');
  assert.ok(!text.includes(r.dimensions.find(value=>value.code==='ST1').name),'larger raw distance alone cannot win');
  assert.deepEqual(createReportSummary(r),createReportSummary(structuredClone(r)));
 }
 const tied=report();setDimension(tied,'ST1','较高',90);setDimension(tied,'ST2','较高',90);
 const before=createReportSummary(tied);tied.dimensions.reverse();assert.deepEqual(createReportSummary(tied),before,'equally strong features have an order-independent tie break');
});

test('at most one salient trait per domain and three in total are summarized',()=>{
 const r=report();for(const code of groups.flat())setDimension(r,code,'较高',90);
 const text=createReportSummary(r).overview;
 for(const group of groups){const selected=group.filter(code=>text.includes(r.dimensions.find(value=>value.code===code).name));assert.equal(selected.length,1,group.join('/')+' contributes one trait');}
 const selected=r.dimensions.filter(value=>text.includes(value.name));assert.equal(selected.length,3);
});

test('normalized feature evidence uses the appropriate reference half and excludes invalid intervals',()=>{
 const r=report();
 setDimension(r,'ST1','较高',80,{lower:40,upper:90});
 setDimension(r,'PF1','较低',30,{lower:40,upper:90});
 const features=selectReportFeatures(r);
 assert.equal(features.find(value=>value.code==='ST1').deviation,30/40);
 assert.equal(features.find(value=>value.code==='PF1').deviation,20/10);
 assert.deepEqual(features.map(value=>value.direction),['high','low']);
 for(const bounds of [{lower:50,upper:70},{lower:30,upper:50},{lower:null,upper:70},{lower:30,upper:Number.NaN},{lower:80,upper:20}]){
  const invalid=report();setDimension(invalid,'ST1','较高',90,bounds);
  assert.equal(selectReportFeatures(invalid).some(value=>value.code==='ST1'),false,'invalid reference interval is not evidence of salience');
 }
});

test('average totals do not hide divergent dimensions or call the profile balanced',()=>{
 const r=report();setDimension(r,'PF1','较高',90);setDimension(r,'PF2','较低',10);
 const summary=createReportSummary(r),text=summary.overview;
 assert.match(text,/差异|不同|不一|高低|分化|突出|特点/);
 assert.doesNotMatch(text,/均衡|全面平均|各项平均|各项一致/);
 assert.ok(['PF1','PF2'].some(code=>text.includes(r.dimensions.find(value=>value.code===code).name)));
 assert.equal(summary.cards.find(card=>card.code==='PF').interpretation,TOTAL_EXPLANATIONS.PF['平均']);
});

test('low reported distress with high self-idealization is cautiously grounded in actual experience',()=>{
 const r=report();setTotal(r,'MH','较低',10);setTotal(r,'RV','较高',90);setDimension(r,'RV1','较高',90);
 const summary=createReportSummary(r),text=summary.cards.find(card=>card.code==='MH').interpretation+summary.overview;
 assert.match(text,/较少|较低|不多|少提及/);
 assert.match(text,/理想化|自我呈现|正面呈现|积极呈现/);
 assert.match(text,/具体经历|实际体验|近期体验|实际经历|真实体验/);
 assert.doesNotMatch(text,/隐瞒疾病|隐藏疾病|潜在疾病|隐性疾病|隐藏心理问题|没有心理问题|心理完全健康|抗压能力强|胜任能力强/);
});

test('low or missing process evidence limits confidence even when aggregate quality is high',()=>{
 for(const code of ['RV2','RV3'])for(const mode of ['较低','稍低','missing']){
  const r=report();setTotal(r,'RV','较高',90);setDimension(r,'RV1','较高',90);
  if(mode==='missing')r.dimensions=r.dimensions.filter(value=>value.code!==code);else setDimension(r,code,mode,10);
  const text=createReportSummary(r).overview;
  assert.match(text,/先|优先|暂|谨慎|限制|有限|不足|影响/);
  assert.match(text,/核对|核实|补充|复核|澄清/);
  assert.match(text,/题意|答题过程|作答过程|信息不完整|信息不足|资料不足|完整/);
  assert.doesNotMatch(text,/作答质量未见明显偏低|无需核实|内容必然真实|结果完全可靠/);
  assert.ok(text.startsWith('该被试职业稳定性平均'),'quality concerns do not replace the direct domain opening');
  const last=text.trim().split(/[。！？]/).filter(Boolean).at(-1);
  assert.match(last,/有限|不足|不完整|核对|核实|澄清|谨慎|结合|影响/,'specific quality impact is placed at the end');
 }
});

test('overview uses three direct domain paragraphs with actual bands and no normal-quality boilerplate',()=>{
 for(const label of labels){
  const r=report();for(const code of ['ST','PF','MH'])setTotal(r,code,label,labels.indexOf(label)*20+10);
  const text=createReportSummary(r).overview;assertOverviewStyle(r,text);
  assert.doesNotMatch(text,/作答质量|回答协调性|作答节奏|真实性|真实保证|未见突出疑点/);
  assert.doesNotMatch(text,/\d/,'numeric scores stay out of the prose overview');
 }
});

test('missing totals or dimensions never invent a direction and omit unusable selected features',()=>{
 const r=report();setTotal(r,'ST','较高',null);setTotal(r,'PF','无参照',50);
 setDimension(r,'ST1','较高',null);setDimension(r,'ST2','无参照',90);setDimension(r,'PF1','较低',Number.NaN);
 const summary=createReportSummary(r);
 for(const code of ['ST','PF'])assert.match(summary.cards.find(card=>card.code===code).interpretation,/暂|不足|缺|核对|补充/);
 for(const code of ['ST1','ST2','PF1'])assert.ok(!summary.overview.includes(r.dimensions.find(value=>value.code===code).name),code+' invalid direction cannot be selected');
 const empty=createReportSummary({});assert.deepEqual(empty.cards.map(card=>card.code),['ST','PF','MH']);
 assert.match(empty.overview,/不足|缺|补充|核对/);
 for(const card of empty.cards)assert.match(card.interpretation,/暂|不足|缺|核对|补充/);
 assert.doesNotMatch(JSON.stringify(empty),/本次.*(?:较高|稍高|稍低|较低)/);
});

test('summary is deterministic, never mutates inputs, and never includes raw personal free text',()=>{
 const r=report();setDimension(r,'ST1','较高',90);r.family=[{answer:{other:'NEVER_INCLUDE_PRIVATE_FAMILY_TEXT'}}];r.employmentAnswers={note:'NEVER_INCLUDE_PRIVATE_EMPLOYMENT_TEXT'};
 const before=JSON.stringify(r);deepFreeze(r);
 const summary=createReportSummary(r);assert.deepEqual(summary,createReportSummary(r));assert.equal(JSON.stringify(r),before);
 assert.doesNotMatch(JSON.stringify(summary),/NEVER_INCLUDE_PRIVATE|90|50/);
});

test('all 40 synthetic reports produce stable, bounded summaries without changing scores',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.11-40.json',import.meta.url))).rows;
 assert.equal(fixtures.length,40);
 for(const fixture of fixtures){
  const r=calculateReport(fixture.answers,fixture.seconds),before=JSON.stringify(r),summary=createReportSummary(r);
  assert.deepEqual(summary,createReportSummary(structuredClone(r)));assert.equal(JSON.stringify(r),before);
  assert.deepEqual(summary.cards.map(card=>card.code),['ST','PF','MH']);
  assertOverviewStyle(r,summary.overview);
  assert.doesNotMatch(summary.overview,/\d/,'the overview does not repeat numerical scores');
  const characters=length(summary.overview.replace(/\s/g,''));
  assert.ok(characters<=280,`overview length ${characters} exceeds 280: ${summary.overview}`);
  assert.ok(summary.overview.trim());for(const card of summary.cards)assert.ok(card.interpretation.trim());
 }
});
