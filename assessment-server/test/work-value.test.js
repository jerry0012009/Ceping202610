import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {engine,data,calculateReport,calculateReportSnapshot,fingerprint} from '../scoring.js';
import {createStoredReport} from '../stored-report.js';
import {presentReport} from '../report-presentation.js';
import {workValueParts,workValueArchive,createWorkValuePreferences} from '../work-value-model.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)));
const audit=JSON.parse(fs.readFileSync(new URL('../private/work-value-reference-audit.json',import.meta.url)));
const classify=(s,r)=>s<r.lower?'较低':s<(r.lower+r.mean)/2?'稍低':s<=(r.mean+r.upper)/2?'平均':s<=r.upper?'稍高':'较高';
const context=f=>({version:'2.9',fingerprint,answers:f.answers});
const partRows=report=>report.dimensions.filter(row=>row.code.startsWith('WV_'));

test('all forty reports persist three raw work preferences and preserve legacy ST3/ST internally',()=>{
 for(const f of fixtures){
  const result=engine.calculate(f.answers,f.seconds),stored=createStoredReport(f.answers,f.seconds),shown=presentReport(stored),rows=partRows(shown);
  assert.equal(stored.dimensions.find(row=>row.code==='ST3').raw,f.expected.raw.ST3);
  assert.equal(stored.dimensions.find(row=>row.code==='ST3').score,f.expected.reference.ST3);
  assert.equal(stored.totals.find(row=>row.code==='ST').score,f.expected.totals.ST.reference);
  assert.equal(rows.length,3);assert.ok(!shown.dimensions.some(row=>row.code==='ST3'));assert.equal(shown.dimensions.length,24);
  assert.equal(shown.workValuePreferences.modelId,'work-value-preferences-v2.9-v1');assert.equal(shown.workValuePreferences.referenceId,audit.referenceId);
  assert.equal(shown.workValuePreferences.scoringFingerprint,fingerprint);assert.equal(shown.workValuePreferences.source,'completion');
  for(const {code,part,reference} of workValueParts){const row=rows.find(row=>row.code===code),questions=data.questions.filter(q=>q.values[part]);
   assert.equal(row.raw,result.valueParts[part].value);assert.equal(row.score,result.valueParts[part].value); // no added E deduction, including all S fixtures
   assert.deepEqual({mean:row.mean,lower:row.lower,upper:row.upper},reference);assert.equal(row.label,classify(row.score,reference));
   assert.deepEqual(row.coverage,{answered:questions.length,total:questions.length});
  }
  assert.deepEqual(rows.map(row=>row.coverage.total),[4,6,3]);
  assert.match(shown.workValueNotice,/独立得分.*不是百分比.*不相加为100.*不代表优劣或留任保证/);
  assert.doesNotMatch(JSON.stringify(shown),/"(?:internalEvidence|records|weights|trace|coefficient)":/);
  assert.deepEqual(presentReport(shown),shown);
 }
});

test('approved independent references recalculate with equal persona H20 D30 S30 Z20 weighting',()=>{
 const weights={H:.02,D:.03,S:.03,Z:.02};assert.equal(fixtures.length,40);
 assert.equal(new Set(fixtures.map(f=>f.id.split('-')[0])).size,10);
 for(const {part,reference} of workValueParts){
  const values=fixtures.map(f=>({score:engine.calculate(f.answers,f.seconds).valueParts[part].value,weight:weights[f.id.split('-')[1]]}));
  const mean=values.reduce((sum,row)=>sum+row.score*row.weight,0),sd=Math.sqrt(values.reduce((sum,row)=>sum+row.weight*(row.score-mean)**2,0));
  const expected=Object.values(audit.stats).find(row=>row.label===part);assert.ok(Math.abs(mean-expected.weightedMean)<1e-10);assert.ok(Math.abs(sd-expected.weightedPopulationSD)<1e-10);
  assert.deepEqual(reference,{mean:Math.round(mean),lower:Math.round(Math.max(0,Math.round(mean)-Math.max(7.5,sd))*10)/10,upper:Math.round(Math.min(100,Math.round(mean)+Math.max(7.5,sd))*10)/10});
 }
});

test('value coverage counts unique complete questions, never double-choice slots',()=>{
 const answers={QB031:{most:'A',least:'B'}},values=createWorkValuePreferences(engine.calculate(answers,{}),answers);
 assert.deepEqual(values.scores.map(row=>row.coverage),[{answered:1,total:4},{answered:1,total:6},{answered:0,total:3}]);
 const partial={QB031:{most:'A'}},incomplete=createWorkValuePreferences(engine.calculate(partial,{}),partial);assert.equal(incomplete.scores[0].coverage.answered,0);assert.equal(incomplete.scores[1].coverage.answered,0);
});

