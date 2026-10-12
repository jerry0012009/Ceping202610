import {questionnaire,fingerprint} from './scoring.js';
// Immutable presentation archive. Keep the 2.9 bank when adding future questionnaire versions.
const archives={'2.9':questionnaire};
const fields={INFO014:{status:'婚姻状况',other:'其他说明'},INFO016:{place:'配偶/对象工作地'},INFO017:{status:'目前是否两地分居'},INFO018:{children:'目前是否已有子女',arrangement:'照料或支持安排'},INFO019:{age:'孩子年龄（岁）'},INFO020:{stage:'最小孩子的就学阶段'},INFO022:{carer:'主要照顾人',other:'保姆/其他说明'},INFO023:{place:'老人居住地',age:'老人年龄',living:'是否同住'}};
const choices={INFO014:{status:['未婚','已婚','离异','其他','无']},INFO017:{status:['是','否','部分时间','无']},INFO018:{children:['没有','有','不愿填写','无']},INFO020:{stage:['未入学','幼儿园','小学','初中','高中及以上','无']},INFO022:{carer:['我自己','配偶','男方父母','女方父母','保姆/其他','无']},INFO023:{living:['是','否','部分时间','无']}};
const fieldLabel=(id,key)=>Object.hasOwn(fields[id]||{},key)?fields[id][key]:'其他字段（'+key+'）';
const fieldOptions=(id,key)=>Object.hasOwn(choices[id]||{},key)?choices[id][key]:[];
const display=value=>typeof value==='string'&&value.trim()==='不适用'?'无':String(value??'');
export function answerDetails(version,answers,storedFingerprint=fingerprint){
 const bank=archives[version];if(!bank||storedFingerprint!==fingerprint)throw Object.assign(new Error('此记录的原始问卷版本暂不可读取，未使用其他版本题目替代。'),{status:422});
 return {questionnaireVersion:version,questions:bank.questions.map(q=>{
  const value=answers[q.id],option=key=>{const found=q.options.find(o=>o.key===key);return found?`${found.key} · ${found.text}`:display(key)||'无/未填写';};let answerText='无/未填写',answered=false;
  if(q.type==='family'){const lines=Object.entries(value||{}).filter(([,v])=>String(v??'').trim()).map(([key,v])=>`${fieldLabel(q.id,key)}：${display(v)}`);answerText=lines.join('\n')||'无/未填写';answered=lines.length>0;}
  else if(q.type==='tenure'){if(value?.none===true){answerText='没有正式工作经历';answered=true;}else if(value&&Array.isArray(value.months)){answerText=['最近一段','上一段','再上一段'].map((name,i)=>`${name}在职月数：${display(value.months[i])}`).join('\n')+`\n最近一段状态：${display(value.status)||'无/未填写'}`;answered=true;}}
  else if(q.type==='double'){if(value&&typeof value==='object'){answerText=`最像我：${option(value.most)}\n最不像我：${option(value.least)}`;answered=value.most!==undefined||value.least!==undefined;}}
  else if(value!==undefined){answerText=option(value);answered=true;}
  const familyFields=q.type==='family'?Array.from(new Set([...Object.keys(fields[q.id]||{}),...Object.keys(value||{})])).map(key=>({label:fieldLabel(q.id,key),value:display(value?.[key])||'无/未填写',options:fieldOptions(q.id,key).map(text=>({text,selected:display(value?.[key])===text}))})):undefined;
  return {number:q.number,...(familyFields?{fields:familyFields}:{}),stem:q.stem,instructions:q.instructions,type:q.type,options:q.options.map(({key,text})=>({key,text,selection:q.type==='double'?(value?.most===key?'most':value?.least===key?'least':'unselected'):(value===key?'selected':'unselected')})),answerText,answered};
 })};
}
