import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {getVersion,requireVersion,currentVersion} from '../version-registry.js';
import {calculateReport,calculateReportSnapshot,validateSubmission} from '../scoring.js';
import {createStoredReport} from '../stored-report.js';
import {presentReport} from '../report-presentation.js';
import {answerDetails} from '../answer-details.js';
const old=requireVersion('2.9'),current=requireVersion('2.10');
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.10-40.json',import.meta.url)));
const originals=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)));
const maps=[['PH04','MH3',40,[0,25,50,75,100]],['QB099','PF5',30,[100,75,50,25,0]],['QB237','SJ3',30,[100,60]],['QB133','SJ2',30,[85,100,60]],['QB170','PF7',20,[85,70,70]],['QB195','SJ1',20,[75,90]],['QB206','PF2',15,[75,65]]];
const refs={PF2:{mean:51,lower:29.4,upper:72.6},PF5:{mean:47,lower:30.3,upper:63.7},PF7:{mean:74,lower:60.4,upper:87.6},SJ2:{mean:87,lower:77.3,upper:99.6},SJ3:{mean:79,lower:68,upper:92.7},MH3:{mean:31,lower:18.5,upper:43.5},MH:{mean:27,lower:16.7,upper:37.3}};
const fields=row=>({mean:row.mean,lower:row.lower,upper:row.upper});
test('registry preserves source fingerprints, explicit version selection and sanitized banks',()=>{
 assert.equal(currentVersion,'2.10');assert.equal(getVersion(),current);assert.equal(getVersion('__proto__'),null);assert.equal(getVersion('future'),null);assert.equal(getVersion('2.9',current.fingerprint),null);
 for(const entry of [old,current]){
  const {version,fingerprint,questionnaire}=entry;const hash=createHash('sha256').update(fs.readFileSync(new URL(`../private/questionnaire-v${version}.json`,import.meta.url))).update(fs.readFileSync(new URL(`../private/engine-v${version}.cjs`,import.meta.url))).digest('hex');assert.equal(fingerprint,hash);assert.equal(entry.workValueModel.scoringFingerprint,hash);assert.equal(questionnaire.version,version);assert.doesNotMatch(JSON.stringify(questionnaire),/"(?:weights|scoreText|scores|values|coeff|referenceProfile)":/);
 }
 assert.equal(old.fingerprint,'40df986e630a93426ad5e1535316ffe34d0eba0fe9fe564817e4e5629c92a9e5');assert.notEqual(old.pfModel.id,current.pfModel.id);assert.notEqual(old.workValueModel.id,current.workValueModel.id);assert.notEqual(old.presentation.referenceRevision,current.presentation.referenceRevision);
});
test('only approved keys are removed, all original score/weight maps survive by key, seven additions use approved final weights',()=>{
 assert.deepEqual(current.data.questions.map(q=>q.id),old.data.questions.map(q=>q.id));assert.equal(current.data.t0,331);assert.equal(current.data.questions.reduce((s,q)=>s+q.options.length,0),319);
 for(const q of current.data.questions){const prior=old.engine.byId[q.id];assert.equal(q.cost,prior.cost);assert.equal(q.type,prior.type);assert.equal(q.judgment,prior.judgment);assert.equal(q.pool,prior.pool);
  for(const attr of ['scores','values'])for(const [code,values] of Object.entries(prior[attr])){const weights=attr==='scores'?'weights':'valueWeights';assert.equal(q[weights][code],prior[weights][code]);assert.ok(q.dims.includes(code)||attr==='values');const select=arr=>q.options.map(option=>arr[prior.options.findIndex(o=>o.key===option.key)]);assert.deepEqual(q[attr][code],Array.isArray(values)?select(values):Object.fromEntries(Object.entries(values).map(([slot,arr])=>[slot,select(arr)])));}
 }
 assert.deepEqual(current.engine.byId.QB246.options.map(o=>o.key),['A','D']);assert.deepEqual(current.engine.byId.QB185.options.map(o=>o.key),['A','B']);assert.deepEqual(current.engine.byId.QB037.scores.RV1,old.engine.byId.QB037.scores.RV1);assert.equal(current.engine.byId.QB037.weights.RV1,old.engine.byId.QB037.weights.RV1);
 for(const [id,code,weight,scores] of maps){assert.equal(current.engine.byId[id].weights[code],weight);assert.deepEqual(current.engine.byId[id].scores[code],scores);assert.ok(current.data.coverage[code].includes(id));}
 const oldCount=old.data.questions.reduce((n,q)=>n+Object.keys(q.scores).length,0),newCount=current.data.questions.reduce((n,q)=>n+Object.keys(q.scores).length,0);assert.equal(newCount-oldCount,7);
});
test('40 separately labelled assumed synthetic fixtures are valid while frozen original answers remain unchanged',()=>{
 assert.match(fixtures.status,/SYNTHETIC ASSUMED/);assert.equal(fixtures.rows.length,40);assert.equal(fixtures.fingerprint,current.fingerprint);
 for(const f of fixtures.rows){assert.equal(f.observed,false);const prior=originals.find(o=>o.id===f.id);const answerCopy=JSON.stringify(prior.answers);validateSubmission({version:'2.10',answers:f.answers,seconds:f.seconds,submissionId:randomUUID()});const r=current.engine.calculate(f.answers,f.seconds);assert.deepEqual({raw:r.raw,reference:r.reference,totals:r.totals},f.expected);assert.deepEqual(f.seconds,prior.seconds);for(const code of ['RV1','RV2','RV3'])assert.equal(r.raw[code],prior.expected.raw[code]);assert.equal(JSON.stringify(prior.answers),answerCopy);
  const stored=createStoredReport(f.answers,f.seconds),shown=presentReport(stored);assert.deepEqual(shown,calculateReport(f.answers,f.seconds));assert.ok(stored.internalEvidence);assert.doesNotMatch(JSON.stringify(shown),/"(?:internalEvidence|trace|records|weights|representativeAnswers)":/);assert.equal(shown.dimensions.filter(row=>row.code.startsWith('WV_')).length,3);assert.equal(shown.employmentAnswers.version,'2.10');assert.equal(shown.workValuePreferences.scoringFingerprint,current.fingerprint);
  for(const row of [...shown.dimensions,...shown.totals])if(refs[row.code])assert.deepEqual(fields(row),refs[row.code]);
  const oldReport=calculateReport(prior.answers,prior.seconds,'2.9');for(const code of ['WV_STABILITY','WV_GROWTH','WV_REWARD'])assert.deepEqual(shown.dimensions.find(row=>row.code===code),oldReport.dimensions.find(row=>row.code===code));
 }
});
test('archived answer/detail derivation rejects unknown fingerprints and uses the matching model only',()=>{
 for(const entry of [old,current]){const fixture=entry===old?originals[0]:fixtures.rows[0],snapshot=calculateReportSnapshot(fixture.answers,fixture.seconds,entry.version);delete snapshot.workValuePreferences;delete snapshot.employmentAnswers;const before=JSON.stringify(snapshot);const context={version:entry.version,fingerprint:entry.fingerprint,answers:fixture.answers};const shown=presentReport(snapshot,context);assert.equal(shown.workValuePreferences.modelId,entry.workValueModel.id);assert.equal(shown.employmentAnswers.version,entry.version);assert.equal(shown.workValuePreferences.source,'archived-answers');assert.equal(JSON.stringify(snapshot),before);assert.throws(()=>presentReport(snapshot,{...context,fingerprint:'bad'}),/校验标识/);assert.throws(()=>answerDetails(entry.version,fixture.answers,'bad'),/校验标识/);const details=answerDetails(entry.version,fixture.answers,entry.fingerprint);assert.equal(details.questions.find(q=>q.number===41).options.length,entry===old?4:2);}
 const f=fixtures.rows[0];for(const version of [undefined,null,23,'future'])assert.throws(()=>validateSubmission({version,answers:f.answers,seconds:f.seconds,submissionId:randomUUID()}));for(const [id,key] of [['QB246','B'],['QB246','C'],['QB185','C'],['QB185','D']])assert.throws(()=>validateSubmission({version:'2.10',answers:{...f.answers,[id]:key},seconds:f.seconds,submissionId:randomUUID()}));
});

test('final reference audit exactly matches report rows without changing the legacy reference model',()=>{const audit=JSON.parse(fs.readFileSync(new URL('../private/reference-audit-v2.10.json',import.meta.url)));const f=fixtures.rows[0],report=calculateReport(f.answers,f.seconds);for(const row of [...report.totals,...report.dimensions])assert.deepEqual(fields(row),audit.references[row.code],row.code);assert.equal(old.presentation.referenceOverrides.SJ1.upper,99.9);assert.equal(report.dimensions.find(r=>r.code==='SJ1').upper,99.3);const details=answerDetails('2.10',{QB246:'D'},current.fingerprint);assert.match(details.questions.find(q=>q.number===41).answerText,/^B ·/);assert.match(answerDetails('2.9',{QB246:'D'},old.fingerprint).questions.find(q=>q.number===41).answerText,/^D ·/);});
