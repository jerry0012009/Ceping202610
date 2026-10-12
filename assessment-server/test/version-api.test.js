import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomBytes,randomUUID} from 'node:crypto';
import {requireVersion} from '../version-registry.js';import {calculateReport} from '../scoring.js';
const old=requireVersion('2.9'),current=requireVersion('2.10');
const oldFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)))[0];
const newFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.10-40.json',import.meta.url))).rows[0];
import {createApplication} from '../server.js';
test('real SQLite API pins old drafts, starts 2.10, isolates users and preserves historical reports',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'versions-')),origin='http://localhost:3000';const instance=await createApplication({APP_ORIGIN:origin,AUTH_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir});const server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{const call=async(route,{method='GET',body,cookie,owner}={})=>{const r=await fetch(base+route,{method,headers:{origin,connection:'close',...(cookie?{cookie}:{}),...(owner?{'X-Assessment-Owner':owner}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text);}catch{}return {status:r.status,json,text,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};};
 const sign=async email=>{const r=await call('/api/auth/sign-up/email',{method:'POST',body:{name:'Version Test',email,password:'version-test-pass-123'}});assert.equal(r.status,200,r.text);return {cookie:r.cookie,id:r.json.user.id};};
 const owner=await sign('version-owner@example.test'),other=await sign('version-other@example.test');
 const request=(path,options={})=>call(path,{cookie:owner.cookie,owner:owner.id,...options});
 const latest=await request('/api/questionnaire');assert.equal(latest.status,200);assert.equal(latest.json.version,'2.10');assert.deepEqual(latest.json.questions.find(q=>q.id==='QB246').options.map(o=>o.key),['A','D']);
 const archived=await request('/api/questionnaire?version=2.9');assert.equal(archived.json.version,'2.9');assert.equal(archived.json.questions.find(q=>q.id==='QB246').options.length,4);assert.equal((await request('/api/questionnaire?version=future')).status,422);
 const payload=(entry,fixture,position)=>{const ids=entry.pages.slice(0,position).flat();return {version:entry.version,position,answers:Object.fromEntries(Object.entries(fixture.answers).filter(([id])=>ids.includes(id))),seconds:Object.fromEntries(Object.entries(fixture.seconds).filter(([id])=>ids.includes(id)))};};
 const full=(entry,f)=>({version:entry.version,answers:f.answers,seconds:f.seconds,submissionId:randomUUID()});
 // Simulate an old browser's first save and finish without rewriting any answer or option key.
 let p=payload(old,oldFixture,1);assert.equal((await request('/api/draft',{method:'PUT',body:p})).status,200);
 const draftBefore=(await request('/api/draft')).json.draft;assert.equal(draftBefore.version,'2.9');assert.deepEqual(draftBefore.answers,p.answers);
 assert.equal((await request('/api/draft',{method:'PUT',body:{...payload(current,newFixture,2)}})).status,409);assert.deepEqual((await request('/api/draft')).json.draft,draftBefore);
 assert.equal((await request('/api/assessments',{method:'POST',body:full(current,newFixture)})).status,409);
 for(let position=2;position<=old.pages.length;position++)assert.equal((await request('/api/draft',{method:'PUT',body:payload(old,oldFixture,position)})).status,200);
 const oldBody=full(old,oldFixture),oldSaved=await request('/api/assessments',{method:'POST',body:oldBody});assert.equal(oldSaved.status,201,oldSaved.text);assert.equal(oldSaved.json.report.version,'2.9');assert.equal(oldSaved.json.report.referenceRevision,old.presentation.referenceRevision);assert.deepEqual(oldSaved.json.report,calculateReport(oldFixture.answers,oldFixture.seconds,'2.9'));assert.equal((await request('/api/draft')).json.draft,null);
 const retry=await request('/api/assessments',{method:'POST',body:oldBody});assert.equal(retry.status,200);assert.deepEqual(retry.json,oldSaved.json);
 // New form validation rejects removed option keys and omitted version, then saves current-version pages.
 const body=full(current,newFixture);assert.equal((await request('/api/assessments',{method:'POST',body:{...body,version:undefined}})).status,400);assert.equal((await request('/api/assessments',{method:'POST',body:{...body,answers:{...body.answers,QB246:'B'}}})).status,400);
 assert.equal((await request('/api/draft',{method:'PUT',body:payload(current,newFixture,1)})).status,200);assert.equal((await request('/api/draft',{method:'PUT',body:payload(old,oldFixture,2)})).status,409);
 for(let position=2;position<=current.pages.length;position++)assert.equal((await request('/api/draft',{method:'PUT',body:payload(current,newFixture,position)})).status,200);
 const saved=await request('/api/assessments',{method:'POST',body});assert.equal(saved.status,201,saved.text);assert.deepEqual(saved.json.report,calculateReport(newFixture.answers,newFixture.seconds,'2.10'));assert.equal(saved.json.report.referenceRevision,current.presentation.referenceRevision);assert.equal(saved.json.report.workValuePreferences.scoringFingerprint,current.fingerprint);assert.doesNotMatch(saved.text,/internalEvidence|representativeAnswers/);
 assert.equal((await request('/api/assessments/'+saved.json.id,{cookie:other.cookie,owner:other.id})).status,404);assert.equal((await request('/api/admin/assessments/'+saved.json.id,{cookie:other.cookie,owner:other.id})).status,403);assert.deepEqual((await request('/api/assessments/'+oldSaved.json.id)).json,oldSaved.json);assert.equal((await request('/api/assessments')).json.assessments.length,2);
 }finally{await new Promise(resolve=>server.close(resolve));instance.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
