import {getVersion,requireVersion,currentVersion} from './version-registry.js';
const current=requireVersion(),model=current.workValueModel;
export const workValueModelId=model.id,workValueReferenceId=model.referenceId;
export const workValueParts=model.parts;
export const workValueArchive={version:model.scoringVersion,fingerprint:model.scoringFingerprint};
const questionsFor=(entry,part)=>entry.data.questions.filter(q=>q.values?.[part]);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function createWorkValuePreferences(result,answers,source='completion',version=currentVersion){
 const entry=requireVersion(version),model=entry.workValueModel;
 return {modelId:model.id,referenceId:model.referenceId,scoringVersion:version,scoringFingerprint:entry.fingerprint,source,
  scores:model.parts.map(({code,part})=>{const questions=questionsFor(entry,part),value=result.valueParts[part].value;return {code,raw:value,score:value,coverage:{answered:questions.filter(q=>entry.engine.complete(q,answers[q.id])).length,total:questions.length}};})};
}
function validSaved(value,entry){
 const model=entry.workValueModel;
 return value?.modelId===model.id&&value.referenceId===model.referenceId&&value.scoringVersion===entry.version&&value.scoringFingerprint===entry.fingerprint&&['completion','archived-answers'].includes(value.source)&&Array.isArray(value.scores)&&value.scores.length===model.parts.length&&model.parts.every(({code,part})=>{
  const rows=value.scores.filter(row=>row.code===code),row=rows[0],total=questionsFor(entry,part).length;
  return rows.length===1&&(row.score===null||(Number.isFinite(row.score)&&row.score>=0&&row.score<=100))&&row.raw===row.score&&Number.isInteger(row.coverage?.answered)&&row.coverage.answered>=0&&row.coverage.answered<=total&&row.coverage.total===total;
 });
}
export function resolveWorkValuePreferences(snapshot,context={}){
 const entry=getVersion(snapshot.version,context.fingerprint);
 if(!entry||(context.version!==undefined&&context.version!==snapshot.version))return null;
 if(validSaved(snapshot.workValuePreferences,entry))return snapshot.workValuePreferences;
 // Historical answers are only interpreted by their own archived version AND fingerprint.
 if(context.version!==entry.version||context.fingerprint!==entry.fingerprint)return null;
 let answers=context.answers;
 if(answers===undefined&&typeof context.answersJson==='string'){try{answers=JSON.parse(context.answersJson);}catch{return null;}}
 if(!isObject(answers))return null;
 const questions=[...new Map(entry.workValueModel.parts.flatMap(({part})=>questionsFor(entry,part)).map(q=>[q.id,q])).values()];
 if(!questions.every(q=>entry.engine.complete(q,answers[q.id])))return null;
 const result=entry.engine.calculate(answers,{});
 return createWorkValuePreferences(result,answers,'archived-answers',entry.version);
}
