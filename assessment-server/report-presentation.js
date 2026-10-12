import {pfModelId,pfReferenceId,pfRoleTitle,pfReference,rolePFTotal} from './pf-role-model.js';
import presentation from './private/report-presentation.json' with {type:'json'};
const classify=(score,r)=>!Number.isFinite(score)?'无参照':score<r.lower?'较低':score<(r.lower+r.mean)/2?'稍低':score<=(r.mean+r.upper)/2?'平均':score<=r.upper?'稍高':'较高';
// Response projection only: the stored snapshot is never modified or rescored from answers.
const stripPrivate=value=>Array.isArray(value)?value.map(stripPrivate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['internalEvidence','example','examples','representativeAnswers'].includes(key)).map(([key,item])=>[key,stripPrivate(item)])):value;
export function presentReport(snapshot){
 snapshot=stripPrivate(snapshot);
 let report=snapshot;
 if(snapshot.pfModelId!==pfModelId){
  const dimensions=Object.fromEntries((snapshot.dimensions||[]).filter(v=>/^PF[1-7]$/.test(v.code)).map(v=>[v.code,v]));
  if(Array.from({length:7},(_,i)=>'PF'+(i+1)).every(code=>Number.isFinite(dimensions[code]?.score)&&Number.isFinite(dimensions[code]?.raw))){
   const totals=rolePFTotal({raw:Object.fromEntries(Object.entries(dimensions).map(([code,v])=>[code,v.raw])),reference:Object.fromEntries(Object.entries(dimensions).map(([code,v])=>[code,v.score]))});
   report={...snapshot,pfModelId,pfReferenceId,pfRoleTitle,storedPFModelId:snapshot.storedPFModelId||snapshot.pfModelId||'legacy-general-v2.9',viewPFModelId:pfModelId,pfReinterpretationNotice:'职业性格匹配度按当前岗位权重重新汇总；原始记录保留。',totals:(snapshot.totals||[]).map(v=>v.code==='PF'?{...v,raw:totals.raw,score:totals.reference,...pfReference,label:classify(totals.reference,pfReference)}:v)};
  }
 }
 const row=value=>{const {example,...rest}=value;const copy={...rest,...(presentation.metrics[value.code]||{})};
  if(value.code==='PF'){
   if(report.pfModelId===pfModelId){copy.name='职业性格匹配度';copy.modelNote=report.pfReinterpretationNotice?'建筑工地外派管理岗 · 按当前岗位重新解读':'建筑工地外派管理岗 · 当前岗位计分';}
   else{copy.name='职业性格综合分';copy.modelNote='历史计分：缺少完整分维度得分，无法按当前岗位权重重新汇总';copy.definition='保留历史版本的职业性格综合得分，不是当前建筑工地岗位的匹配分。';copy.highMeaning='历史计分规则下的性格组合较突出。';copy.lowMeaning='历史计分规则下的性格组合较弱或工作方式不同，不表示不能胜任工作。';copy.limitation='原得分与原参考区间保持不变。';}
  }
  if(value.code==='MH')copy.name='心理问题倾向';
  if(value.code==='RV'&&presentation.rvReference&&[value.mean,value.lower,value.upper].some(v=>!Number.isFinite(v))){Object.assign(copy,presentation.rvReference,{label:classify(value.score,presentation.rvReference),referenceNote:'作答质量总分参考区间为本次新增的模拟参照，未重算本次得分。'});}
  return copy;
 };
 return {...report,reportRevision:presentation.revision,storedPFModelId:report.storedPFModelId||snapshot.pfModelId||'legacy-general-v2.9',viewPFModelId:report.pfModelId||'legacy-general-v2.9',interpretationNotes:(presentation.notes||[]).filter(note=>report.pfModelId===pfModelId||!note.startsWith('职业性格匹配度为建筑工地')),referenceLabel:presentation.referenceLabel||'模拟参照',totals:(report.totals||[]).map(row),dimensions:(report.dimensions||[]).map(row)};
}