test('historical values derive only from complete stored answers with archived version AND fingerprint',()=>{
 const questionBytes=fs.readFileSync(new URL('../private/archive/v2.9/questionnaire.json',import.meta.url)),engineBytes=fs.readFileSync(new URL('../private/archive/v2.9/engine.cjs',import.meta.url));
 assert.equal(createHash('sha256').update(questionBytes).update(engineBytes).digest('hex'),fingerprint);assert.equal(workValueArchive.fingerprint,fingerprint);
 for(const f of fixtures){
  const original=calculateReportSnapshot(f.answers,f.seconds);delete original.workValuePreferences;original.internalEvidence={sentinel:'must-stay-private'};
  const before=JSON.stringify(original),answersBefore=JSON.stringify(f.answers),shown=presentReport(original,context(f)),expected=calculateReport(f.answers,f.seconds);
  assert.deepEqual(partRows(shown),partRows(expected));assert.equal(shown.workValuePreferences.source,'archived-answers');assert.match(shown.workValueDerivationNotice,/原始记录保留/);
  assert.equal(JSON.stringify(original),before);assert.equal(JSON.stringify(f.answers),answersBefore);assert.deepEqual(shown.totals,expected.totals);assert.deepEqual(presentReport(shown),shown);
 }
 const f=fixtures[0],snapshot=calculateReportSnapshot(f.answers,f.seconds);delete snapshot.workValuePreferences;
 for(const invalid of [{},{version:'2.9',answers:f.answers},{fingerprint,answers:f.answers},{...context(f),version:'future'},{...context(f),fingerprint:'unknown'},{...context(f),answers:null},{version:'2.9',fingerprint,answersJson:'{invalid'},{...context(f),answers:{...f.answers,QB031:{most:'A',least:'A'}}},{...context(f),answers:{...f.answers,QB031:{most:'A'}}},{...context(f),answers:{...f.answers,QB054:undefined}}]){
  const shown=presentReport(snapshot,invalid);assert.equal(partRows(shown).length,0);assert.equal(shown.workValuePreferences,null);assert.match(shown.workValueUnavailable,/暂无法展示/);assert.ok(!shown.dimensions.some(row=>row.code==='ST3'));
 }
 const poison=structuredClone(snapshot);poison.dimensions.find(row=>row.code==='ST3').score=999;const shown=presentReport(poison,context(f));assert.deepEqual(partRows(shown),partRows(calculateReport(f.answers,f.seconds)),'never split the legacy composite');
 const invalidSaved=calculateReportSnapshot(f.answers,f.seconds);invalidSaved.workValuePreferences.referenceId='wrong';assert.equal(partRows(presentReport(invalidSaved)).length,0);
 const mismatchedSnapshot={...snapshot,version:'future'};assert.equal(partRows(presentReport(mismatchedSnapshot,context(f))).length,0);
});

test('only five approved reference configurations change while all scores and other references remain exact',()=>{
 const approved={ST1:{mean:78,lower:54.7,upper:99.9},ST2:{mean:72,lower:50.3,upper:98.7},SJ1:{mean:90,lower:82.5,upper:99.9},SJ2:{mean:87,lower:77,upper:99.9},SJ3:{mean:77,lower:65.1,upper:91.9}};
 const referenceAudit=JSON.parse(fs.readFileSync(new URL('../private/reviewed-reference-audit.json',import.meta.url))),labels=['较低','稍低','平均','稍高','较高'];
 const counts=()=>Object.fromEntries(labels.map(label=>[label,0]));const beforeAll=counts(),afterAll=counts(),beforeHonest=counts(),afterHonest=counts();
 assert.deepEqual(referenceAudit.approvedReferences,approved);
 for(const f of fixtures){
  const snapshot=calculateReportSnapshot(f.answers,f.seconds),shown=presentReport(snapshot),before=JSON.stringify(snapshot);
  for(const old of snapshot.dimensions.filter(row=>row.code!=='ST3')){
   const row=shown.dimensions.find(row=>row.code===old.code);for(const key of ['raw','score','coverage'])assert.deepEqual(row[key],old[key]);
   if(approved[row.code]){
    assert.deepEqual({mean:row.mean,lower:row.lower,upper:row.upper},approved[row.code]);assert.equal(row.label,classify(old.score,approved[row.code]));
    const previousLabel=classify(old.score,referenceAudit.previousDisplayReferences[row.code]);beforeAll[previousLabel]++;afterAll[row.label]++;
    if(f.id.endsWith('-H')){beforeHonest[previousLabel]++;afterHonest[row.label]++;}
   }else for(const key of ['mean','lower','upper','label'])assert.equal(row[key],old[key]);
  }
  assert.equal(JSON.stringify(snapshot),before);assert.deepEqual(presentReport(shown),shown);assert.equal(shown.referenceRevision,'2.9-report-reference-reviewed-centers-v1');
  assert.equal(shown.referenceLabel,'参照中心');assert.equal(shown.referenceDescription,'参考区间基于模拟作答，并结合题目含义作暂定调整，非实测人群常模。');assert.equal(shown.disclaimer,shown.referenceDescription);
 }
 assert.deepEqual(Object.values(beforeAll),[32,10,70,59,29]);assert.deepEqual(Object.values(afterAll),[20,10,66,75,29]);assert.deepEqual(Object.values(beforeHonest),[16,1,10,16,7]);assert.deepEqual(Object.values(afterHonest),[10,5,10,18,7]);
 // Preserve real synthetic statistics separately: manual reference centers must not replace them.
 const weights={H:.02,D:.03,S:.03,Z:.02};for(const code of Object.keys(approved)){
  const values=fixtures.map(f=>({score:engine.calculate(f.answers,f.seconds).reference[code],weight:weights[f.id.split('-')[1]]}));
  const mean=values.reduce((s,v)=>s+v.score*v.weight,0),sd=Math.sqrt(values.reduce((s,v)=>s+v.weight*(v.score-mean)**2,0));
  assert.ok(Math.abs(mean-referenceAudit.sourceSyntheticStatistics[code].syntheticWeightedMean)<1e-10);assert.ok(Math.abs(sd-referenceAudit.sourceSyntheticStatistics[code].syntheticWeightedPopulationSD)<1e-10);assert.notEqual(mean,approved[code].mean);
  const r=approved[code];for(const score of [r.lower-1e-8,r.lower,(r.lower+r.mean)/2,(r.mean+r.upper)/2,r.upper,r.upper+1e-8,100]){
   const report=calculateReportSnapshot(fixtures[0].answers,fixtures[0].seconds);report.dimensions.find(row=>row.code===code).score=score;
   assert.equal(presentReport(report).dimensions.find(row=>row.code===code).label,classify(score,r));
  }
 }
});
