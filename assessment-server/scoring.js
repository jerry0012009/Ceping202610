import {createWorkValuePreferences} from './work-value-model.js';
import {rolePFTotal,pfModelId,pfReferenceId,pfRoleTitle,pfReference} from './pf-role-model.js';
import {presentReport} from './report-presentation.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import engineModule from './private/engine-v2.9.cjs';
const bytes=fs.readFileSync(new URL('./private/questionnaire-v2.9.json',import.meta.url));
export const data=JSON.parse(bytes);
export const scoringVersion='2.9';
export const fingerprint=crypto.createHash('sha256').update(bytes).update(fs.readFileSync(new URL('./private/engine-v2.9.cjs',import.meta.url))).digest('hex');
export const engine=engineModule.create(data);
export const questionnaire={version:scoringVersion,total:data.total,familyTotal:data.familyTotal,names:data.names,groups:data.groups,questions:data.questions.map(({id,number,stem,text,options,instructions,type})=>({id,number,stem,text,options:options.map(({key,text})=>({key,text})),instructions,type}))};
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const allowed=(obj,keys)=>Object.keys(obj).every(k=>keys.includes(k));
export const pages=data.groups.flatMap(g=>Array.from({length:Math.ceil(g.ids.length/6)},(_,i)=>g.ids.slice(i*6,(i+1)*6)));
export function validateSubmission(body,partial=false){
 if(!isObject(body)||!allowed(body,['version','answers','seconds','submissionId']))throw new Error('提交结构不正确');
 if(body.version!==scoringVersion)throw new Error('测评版本不可用，请刷新后重新作答');
 if(typeof body.submissionId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.submissionId))throw new Error('提交标识不正确');
 if(!isObject(body.answers)||!isObject(body.seconds))throw new Error('答案或计时结构不正确');
 const ids=data.questions.map(q=>q.id);
 if(!allowed(body.answers,ids)||!allowed(body.seconds,ids))throw new Error('包含未知题目');
 for(const q of data.questions){
  const a=body.answers[q.id];
  if(partial&&a===undefined)continue;
  if(q.type==='family'){
   if(a===undefined)continue;
   if(!isObject(a)||Object.keys(a).length>12||!Object.entries(a).every(([k,v])=>/^[\w\u4e00-\u9fff-]{1,40}$/.test(k)&&typeof v==='string'&&v.length<=1000))throw new Error('选填信息格式不正确');
  }else{
   if(q.type==='tenure'&&(!isObject(a)||!allowed(a,['none','months','status'])||(a.none!==undefined&&typeof a.none!=='boolean')||(a.months!==undefined&&(!Array.isArray(a.months)||a.months.length!==3||a.months.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1200)))||(a.none!==true&&a.months===undefined)||(a.status!==undefined&&!['仍在职','已离职',''].includes(a.status))))throw new Error('工作月数不正确');
   if(q.type==='double'&&(!isObject(a)||!allowed(a,['most','least'])))throw new Error('双选格式不正确');
   if(!engine.complete(q,a))throw new Error(`请完成第${q.number}题`);
  }
 }
 for(const v of Object.values(body.seconds))if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>86400)throw new Error('计时数据不正确');
 // Every timed item must be explicit. Zero remains valid (client timing is not anti-cheat).
 for(const q of data.questions.filter(q=>q.cost>0&&(!partial||Object.hasOwn(body.answers,q.id))))if(!Object.hasOwn(body.seconds,q.id))throw new Error('计时数据不完整');
 return body;
}
export function calculateReportSnapshot(answers,seconds){
 const result=engine.calculate(answers,seconds),refs={...engine.defaults(),PF:pfReference};
 const reportTotals={...result.totals,PF:rolePFTotal(result)};
 function row(code,name,raw,score,coverage){
  const ref=refs[code]||{};let label='无参照';
  if(Number.isFinite(score)&&Number.isFinite(ref.lower)&&Number.isFinite(ref.upper))label=score<ref.lower?'较低':score<(ref.lower+ref.mean)/2?'稍低':score<=(ref.mean+ref.upper)/2?'平均':score<=ref.upper?'稍高':'较高';
  return {code,name,raw,score,mean:ref.mean??null,lower:ref.lower??null,upper:ref.upper??null,label,...(coverage?{coverage:{answered:coverage.answered,total:coverage.total}}:{})};
 }
 return {schemaVersion:1,workValuePreferences:createWorkValuePreferences(result,answers),pfModelId,pfReferenceId,pfRoleTitle,version:scoringVersion,answered:result.answered,total:result.total,
 totals:Object.entries(reportTotals).map(([c,v])=>row(c,({ST:'职业稳定性',PF:'职业性格',MH:'心理倾向线索',RV:'作答质量'})[c],v.raw,v.reference)),
 dimensions:Object.entries(result.reference).map(([c,v])=>row(c,data.names[c],result.raw[c],v,result.coverage[c])),facts:result.facts,
 family:data.questions.filter(q=>q.type==='family').map(q=>({id:q.id,number:q.number,stem:q.stem,answer:answers[q.id]??null})),
 salary:result.salary.map(v=>({id:v.id,number:v.number,stem:engine.byId[v.id].stem,answer:v.answer})),
 disclaimer:'参考区间基于模拟作答设定，非实测人群常模。',
 timingNotice:'作答时长由浏览器记录并经格式校验，无法证明真实作答时长；结果不具备防作弊保证。'};
}

export function calculateReport(answers,seconds){return presentReport(calculateReportSnapshot(answers,seconds));}
