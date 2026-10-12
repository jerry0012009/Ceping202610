import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {engine,data,calculateReportSnapshot,calculateReport,fingerprint} from './legacy-helpers.js';
import {createStoredReport} from './legacy-helpers.js';
import {presentReport} from '../report-presentation.js';
import {createEmploymentAnswers} from '../employment-answers.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)));
const context=answers=>({version:'2.9',fingerprint,answers});
const legacy=answers=>{const report=calculateReportSnapshot(answers,{});delete report.employmentAnswers;return report;};

test('employment display preserves every selected employer text and never reverses fact scores',()=>{
 for(const option of data.questions.find(q=>q.id==='QB001').options){
  const answers={QB001:option.key,QB002:{months:[60,0,0],status:'仍在职'}},shown=calculateReport(answers,{});
  assert.equal(shown.employmentAnswers.employersText,option.text);
  assert.equal(presentReport(legacy(answers),context(answers)).employmentAnswers.employersText,option.text);
  assert.doesNotMatch(JSON.stringify(shown.employmentAnswers),/"(?:raw|score|scores|weights|scoreText|answer|key)":/);
 }
 assert.equal(engine.calculate({QB001:'A'},{}).facts.employers.raw,engine.calculate({QB001:'D'},{}).facts.employers.raw);
 assert.equal(calculateReport({QB001:'A',QB002:{months:[12,0,36],status:'已离职'}},{}).employmentAnswers.tenure.noExperience,false,'zero employers in five years does not imply no lifetime work');
});

test('three original tenure slots, fractional months and missing status survive without invented data',()=>{
 for(const value of [{months:[60,0,0],status:'仍在职'},{months:[12,0,36],status:'已离职'},{months:[.5,12.25,0],status:'仍在职'},{months:['12','无','36'],status:'已离职'},{months:[12,0,36]},{months:[0,0,0],status:''},{none:true,months:[99,20,30],status:'仍在职'},undefined]){
  const answers={QB001:'B',QB002:value},before=JSON.stringify(answers),current=calculateReport(answers,{}).employmentAnswers,old=legacy(answers),raw=JSON.stringify(old),historical=presentReport(old,context(answers)).employmentAnswers;
  assert.deepEqual({...historical,source:'completion'},current);assert.equal(JSON.stringify(answers),before);assert.equal(JSON.stringify(old),raw);
  if(value?.none===true){assert.deepEqual(current.tenure,{noExperience:true,months:null,status:null,recordedMonths:[]});}
  else if(value){assert.deepEqual(current.tenure.months,value.months.map(v=>v==='无'?v:Number(v)));assert.equal(current.tenure.status,value.status||null);assert.equal(current.tenure.noExperience,value.months.every(v=>v===0||v==='无'));}
  else assert.deepEqual(current.tenure,{noExperience:false,months:null,status:null,recordedMonths:[]});
  assert.deepEqual(presentReport(presentReport(old,context(answers))),presentReport(old,context(answers)));
 }
});

test('legacy facts keep known months non-positional and unknown version keys are never decoded',()=>{
 const answers={QB001:'B',QB002:{months:[12,0,36],status:'已离职'}},snapshot=legacy(answers),before=JSON.stringify(snapshot);
 for(const input of [{},{version:'2.9'},{fingerprint},{...context(answers),version:'future'},{...context(answers),fingerprint:'unknown'}]){
  if(input.version==='future'||input.fingerprint==='unknown'){assert.throws(()=>presentReport(snapshot,input),/版本或校验标识/);continue;}
  const shown=presentReport(snapshot,input).employmentAnswers;assert.equal(shown.employersText,null);assert.equal(shown.tenure.months,null);assert.equal(shown.tenure.status,null);assert.deepEqual(shown.tenure.recordedMonths,[12,36]);assert.equal(shown.tenure.noExperience,false);
 }
 for(const input of [{version:'2.9',fingerprint,answersJson:'{broken'},context(null),context({})]){
  const shown=presentReport(snapshot,input).employmentAnswers;assert.equal(shown.employersText,'1家');assert.equal(shown.tenure.months,null);assert.equal(shown.tenure.status,null);assert.deepEqual(shown.tenure.recordedMonths,[12,36]);
 }
 const missing=presentReport({version:'2.9',facts:{}},context({})).employmentAnswers;assert.equal(missing.tenure.noExperience,false);assert.deepEqual(missing.tenure.recordedMonths,[]);
 assert.equal(JSON.stringify(snapshot),before);
 const wrong={...snapshot,version:'future'};assert.throws(()=>presentReport(wrong,context(answers)),/版本或校验标识/);
});

test('saved employment metadata is validated and reconstructed without unknown scoring fields',()=>{
 const answers={QB001:'B',QB002:{months:[60,0,0],status:'仍在职'}},snapshot=calculateReportSnapshot(answers,{});
 for(const mutate of [value=>value.version='future',value=>value.fingerprint='other',value=>value.employersText='<script>bad</script>',value=>value.tenure.months=[60],value=>value.tenure.status='<img src=x>',value=>value.tenure.recordedMonths=[NaN]]){
  const invalid=structuredClone(snapshot);mutate(invalid.employmentAnswers);const shown=presentReport(invalid).employmentAnswers;assert.equal(shown.source,'legacy-facts');assert.equal(shown.employersText,null);assert.equal(shown.tenure.status,null);
 }
 const extras=structuredClone(snapshot);extras.employmentAnswers.scores={leak:999};extras.employmentAnswers.tenure.weights={leak:999};assert.deepEqual(presentReport(extras).employmentAnswers,snapshot.employmentAnswers);
 assert.equal(createEmploymentAnswers(answers,{version:'future',fingerprint}),null);
});

test('all forty numeric baselines and raw facts remain exact with employment display metadata',()=>{
 for(const fixture of fixtures){const answersBefore=JSON.stringify(fixture.answers),result=engine.calculate(fixture.answers,fixture.seconds),snapshot=createStoredReport(fixture.answers,fixture.seconds),before=JSON.stringify(snapshot),shown=presentReport(snapshot);
  assert.deepEqual({raw:result.raw,reference:result.reference,totals:result.totals},fixture.expected,fixture.id);
  assert.deepEqual(snapshot.facts,result.facts);assert.deepEqual(shown.facts,result.facts);assert.equal(JSON.stringify(snapshot),before);assert.equal(JSON.stringify(fixture.answers),answersBefore);assert.equal(shown.employmentAnswers.source,'completion');
 }
 const hash=files=>createHash('sha256').update(fs.readFileSync(new URL(files[0],import.meta.url))).update(fs.readFileSync(new URL(files[1],import.meta.url))).digest('hex');
 assert.equal(hash(['../private/questionnaire-v2.9.json','../private/engine-v2.9.cjs']),fingerprint);assert.equal(hash(['../private/archive/v2.9/questionnaire.json','../private/archive/v2.9/engine.cjs']),fingerprint);
});
