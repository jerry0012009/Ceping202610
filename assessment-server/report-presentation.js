import {createReportSummary} from './report-summary.js';
import {resolveEmploymentAnswers} from './employment-answers.js';
import {resolveWorkValuePreferences} from './work-value-model.js';
import {rolePFTotal} from './pf-role-model.js';
import {getVersion} from './version-registry.js';
const classify=(score,r)=>!Number.isFinite(score)?'无参照':score<r.lower?'较低':score<(r.lower+r.mean)/2?'稍低':score<=(r.mean+r.upper)/2?'平均':score<=r.upper?'稍高':'较高';
// Sanitize report responses. Historical routes recalculate current scores from immutable answers before this projection. The stored snapshot is never modified.
const stripPrivate=value=>Array.isArray(value)?value.map(stripPrivate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['internalEvidence','example','examples','representativeAnswers'].includes(key)).map(([key,item])=>[key,stripPrivate(item)])):value;
export function presentReport(snapshot,context={}){
 snapshot=stripPrivate(snapshot);
 const entry=getVersion(snapshot.version,context.fingerprint);
 if(!entry||(context.version!==undefined&&context.version!==snapshot.version))throw Object.assign(new Error('报告版本或校验标识不匹配，未使用其他版本重新解读。'),{status:422});
 const {presentation,pfModel}=entry,{id:pfModelId,referenceId:pfReferenceId,roleTitle:pfRoleTitle,reference:pfReference}=pfModel,workValueParts=entry.workValueModel.parts;
 let report=snapshot;
 const values=resolveWorkValuePreferences(snapshot,context);
 if(snapshot.pfModelId!==pfModelId){
  const dimensions=Object.fromEntries((snapshot.dimensions||[]).filter(v=>/^PF[1-7]$/.test(v.code)).map(v=>[v.code,v]));
  if(Array.from({length:7},(_,i)=>'PF'+(i+1)).every(code=>Number.isFinite(dimensions[code]?.score)&&Number.isFinite(dimensions[code]?.raw))){
   const totals=rolePFTotal({raw:Object.fromEntries(Object.entries(dimensions).map(([code,v])=>[code,v.raw])),reference:Object.fromEntries(Object.entries(dimensions).map(([code,v])=>[code,v.score]))},entry.version);
   report={...snapshot,pfModelId,pfReferenceId,pfRoleTitle,storedPFModelId:snapshot.storedPFModelId||snapshot.pfModelId||'legacy-general-v'+entry.version,viewPFModelId:pfModelId,pfReinterpretationNotice:'职业性格匹配度按当前岗位权重重新汇总；原始记录保留。',totals:(snapshot.totals||[]).map(v=>v.code==='PF'?{...v,raw:totals.raw,score:totals.reference,...pfReference,label:classify(totals.reference,pfReference)}:v)};
  }
 }
 const valueRows=values?workValueParts.map(({code,name,reference})=>{const source=values.scores.find(row=>row.code===code);return {...source,name,...reference,label:classify(source.score,reference)};}):[];
 const viewDimensions=(report.dimensions||[]).filter(row=>row.code!=='ST3'&&!row.code?.startsWith('WV_'));
 const insertAt=viewDimensions.findIndex(row=>row.code==='ST2');viewDimensions.splice(insertAt<0?0:insertAt+1,0,...valueRows);
 const row=value=>{const {example,...rest}=value;const copy={...rest,...(presentation.metrics[value.code]||{})};
  const referenceOverride=presentation.referenceOverrides?.[value.code];if(referenceOverride){Object.assign(copy,referenceOverride);copy.label=classify(copy.score,copy);}
  if(value.code==='PF'){
   if(report.pfModelId===pfModelId){copy.name=presentation.metrics.PF?.name||'职业性格匹配度';copy.modelNote=report.pfReinterpretationNotice?'建筑工地外派管理岗 · 按当前岗位重新解读':'建筑工地外派管理岗 · 当前岗位计分';}
   else{copy.name='职业性格综合分';copy.modelNote='历史计分：缺少完整分维度得分，无法按当前岗位权重重新汇总';copy.definition='保留历史版本的职业性格综合得分，不是当前建筑工地岗位的匹配分。';copy.highMeaning='历史计分规则下的性格组合较突出。';copy.lowMeaning='历史计分规则下的性格组合较弱或工作方式不同，不表示不能胜任工作。';copy.limitation='原得分与原参考区间保持不变。';}
  }
  if(value.code==='MH')copy.name=presentation.metrics.MH?.name||'心理问题倾向';
  if(value.code==='RV'&&presentation.rvReference&&[value.mean,value.lower,value.upper].some(v=>!Number.isFinite(v))){Object.assign(copy,presentation.rvReference,{label:classify(value.score,presentation.rvReference),referenceNote:'作答质量总分参考区间为本次新增的模拟参照，未重算本次得分。'});}
  if(value.unavailableReason){copy.score=null;copy.raw=null;copy.label='无法重算';}
  return copy;
 };
 const displayed={...report,employmentAnswers:resolveEmploymentAnswers(snapshot,context),workValuePreferences:values,workValueNotice:values?'三项为独立得分，不是百分比，不相加为100；高低仅表示相对侧重，不代表优劣或留任保证。':'',workValueDerivationNotice:values?.source==='archived-answers'?'工作价值观三项根据本次原始作答补充展示，原始记录保留。':'',workValueUnavailable:values?'':'本记录缺少可兼容的完整作答，暂无法展示工作价值观分项。',reportRevision:presentation.revision,referenceRevision:presentation.referenceRevision,referenceDescription:presentation.referenceDescription,disclaimer:presentation.referenceDescription||report.disclaimer,storedPFModelId:report.storedPFModelId||snapshot.pfModelId||'legacy-general-v'+entry.version,viewPFModelId:report.pfModelId||'legacy-general-v'+entry.version,interpretationNotes:(presentation.notes||[]).filter(note=>report.pfModelId===pfModelId||!/^职业性格(?:匹配度|总分)为建筑工地/.test(note)),referenceLabel:presentation.referenceLabel||'模拟参照',totals:(report.totals||[]).map(row),dimensions:viewDimensions.map(row)};
 displayed.reportSummary=createReportSummary(displayed);
 return displayed;
}
