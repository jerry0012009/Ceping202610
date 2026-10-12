import model from './private/work-value-model.json' with {type:'json'};
import archivedData from './private/archive/v2.9/questionnaire.json' with {type:'json'};
import archivedEngineModule from './private/archive/v2.9/engine.cjs';
const archivedEngine=archivedEngineModule.create(archivedData);
export const workValueModelId=model.id,workValueReferenceId=model.referenceId;
export const workValueParts=model.parts;
export const workValueArchive={version:model.scoringVersion,fingerprint:model.scoringFingerprint};
const questionsFor=part=>archivedData.questions.filter(q=>q.values?.[part]);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function createWorkValuePreferences(result,answers,source='completion'){
 return {modelId:workValueModelId,referenceId:workValueReferenceId,scoringVersion:model.scoringVersion,scoringFingerprint:model.scoringFingerprint,source,
  scores:model.parts.map(({code,part})=>{const questions=questionsFor(part),value=result.valueParts[part].value;return {code,raw:value,score:value,coverage:{answered:questions.filter(q=>archivedEngine.complete(q,answers[q.id])).length,total:questions.length}};})};
}
function validSaved(value){
 return value?.modelId===workValueModelId&&value.referenceId===workValueReferenceId&&value.scoringVersion===model.scoringVersion&&value.scoringFingerprint===model.scoringFingerprint&&['completion','archived-answers'].includes(value.source)&&Array.isArray(value.scores)&&value.scores.length===model.parts.length&&model.parts.every(({code,part})=>{
  const rows=value.scores.filter(row=>row.code===code),row=rows[0],total=questionsFor(part).length;
  return rows.length===1&&(row.score===null||(Number.isFinite(row.score)&&row.score>=0&&row.score<=100))&&row.raw===row.score&&Number.isInteger(row.coverage?.answered)&&row.coverage.answered>=0&&row.coverage.answered<=total&&row.coverage.total===total;
 });
}
export function resolveWorkValuePreferences(snapshot,context={}){
 if((context.version!==undefined&&context.version!==model.scoringVersion)||(context.fingerprint!==undefined&&context.fingerprint!==model.scoringFingerprint))return null;
 if(validSaved(snapshot.workValuePreferences))return snapshot.workValuePreferences;
 // Historical answers are used only with this explicitly archived version AND fingerprint.
 // Do not infer three scores from ST3, partial evidence, or a newer scoring engine.
 if(context.version!==model.scoringVersion||context.fingerprint!==model.scoringFingerprint||snapshot.version!==context.version)return null;
 let answers=context.answers;
 if(answers===undefined&&typeof context.answersJson==='string'){try{answers=JSON.parse(context.answersJson);}catch{return null;}}
 if(!isObject(answers))return null;
 const questions=[...new Map(model.parts.flatMap(({part})=>questionsFor(part)).map(q=>[q.id,q])).values()];
 if(!questions.every(q=>archivedEngine.complete(q,answers[q.id])))return null;
 const result=archivedEngine.calculate(answers,{});
 return createWorkValuePreferences(result,answers,'archived-answers');
}
