import {getVersion} from './version-registry.js';
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const month=value=>value==='无'?'无':((typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null);
const status=value=>['仍在职','已离职'].includes(value)?value:null;
const options=entry=>entry.data.questions.find(q=>q.id==='QB001').options;
const employerText=(key,entry)=>options(entry).find(option=>option.key===key)?.text??null;
function tenureAnswer(value){
 if(value?.none===true)return {noExperience:true,months:null,status:null,recordedMonths:[]};
 const months=Array.isArray(value?.months)&&value.months.length===3?value.months.map(month):null;
 return {noExperience:!!months&&months.every(value=>value===0||value==='无'),months,status:status(value?.status),recordedMonths:[]};
}
export function createEmploymentAnswers(answers,{version,fingerprint},source='completion'){
 const entry=getVersion(version,fingerprint);if(!entry||fingerprint!==entry.fingerprint)return null;
 return {version,fingerprint,source,employersText:employerText(answers?.QB001,entry),tenure:tenureAnswer(answers?.QB002)};
}
function savedAnswers(value,entry){
 if(!isObject(value)||value.version!==entry.version||value.fingerprint!==entry.fingerprint||!['completion','archived-answers'].includes(value.source))return null;
 const tenure=value.tenure;
 if(!(value.employersText===null||options(entry).some(option=>option.text===value.employersText))||!isObject(tenure)||typeof tenure.noExperience!=='boolean'||!(tenure.status===null||status(tenure.status))||!(tenure.months===null||Array.isArray(tenure.months)&&tenure.months.length===3&&tenure.months.every(value=>value===null||month(value)===value))||!Array.isArray(tenure.recordedMonths)||!tenure.recordedMonths.every(value=>Number.isFinite(value)&&value>0))return null;
 // Reconstruct the public shape; never spread unrecognized saved keys or scoring maps.
 return {version:value.version,fingerprint:value.fingerprint,source:value.source,employersText:value.employersText,tenure:{noExperience:tenure.noExperience,months:tenure.months?.slice()??null,status:tenure.status,recordedMonths:tenure.recordedMonths.slice()}};
}
export function resolveEmploymentAnswers(snapshot,context={}){
 const answerVersion=snapshot.answerVersion||snapshot.version,entry=getVersion(answerVersion,context.fingerprint);
 const incompatible=!entry||(context.version!==undefined&&context.version!==answerVersion);
 const compatible=!incompatible&&context.version===entry.version&&context.fingerprint===entry.fingerprint;
 if(!incompatible){const saved=savedAnswers(snapshot.employmentAnswers,entry);if(saved)return saved;}
 // Old fact snapshots discarded zero slots and status. Keep only known values,
 // without guessing which job they belonged to or reversing a fact score.
 const fallback={source:'legacy-facts',employersText:compatible?employerText(snapshot.facts?.employers?.answer,entry):null,tenure:{noExperience:snapshot.facts?.tenure?.noExperience===true,months:null,status:null,recordedMonths:(Array.isArray(snapshot.facts?.tenure?.months)?snapshot.facts.tenure.months:[]).filter(value=>Number.isFinite(value)&&value>0)}};
 if(!compatible)return fallback;
 let answers=context.answers;
 if(answers===undefined&&typeof context.answersJson==='string'){try{answers=JSON.parse(context.answersJson);}catch{return fallback;}}
 if(!isObject(answers))return fallback;
 const display=createEmploymentAnswers(answers,context,'archived-answers');
 if(!Object.hasOwn(answers,'QB001'))display.employersText=fallback.employersText;
 if(!Object.hasOwn(answers,'QB002'))display.tenure=fallback.tenure;
 return display;
}
