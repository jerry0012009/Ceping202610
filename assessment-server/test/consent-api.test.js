import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server.js';
import {CONSENT_NOTICE} from '../consent.js';
import {requireVersion} from '../version-registry.js';
import {createStoredReport} from '../stored-report.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.11-40.json',import.meta.url))).rows[0];
const bank=requireVersion('2.11');
const full=()=>({version:'2.11',answers:fixture.answers,seconds:fixture.seconds,submissionId:randomUUID()});
const draft=position=>{const ids=bank.pages.slice(0,position).flat();return {version:'2.11',position,answers:Object.fromEntries(Object.entries(fixture.answers).filter(([id])=>ids.includes(id))),seconds:Object.fromEntries(Object.entries(fixture.seconds).filter(([id])=>ids.includes(id)))};};
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))):value;

async function harness(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assessment-consent-'));
 const env={APP_ORIGIN:'http://localhost:3000',AUTH_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir};
 let instance,server,base;
 const start=async()=>{instance=await createApplication(env);server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{if(server?.listening){await new Promise(resolve=>server.close(resolve));instance.db.close();}};
 t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
 await start();
 const call=async(route,{method='GET',body,cookie,owner,origin=env.APP_ORIGIN}={})=>{
  const response=await fetch(base+route,{method,headers:{origin,connection:'close',...(cookie?{cookie}:{}),...(owner?{'X-Assessment-Owner':owner}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const bytes=Buffer.from(await response.arrayBuffer());let json;try{json=JSON.parse(bytes.toString());}catch{}
  return {status:response.status,json,bytes,headers:response.headers,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
 };
 const signup=async(name)=>{const response=await call('/api/auth/sign-up/email',{method:'POST',body:{name:'Synthetic '+name,email:name+'@example.test',password:'synthetic-consent-password-123'}});assert.equal(response.status,200,response.bytes.toString());return {cookie:response.cookie,owner:response.json.user.id};};
 const accept=async account=>{
  const status=await call('/api/consent',account);assert.equal(status.status,200);
  const result=await call('/api/consent',{...account,method:'POST',body:{version:status.json.notice.version,accepted:true}});assert.ok([200,201].includes(result.status),result.bytes.toString());return result;
 };
 return {call,signup,accept,start,stop,get db(){return instance.db;},file:path.join(dir,'assessment.sqlite')};
}

test('explicit authenticated acceptance is server recorded, scoped to one attempt, and cannot be forged',{timeout:60000},async t=>{
 const h=await harness(t),a=await h.signup('consent-a'),b=await h.signup('consent-b');
 const count=()=>h.db.prepare('SELECT COUNT(*) n FROM consent_records').get().n;
 const acceptBody={version:CONSENT_NOTICE.version,accepted:true};
 assert.equal((await h.call('/api/consent')).status,401);
 assert.equal((await h.call('/api/consent',{method:'POST',body:acceptBody})).status,401);
 const initial=await h.call('/api/consent',a);
 assert.deepEqual(initial.json,{notice:CONSENT_NOTICE,consent:null,required:true});
 assert.equal(initial.headers.get('cache-control'),'no-store');assert.equal(count(),0);
 assert.equal((await h.call('/api/consent',{...a,owner:undefined,method:'POST',body:acceptBody})).status,409);
 assert.equal((await h.call('/api/consent',{...b,owner:a.owner,method:'POST',body:acceptBody})).status,401);
 assert.equal((await h.call('/api/consent',{...a,origin:'https://evil.example',method:'POST',body:acceptBody})).status,403);
 for(const body of [{version:CONSENT_NOTICE.version,accepted:false},{version:CONSENT_NOTICE.version,accepted:'true'},{accepted:true},{...acceptBody,acceptedAt:'1999-01-01T00:00:00Z'},{...acceptBody,notice_text:'forged'},{...acceptBody,user_id:b.owner},{...acceptBody,id:randomUUID()},{...acceptBody,consentId:randomUUID()}])assert.equal((await h.call('/api/consent',{...a,method:'POST',body})).status,400,JSON.stringify(body));
 assert.equal((await h.call('/api/consent',{...a,method:'POST',body:{version:'notice-v2.11-old',accepted:true}})).status,409);
 assert.equal(count(),0,'no denied or invalid request creates acceptance evidence');
 for(const [route,method,body]of [['/api/draft','PUT',draft(1)],['/api/assessments','POST',full()]]){
  const response=await h.call(route,{...a,method,body});assert.equal(response.status,403);assert.equal(response.json.code,'CONSENT_REQUIRED');
 }
 const before=Date.now(),accepted=await h.accept(a),after=Date.now(),consent=accepted.json.consent;
 assert.equal(accepted.status,201);assert.ok(Date.parse(consent.acceptedAt)>=before&&Date.parse(consent.acceptedAt)<=after);
 assert.equal(consent.version,CONSENT_NOTICE.version);assert.ok(consent.id);assert.equal(count(),1);
 assert.deepEqual({...h.db.prepare('SELECT * FROM consent_records WHERE id=?').get(consent.id)},{id:consent.id,user_id:a.owner,notice_version:CONSENT_NOTICE.version,notice_text:CONSENT_NOTICE.text,accepted_at:consent.acceptedAt});
 const repeated=await h.accept(a);assert.equal(repeated.status,200);assert.deepEqual(repeated.json.consent,consent);assert.equal(count(),1);
 assert.deepEqual((await h.call('/api/consent',a)).json,{notice:CONSENT_NOTICE,consent,required:false});
 assert.deepEqual((await h.call('/api/consent',b)).json,{notice:CONSENT_NOTICE,consent:null,required:true});
 assert.equal((await h.call('/api/draft',{...b,method:'PUT',body:draft(1)})).status,403,'another account cannot borrow the acceptance');
 assert.equal((await h.call('/api/draft',{...b,method:'PUT',body:{...draft(1),consentId:consent.id}})).status,403,'a forged consent field cannot unlock another account');
 assert.equal((await h.call('/api/draft',{...a,method:'PUT',body:draft(1)})).status,200);
 const originalDraft=(await h.call('/api/draft',a)).json.draft;
 await h.stop();await h.start();
 assert.deepEqual((await h.call('/api/consent',a)).json.consent,consent,'draft consent persists across restart');
 assert.deepEqual((await h.call('/api/draft',a)).json.draft,originalDraft);
 const body=full();assert.equal((await h.call('/api/assessments',{...a,method:'POST',body})).status,409,'failed completion must preserve active acceptance');
 assert.deepEqual((await h.call('/api/consent',a)).json.consent,consent);
 for(let position=2;position<=bank.pages.length;position++)assert.equal((await h.call('/api/draft',{...a,method:'PUT',body:draft(position)})).status,200);
 const completed=await h.call('/api/assessments',{...a,method:'POST',body});assert.equal(completed.status,201,completed.bytes.toString());
 const assessmentId=completed.json.id;
 assert.deepEqual({...h.db.prepare('SELECT * FROM assessment_consents WHERE assessment_id=?').get(assessmentId)},{assessment_id:assessmentId,consent_id:consent.id});
 assert.equal((await h.call('/api/consent',a)).json.required,true);assert.equal(count(),1);
 assert.equal((await h.call('/api/assessments',{...a,method:'POST',body:full()})).status,403,'a new assessment requires a new acceptance');
 assert.equal((await h.call('/api/assessments',{...a,method:'POST',body})).status,200,'saved idempotent retries do not require new consent');
 assert.equal(count(),1);assert.equal((await h.call('/api/assessments/'+assessmentId,a)).status,200);
 const pdf=await h.call('/api/assessments/'+assessmentId+'/pdf',a);assert.equal(pdf.status,200);assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');assert.equal(count(),1);
 const next=await h.accept(a);assert.notEqual(next.json.consent.id,consent.id);assert.equal(count(),2);
 assert.equal((await h.call('/api/draft',{...a,method:'DELETE'})).status,200,'new-start or cancellation invalidates an unused active acceptance even without a draft');
 assert.equal((await h.call('/api/consent',a)).json.required,true);assert.equal(count(),2,'reset preserves audit evidence');
 assert.equal((await h.call('/api/draft',{...a,method:'PUT',body:draft(1)})).status,403);
 assert.equal((await h.call('/api/assessments',{...a,method:'POST',body})).status,200,'old retry remains harmless after resetting a different attempt');
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,1);
});

test('additive migration preserves historical rows and never backfills consent for old reports or drafts',{timeout:60000},async t=>{
 const h=await harness(t),a=await h.signup('consent-legacy');
 const body=full(),assessmentId=randomUUID(),oldTime='2025-01-02T03:04:05.000Z';
 const requestHash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
 const stored=createStoredReport(body.answers,body.seconds,undefined,body.version),partial=draft(1);
 // Synthetic fixture for the pre-consent schema, not a product bypass.
 h.db.prepare('INSERT INTO assessments VALUES (?,?,?,?,?,?,?,?,?,?)').run(assessmentId,a.owner,body.submissionId,body.version,bank.fingerprint,oldTime,requestHash,JSON.stringify(body.answers),JSON.stringify(body.seconds),JSON.stringify(stored));
 h.db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?,?)').run(a.owner,partial.version,partial.position,JSON.stringify(partial.answers),JSON.stringify(partial.seconds),oldTime);
 const oldAssessment={...h.db.prepare('SELECT * FROM assessments').get()},oldDraft={...h.db.prepare('SELECT * FROM drafts').get()};
 const assessmentColumns=h.db.prepare('PRAGMA table_info(assessments)').all().map(row=>({...row})),draftColumns=h.db.prepare('PRAGMA table_info(drafts)').all().map(row=>({...row}));
 await h.stop();
 const previous=new DatabaseSync(h.file);previous.exec('DROP TABLE assessment_consents; DROP TABLE active_consents; DROP TABLE consent_records;');previous.close();
 await h.start();
 assert.deepEqual({...h.db.prepare('SELECT * FROM assessments').get()},oldAssessment);
 assert.deepEqual({...h.db.prepare('SELECT * FROM drafts').get()},oldDraft);
 assert.deepEqual(h.db.prepare('PRAGMA table_info(assessments)').all().map(row=>({...row})),assessmentColumns);
 assert.deepEqual(h.db.prepare('PRAGMA table_info(drafts)').all().map(row=>({...row})),draftColumns);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM drafts').get().n,1);
 for(const table of ['consent_records','active_consents','assessment_consents'])assert.equal(h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
 assert.equal((await h.call('/api/consent',a)).json.required,true);
 assert.equal((await h.call('/api/assessments/'+assessmentId,a)).status,200);
 assert.equal((await h.call('/api/assessments/'+assessmentId+'/pdf',a)).status,200);
 assert.equal((await h.call('/api/assessments',{...a,method:'POST',body})).status,200);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM consent_records').get().n,0,'history and retry cannot fabricate acceptance');
 assert.equal((await h.call('/api/draft',{...a,method:'PUT',body:draft(2)})).status,403,'old drafts require current explicit agreement before continuing');
 assert.deepEqual({...h.db.prepare('SELECT * FROM drafts').get()},oldDraft);
 const now=Date.now(),accepted=await h.accept(a);assert.ok(Date.parse(accepted.json.consent.acceptedAt)>=now);assert.notEqual(accepted.json.consent.acceptedAt,oldTime);
 assert.equal((await h.call('/api/draft',{...a,method:'PUT',body:draft(2)})).status,200);
 assert.deepEqual({...h.db.prepare('SELECT * FROM assessments').get()},oldAssessment);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,0,'acceptance to resume a draft never attaches to an old completed report');
});
