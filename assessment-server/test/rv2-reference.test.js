import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculateReport,calculateReportSnapshot} from '../scoring.js';
import {presentReport} from '../report-presentation.js';
const load=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const current=load('synthetic-assumed-v2.11-40.json').rows;
const prior=load('synthetic-assumed-v2.10-40.json').rows;
const original=load('regression-40.json');
const ref=row=>({mean:row.mean,lower:row.lower,upper:row.upper});
const expected={mean:72,lower:53.2,upper:90.8};

test('RV2 public reference applies identically to current and compatible historical answers without score changes',()=>{
 for(const [version,rows] of [['2.11',current],['2.10',prior],['2.9',original]])for(const row of rows){
  const before=JSON.stringify(row),snapshot=calculateReportSnapshot(row.answers,row.seconds,'2.11',version),report=presentReport(snapshot);
  const source=snapshot.dimensions.find(v=>v.code==='RV2'),value=report.dimensions.find(v=>v.code==='RV2');
  assert.deepEqual(ref(value),expected);assert.equal(value.raw,source.raw);assert.equal(value.score,source.score);assert.deepEqual(value.coverage,source.coverage);
  assert.equal(value.score,100);assert.equal(value.label,'较高');
  assert.equal(JSON.stringify(row),before);
 }
 for(const row of current)assert.deepEqual(calculateReport(row.answers,row.seconds),row.report,'only the explicitly updated RV2 reference fixture differs from the prior release');
});

test('RV2 reference classifies boundaries and preserves missing values and coverage',()=>{
 const source=calculateReportSnapshot(current[0].answers,current[0].seconds);
 for(const [score,label]of [[100,'较高'],[90.8,'稍高'],[81.4,'平均'],[72,'平均'],[62.59,'稍低'],[53.2,'稍低'],[53.19,'较低'],[null,'无参照']]){
  const snapshot=structuredClone(source),rv2=snapshot.dimensions.find(v=>v.code==='RV2');Object.assign(rv2,{raw:score,score,coverage:{answered:score===null?0:3,total:4}});
  const projected=presentReport(snapshot).dimensions.find(v=>v.code==='RV2');
  assert.deepEqual(ref(projected),expected);assert.equal(projected.label,label);assert.equal(projected.score,score);assert.deepEqual(projected.coverage,rv2.coverage);
 }
});
