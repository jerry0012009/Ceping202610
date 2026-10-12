import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {calculateReport,calculateReportSnapshot} from '../scoring.js';
import {presentReport} from '../report-presentation.js';

const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)));
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/report-numeric-baseline.json',import.meta.url)));
const presentation=JSON.parse(fs.readFileSync(new URL('../private/report-presentation.json',import.meta.url)));
const hash=value=>createHash('sha256').update(value).digest('hex');
const numericRow=({code,raw,score,mean,lower,upper,label,coverage})=>({code,raw,score,mean,lower,upper,label,...(coverage?{coverage}:{})});
const numericReport=({schemaVersion,version,pfModelId,pfReferenceId,pfRoleTitle,answered,total,totals,dimensions,facts})=>({schemaVersion,version,pfModelId,pfReferenceId,pfRoleTitle,answered,total,totals:totals.map(numericRow),dimensions:dimensions.map(numericRow),facts});

test('frozen reports remain exact after reversing only approved value-card replacement and reviewed-reference display exceptions',()=>{
 assert.equal(fixtures.length,40);
 assert.equal(baseline.rows.length,fixtures.length);
 for(const fixture of fixtures){
  const report=calculateReport(fixture.answers,fixture.seconds);
  const original=calculateReportSnapshot(fixture.answers,fixture.seconds),oldRows=new Map(original.dimensions.map(row=>[row.code,row]));
  assert.equal(report.dimensions.filter(row=>row.code.startsWith('WV_')).length,3);
  assert.ok(!report.dimensions.some(row=>row.code==='ST3'));
  // Keep frozen hashes untouched: reconstruct only the two explicitly approved presentation changes.
  report.dimensions=report.dimensions.filter(row=>!row.code.startsWith('WV_')).map(row=>{
   const approved={ST1:{mean:78,lower:54.7,upper:99.9},ST2:{mean:72,lower:50.3,upper:98.7},SJ1:{mean:90,lower:82.5,upper:99.9},SJ2:{mean:87,lower:77,upper:99.9},SJ3:{mean:77,lower:65.1,upper:91.9}};
   if(!approved[row.code])return row;
   assert.deepEqual({mean:row.mean,lower:row.lower,upper:row.upper},approved[row.code]);
   const old=oldRows.get(row.code);return {...row,mean:old.mean,lower:old.lower,upper:old.upper,label:old.label};
  });
  report.dimensions.splice(original.dimensions.findIndex(row=>row.code==='ST3'),0,oldRows.get('ST3'));
  assert.equal(hash(JSON.stringify(numericReport(report))),baseline.rows.find(row=>row.id===fixture.id).sha256,fixture.id);
 }
 for(const [path,expected] of Object.entries(baseline.protectedFiles)){
  assert.equal(hash(fs.readFileSync(new URL('../'+path,import.meta.url))),expected,path+' must remain byte-for-byte unchanged');
 }
});

test('current-model historical reports receive all current descriptions without changing any saved field',()=>{
 for(const fixture of fixtures){
  const saved=calculateReport(fixture.answers,fixture.seconds);
  saved.reportRevision='2.9-report-3';
  saved.interpretationNotes=['stale algorithm explanation'];
  for(const row of [...saved.totals,...saved.dimensions]){
   for(const key of ['definition','highMeaning','lowMeaning'])row[key]='stale algorithm explanation';
   row.example={answer:'private representative answer'};
  }
  saved.internalEvidence={marker:'private evidence'};
  const bytes=JSON.stringify(saved),shown=presentReport(saved);
  assert.equal(JSON.stringify(saved),bytes,'projection never mutates stored snapshot');
  assert.deepEqual(numericReport(shown),numericReport(saved),fixture.id);
  assert.equal(shown.reportRevision,presentation.revision);
  assert.deepEqual(shown.interpretationNotes,presentation.notes);
  for(const row of [...shown.totals,...shown.dimensions]){
   for(const key of ['definition','highMeaning','lowMeaning'])assert.equal(row[key],presentation.metrics[row.code][key],row.code+'.'+key);
  }
  assert.doesNotMatch(JSON.stringify(shown),/stale algorithm explanation|private representative answer|private evidence|internalEvidence|representativeAnswers/);
  assert.deepEqual(presentReport(shown),shown,'current descriptions are idempotent');
 }
});

test('presentation fields cannot overwrite numeric report values and representative answers stay hidden',()=>{
 assert.equal(presentation.showRepresentativeAnswers,false);
 assert.equal(presentation.showCodes,false);
 assert.deepEqual(presentation.rvReference,{mean:85,lower:75.3,upper:94.7});
 for(const [code,copy] of Object.entries(presentation.metrics)){
  assert.deepEqual(Object.keys(copy).filter(key=>!['name','definition','highMeaning','lowMeaning','limitation'].includes(key)),[],code);
  for(const key of ['name','definition','highMeaning','lowMeaning'])assert.equal(typeof copy[key],'string',code+'.'+key);
 }
});
