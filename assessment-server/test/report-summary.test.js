import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportSummary} from '../report-summary.js';
const row=(code,label='平均',score=50)=>({code,name:'合成'+code,label,score,mean:50,lower:30,upper:70});
const report=()=>({totals:['ST','PF','MH','RV'].map(code=>row(code)),dimensions:[row('ST1','较高',90),row('PF1','较低',10),row('MH1','平均'),row('RV1'),row('RV2'),row('RV3')]});
test('summary is deterministic, presentation-only and uses current real labels',()=>{
 const r=report(),before=JSON.stringify(r),summary=createReportSummary(r);
 assert.deepEqual(summary,createReportSummary(r));assert.equal(JSON.stringify(r),before);
 assert.deepEqual(summary.cards.map(v=>v.code),['ST','PF','MH']);
 assert.match(summary.overview,/合成ST1较高、合成PF1较低/);
 assert.doesNotMatch(summary.overview,/90|10|50/,'scores are shown in the cards, not repeated in summary');
 assert.match(summary.overview,/不能视为真实性保证/);
});
test('MH direction is more reported distress at high scores, never a diagnosis or ability inference',()=>{
 for(const label of ['较高','稍高','平均','稍低','较低']){
  const r=report();r.totals.find(v=>v.code==='MH').label=label;
  const text=createReportSummary(r).cards.find(v=>v.code==='MH').interpretation;
  if(['较高','稍高'].includes(label)){assert.match(text,/较多反映主观困扰/);assert.match(text,/不据此作疾病或资格判断/);}
  else if(['较低','稍低'].includes(label)){assert.match(text,/较少提及/);assert.match(text,/不能据此推断/);}
  else assert.match(text,/中间范围/);
 }
});
test('quality cautions respond to aggregate, process, self-idealization and missing evidence',()=>{
 const low=report();low.totals.find(v=>v.code==='RV').label='较低';assert.match(createReportSummary(low).overview,/宜先核对题意理解和答题过程/);
 const process=report();process.dimensions.find(v=>v.code==='RV3').label='稍低';assert.match(createReportSummary(process).overview,/宜先核对题意理解和答题过程/);
 const ideal=report();ideal.dimensions.find(v=>v.code==='RV1').label='稍高';assert.match(createReportSummary(ideal).overview,/自我描述偏理想化/);
 const missing=report();missing.totals.find(v=>v.code==='RV').score=null;assert.match(createReportSummary(missing).overview,/作答质量信息不完整/);
});
test('missing scores, labels or dimensions request source checks, and personal free text is never summarized',()=>{
 const r=report();r.totals[0].score=null;r.totals[1].label='无参照';r.family=[{answer:{other:'NEVER_INCLUDE_PRIVATE_TEXT'}}];r.dimensions=[];
 const s=createReportSummary(r);assert.match(s.cards[0].interpretation,/暂无法完整重算/);assert.match(s.cards[1].interpretation,/暂无法完整重算/);
 assert.match(s.overview,/部分综合指标暂缺完整结果/);assert.match(s.overview,/分项数据不足/);assert.doesNotMatch(JSON.stringify(s),/NEVER_INCLUDE_PRIVATE_TEXT/);
 assert.doesNotThrow(()=>createReportSummary({}));
});
