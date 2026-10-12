import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {answerDetails} from '../answer-details.js';
import {questionnaire} from '../scoring.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)))[0];
test('completed answer details preserve frozen version order, original labels, and all answer types without score internals',()=>{
 const answers=structuredClone(fixture.answers);answers.INFO014={status:'不适用',other:'<img src=x onerror=alert(1)>'};delete answers.INFO016;const frozen=JSON.stringify(answers),details=answerDetails('2.9',answers);assert.equal(JSON.stringify(answers),frozen);assert.equal(details.questionnaireVersion,'2.9');assert.equal(details.questions.length,questionnaire.questions.length);assert.deepEqual(details.questions.map(q=>q.number),questionnaire.questions.map(q=>q.number));for(let i=0;i<details.questions.length;i++){const q=details.questions[i],source=questionnaire.questions[i];assert.equal(q.stem,source.stem);assert.deepEqual(q.options.map(({key,text})=>({key,text})),source.options);for(const option of q.options)assert.ok(['selected','most','least','unselected'].includes(option.selection));assert.deepEqual(q.instructions,source.instructions);assert.deepEqual(Object.keys(q).sort(),['answerText','answered',...(q.type==='family'?['fields']:[]),'instructions','number','options','stem','type']);}assert.doesNotMatch(JSON.stringify(details),/"(?:score|scores|weights|raw|reference|coeff|contribution|seconds)":/);
 const original=id=>details.questions[questionnaire.questions.findIndex(q=>q.id===id)];assert.match(original('INFO014').answerText,/婚姻状况：无/);assert.match(original('INFO014').answerText,/<img/);assert.equal(original('INFO016').answerText,'无\/未填写');
 const scalar=details.questions.find(q=>['single','scale'].includes(q.type)&&q.answered);assert.ok(scalar?.answerText);assert.equal(scalar.options.filter(x=>x.selection==='selected').length,1);const double=details.questions.find(q=>q.type==='double');assert.match(double.answerText,/最像我：/);assert.match(double.answerText,/最不像我：/);assert.equal(double.options.filter(x=>x.selection==='most').length,1);assert.equal(double.options.filter(x=>x.selection==='least').length,1);const tenure=details.questions.find(q=>q.type==='tenure');assert.match(tenure.answerText,/月数|没有正式工作经历/);
 assert.throws(()=>answerDetails('unavailable',answers),e=>e.status===422);assert.throws(()=>answerDetails('2.9',answers,'unknown-fingerprint'),e=>e.status===422);const unknown=answerDetails('2.9',{INFO014:{custom:'原始额外字段'}}).questions.find(q=>q.number===questionnaire.questions.find(q=>q.id==='INFO014').number);assert.match(unknown.answerText,/原始额外字段/);
});


test('admin family details map only approved applicability fields without conflating factual answers or mutating input',()=>{
 for(const [id,key,label,options,empty]of [
  ['INFO018','children','目前是否已有子女',['没有','有','不愿填写'],'不适用'],
  ['INFO023','living','是否同住',['是','否','部分时间'],'不适用/其他'],
 ])for(const value of [undefined,'',...options,'无','不适用',empty]){
  const answers=Object.freeze({[id]:Object.freeze({[key]:value}),INFO014:Object.freeze({status:'不适用'})}),before=JSON.stringify(answers);
  const details=answerDetails('2.9',answers),q=details.questions.find(q=>q.number===questionnaire.questions.find(q=>q.id===id).number),field=q.fields.find(f=>f.label===label),expected=['无','不适用'].includes(value)?empty:value;
  assert.deepEqual(field.options.map(o=>o.text),[...options,empty]);
  assert.deepEqual(field.options.filter(o=>o.selected).map(o=>o.text),expected?[expected]:[]);
  assert.equal(field.value,expected||'无/未填写');assert.equal(q.answerText,expected?`${label}：${expected}`:'无/未填写');assert.equal(q.answered,Boolean(expected));
  const marriage=details.questions.find(q=>q.fields?.some(f=>f.label==='婚姻状况')).fields.find(f=>f.label==='婚姻状况');assert.equal(marriage.value,'无');assert.deepEqual(marriage.options.filter(o=>o.selected).map(o=>o.text),['无']);
  assert.equal(JSON.stringify(answers),before);
 }
 const answers={INFO018:{children:'没有',arrangement:'不适用其他安排'},INFO023:{place:'无',age:'不适用',living:'否'}},before=JSON.stringify(answers),details=answerDetails('2.9',answers);
 assert.equal(details.questions.find(q=>q.fields?.some(f=>f.label==='目前是否已有子女')).answerText,'目前是否已有子女：没有\n照料或支持安排：不适用其他安排');
 assert.equal(details.questions.find(q=>q.fields?.some(f=>f.label==='是否同住')).answerText,'老人居住地：无\n老人年龄：无\n是否同住：否');
 assert.equal(JSON.stringify(answers),before);
});
