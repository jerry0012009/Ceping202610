import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../server.js';
import {requireVersion} from '../version-registry.js';
import {createStoredReport} from '../stored-report.js';

// Every account, answer, database, secret and CLI target in this suite is synthetic.
// No default DATA_DIR, existing installation database or real account is accessed.
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.11-40.json',import.meta.url))).rows[0];
const bank=requireVersion('2.11');
const full=()=>({version:'2.11',answers:structuredClone(fixture.answers),seconds:structuredClone(fixture.seconds),submissionId:randomUUID()});
const draft=position=>{
 const ids=new Set(bank.pages.slice(0,position).flat());
 return {version:'2.11',position,answers:Object.fromEntries(Object.entries(fixture.answers).filter(([id])=>ids.has(id))),seconds:Object.fromEntries(Object.entries(fixture.seconds).filter(([id])=>ids.has(id)))};
};
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))):value;
let nextSyntheticClient=1;
const plainRows=(db,table)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}));
const assertNoReport=response=>{
 assert.ok(response.json&&typeof response.json.error==='string',response.bytes.toString());
 for(const key of ['report','scores','score','totals','dimensions','answers','id'])assert.equal(Object.hasOwn(response.json,key),false,`failure must not expose ${key}`);
};
const exhausted=response=>{
 assert.equal(response.status,403,response.bytes.toString());
 assert.equal(response.json.code,'QUOTA_EXHAUSTED');
 assertNoReport(response);
};

async function harness(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assessment-quota-test-'));
 // Isolate Better Auth's process-global per-IP signup limiter across fixtures.
 const syntheticClient='192.0.2.'+nextSyntheticClient++;
 const env={APP_ORIGIN:'http://localhost:3000',AUTH_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir,TRUST_PROXY:'loopback'};
 let instance,server,base;
 const peers=[];
 const start=async()=>{
  instance=await createApplication(env);
  server=instance.app.listen(0,'127.0.0.1');
  await once(server,'listening');
  base='http://127.0.0.1:'+server.address().port;
 };
 const stop=async()=>{
  if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  server=undefined;
  if(instance){instance.db.close();instance=undefined;}
 };
 t.after(async()=>{
  for(const peer of peers){
   if(peer.exitCode===null&&peer.signalCode===null){const closed=once(peer,'close');peer.kill('SIGTERM');await closed;}
  }
  await stop();
  fs.rmSync(dir,{recursive:true,force:true});
 });
 await start();
 const call=async(route,{method='GET',body,cookie,owner,origin=env.APP_ORIGIN,endpoint=base,headers={}}={})=>{
  const response=await fetch(endpoint+route,{method,headers:{origin,connection:'close','x-forwarded-for':syntheticClient,...(cookie?{cookie}:{}),...(owner?{'X-Assessment-Owner':owner}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const bytes=Buffer.from(await response.arrayBuffer());let json;try{json=JSON.parse(bytes.toString());}catch{}
  return {status:response.status,json,bytes,headers:response.headers,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
 };
 const signup=async(name)=>{
  const response=await call('/api/auth/sign-up/email',{method:'POST',body:{name:'Synthetic '+name,email:name+'@example.test',password:'synthetic-quota-password-123'}});
  assert.equal(response.status,200,response.bytes.toString());
  return {cookie:response.cookie,owner:response.json.user.id};
 };
 const accept=async account=>{
  const notice=await call('/api/consent',account);assert.equal(notice.status,200);
  const response=await call('/api/consent',{...account,method:'POST',body:{version:notice.json.notice.version,accepted:true}});
  assert.ok([200,201].includes(response.status),response.bytes.toString());
  return response.json.consent;
 };
 const setQuota=(remaining,mode='trial')=>assert.equal(instance.db.prepare('UPDATE assessment_quota SET remaining=?,mode=? WHERE id=1').run(remaining,mode).changes,1);
 const quota=()=>({...instance.db.prepare('SELECT * FROM assessment_quota WHERE id=1').get()});
 const saveDraft=async(account,through=bank.pages.length)=>{
  for(let position=1;position<=through;position++){
   const saved=await call('/api/draft',{...account,method:'PUT',body:draft(position)});
   assert.equal(saved.status,200,`page ${position}: ${saved.bytes.toString()}`);
  }
 };
 // A separate Node process is essential: separate SQLite connections in one event
 // loop would serialize synchronous handlers and could hide a real writer race.
 const startPeer=async()=>{
  const source=`import {createApplication} from ${JSON.stringify(new URL('../server.js',import.meta.url).href)};
   const {app,db}=await createApplication();
   const server=app.listen(0,'127.0.0.1',()=>console.log('QUOTA_PEER_URL=http://127.0.0.1:'+server.address().port));
   process.once('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));`;
  const peer=spawn(process.execPath,['--input-type=module','-e',source],{cwd:root,env:{PATH:process.env.PATH,...env},stdio:['ignore','pipe','pipe']});
  peers.push(peer);
  return new Promise((resolve,reject)=>{
   let output='',errors='';
   const timer=setTimeout(()=>{peer.kill('SIGTERM');reject(new Error('Quota peer did not start: '+errors));},15000);
   peer.stderr.on('data',chunk=>{errors+=chunk;});
   peer.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/QUOTA_PEER_URL=(http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
   peer.once('error',error=>{clearTimeout(timer);reject(error);});
   peer.once('exit',code=>{clearTimeout(timer);if(!output.includes('QUOTA_PEER_URL='))reject(new Error(`Quota peer exited ${code}: ${errors}`));});
  });
 };
 return {dir,env,start,stop,call,signup,accept,setQuota,quota,saveDraft,startPeer,file:path.join(dir,'assessment.sqlite'),get db(){return instance.db;}};
}

test('quota initializes once to trial/10, requires authentication, and GET is read-only',{timeout:60000},async t=>{
 const h=await harness(t);
 assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:10});
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_quota').get().n,1);
 assert.equal((await h.call('/api/quota')).status,401);
 const account=await h.signup('quota-initial');
 for(const operation of ['INSERT','UPDATE','DELETE'])h.db.exec(`CREATE TEMP TRIGGER quota_no_${operation} BEFORE ${operation} ON assessment_quota BEGIN SELECT RAISE(ABORT,'GET must not change quota'); END`);
 for(let i=0;i<3;i++){
  const response=await h.call('/api/quota',account);
  assert.equal(response.status,200,response.bytes.toString());
  assert.deepEqual(response.json,{mode:'trial',canStart:true,remaining:10});
  assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:10});
 await h.stop();await h.start();
 h.setQuota(3,'paid');
 // Restart is not a fresh install, even when an unrelated env setting changes.
 h.env.QUOTA_REMAINING='999';h.env.QUOTA_MODE='trial';
 await h.stop();await h.start();
 assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:3});
 assert.deepEqual((await h.call('/api/quota',account)).json,{mode:'paid',canStart:true});
 h.setQuota(0);await h.stop();await h.start();
 assert.deepEqual((await h.call('/api/quota',account)).json,{mode:'trial',canStart:false,remaining:0});
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_quota').get().n,1);
});

test('paid remaining is visible only to the bound admin and HTTP offers no quota mutations',{timeout:60000},async t=>{
 const h=await harness(t),normal=await h.signup('quota-normal'),admin=await h.signup('quota-admin');
 h.env.ADMIN_USER_ID=admin.owner;await h.stop();await h.start();h.setQuota(17,'paid');
 assert.equal((await h.call('/api/me',admin)).json.user.isAdmin,true);
 assert.deepEqual((await h.call('/api/quota',normal)).json,{mode:'paid',canStart:true});
 assert.deepEqual((await h.call('/api/quota',admin)).json,{mode:'paid',canStart:true,remaining:17});
 const spoof=await h.call('/api/quota?admin=true&isAdmin=true&remaining=999',{...normal,headers:{'X-Admin-User-Id':admin.owner}});
 assert.deepEqual(spoof.json,{mode:'paid',canStart:true},'query and administrative headers cannot grant admin visibility');
 const staleOwner=await h.call('/api/quota',{...normal,owner:admin.owner});
 assert.equal(staleOwner.status,401);assert.equal(Object.hasOwn(staleOwner.json,'remaining'),false);
 for(const account of [normal,admin])for(const route of ['/api/quota','/api/admin/quota'])for(const method of ['POST','PUT','PATCH','DELETE']){
  const response=await h.call(route,{...account,method,body:{mode:'paid',remaining:999,add:999}});
  assert.ok([403,404,405].includes(response.status),`${method} ${route}: ${response.status}`);
  assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:17});
 }
 h.setQuota(0,'paid');
 assert.deepEqual((await h.call('/api/quota',normal)).json,{mode:'paid',canStart:false});
 assert.deepEqual((await h.call('/api/quota',admin)).json,{mode:'paid',canStart:false,remaining:0});
 h.env.ADMIN_USER_ID='';await h.stop();await h.start();
 assert.deepEqual((await h.call('/api/quota',admin)).json,{mode:'paid',canStart:false},'revocation removes count visibility on the next session read');
});

test('successful trial completion consumes one; zero-quota equivalent retries return the saved report and mismatch stays 409',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-retry');
 h.setQuota(1);await h.accept(account);await h.saveDraft(account);
 const body=full(),saved=await h.call('/api/assessments',{...account,method:'POST',body});
 assert.equal(saved.status,201,saved.bytes.toString());assert.ok(saved.json.report);
 assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:0});
 assert.equal((await h.call('/api/draft',account)).json.draft,null);
 assert.equal((await h.call('/api/consent',account)).json.required,true);
 const rows=plainRows(h.db,'assessments'),consents=plainRows(h.db,'assessment_consents');
 const reordered={submissionId:body.submissionId,seconds:Object.fromEntries(Object.entries(body.seconds).reverse()),answers:Object.fromEntries(Object.entries(body.answers).reverse()),version:body.version};
 for(const retry of [body,reordered]){
  const response=await h.call('/api/assessments',{...account,method:'POST',body:retry});
  assert.equal(response.status,200,response.bytes.toString());assert.deepEqual(response.json,saved.json);
 }
 const changed=structuredClone(body),timed=Object.keys(changed.seconds)[0];changed.seconds[timed]+=1;
 const mismatch=await h.call('/api/assessments',{...account,method:'POST',body:changed});
 assert.equal(mismatch.status,409,mismatch.bytes.toString());assertNoReport(mismatch);
 assert.deepEqual(plainRows(h.db,'assessments'),rows);assert.deepEqual(plainRows(h.db,'assessment_consents'),consents);
 assert.equal(h.quota().remaining,0);
 await h.stop();await h.start();
 const retried=await h.call('/api/assessments',{...account,method:'POST',body});
 assert.equal(retried.status,200);assert.deepEqual(retried.json,saved.json);assert.equal(h.quota().remaining,0);
});

test('paid mode also consumes one and refuses a new completed submission at zero without revealing scores or balance',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-paid');h.setQuota(1,'paid');await h.accept(account);
 const saved=await h.call('/api/assessments',{...account,method:'POST',body:full()});
 assert.equal(saved.status,201,saved.bytes.toString());assert.equal(h.quota().remaining,0);
 await h.accept(account);
 const response=await h.call('/api/assessments',{...account,method:'POST',body:full()});exhausted(response);
 assert.equal(Object.hasOwn(response.json,'remaining'),false);
 const questionnaire=await h.call('/api/questionnaire',account);exhausted(questionnaire);
 assert.equal(Object.hasOwn(questionnaire.json,'questions'),false);
 assert.equal(Object.hasOwn(questionnaire.json,'remaining'),false);
 assert.deepEqual((await h.call('/api/quota',account)).json,{mode:'paid',canStart:false});
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);
});

test('unauthenticated, malformed, unauthorized and incomplete submissions do not consume allowance',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-invalid'),other=await h.signup('quota-invalid-other');
 const body=full();
 const denied=[
  [{method:'POST',body},401],
  [{cookie:account.cookie,method:'POST',body},409],
  [{...account,owner:other.owner,method:'POST',body},401],
  [{...account,method:'POST',body,origin:'https://evil.example'},403],
  [{...account,method:'POST',body},403]
 ];
 for(const [options,status]of denied){const response=await h.call('/api/assessments',options);assert.equal(response.status,status,response.bytes.toString());assertNoReport(response);assert.equal(h.quota().remaining,10);}
 await h.accept(account);
 for(const invalid of [null,[],{}, {...body,version:'missing-version'},{...body,answers:{}},{...body,submissionId:'invalid'},{...body,remaining:999},{...body,mode:'paid'}]){
  const response=await h.call('/api/assessments',{...account,method:'POST',body:invalid});
  assert.equal(response.status,400,response.bytes.toString());assertNoReport(response);assert.equal(h.quota().remaining,10);
 }
 await h.saveDraft(account,1);
 const originalDraft=plainRows(h.db,'drafts'),originalConsent=plainRows(h.db,'active_consents');
 const incomplete=await h.call('/api/assessments',{...account,method:'POST',body});
 assert.equal(incomplete.status,409,incomplete.bytes.toString());assertNoReport(incomplete);
 assert.equal(h.quota().remaining,10);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,0);
 assert.deepEqual(plainRows(h.db,'drafts'),originalDraft);assert.deepEqual(plainRows(h.db,'active_consents'),originalConsent);
});

test('zero allowance blocks questionnaires and completion but preserves draft reads and ordered saves across restart',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-draft-zero');await h.accept(account);await h.saveDraft(account,1);
 const first=(await h.call('/api/draft',account)).json.draft;h.setQuota(0);
 exhausted(await h.call('/api/questionnaire',account));
 assert.deepEqual((await h.call('/api/draft',account)).json.draft,first);
 for(let position=2;position<=bank.pages.length;position++){
  const response=await h.call('/api/draft',{...account,method:'PUT',body:draft(position)});
  assert.equal(response.status,200,response.bytes.toString());assert.equal(h.quota().remaining,0);
 }
 const savedDraft=plainRows(h.db,'drafts'),consents=plainRows(h.db,'active_consents');
 const body=full();exhausted(await h.call('/api/assessments',{...account,method:'POST',body}));
 assert.deepEqual(plainRows(h.db,'drafts'),savedDraft);assert.deepEqual(plainRows(h.db,'active_consents'),consents);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,0);
 await h.stop();await h.start();
 assert.deepEqual(plainRows(h.db,'drafts'),savedDraft);assert.equal(h.quota().remaining,0);
 assert.equal((await h.call('/api/draft',{...account,method:'PUT',body:draft(bank.pages.length)})).status,200,'same-page retries remain harmless');
 assert.deepEqual((await h.call('/api/assessments',account)).json,{assessments:[]});
 // A trusted allowance adjustment resumes the exact saved attempt, without new consent.
 h.setQuota(1);
 assert.equal((await h.call('/api/questionnaire',account)).status,200);
 const finished=await h.call('/api/assessments',{...account,method:'POST',body});assert.equal(finished.status,201,finished.bytes.toString());
 assert.equal(h.quota().remaining,0);assert.equal((await h.call('/api/draft',account)).json.draft,null);
});

test('owner and admin can still read history and download real PDFs at zero without changing saved assessments',{timeout:120000},async t=>{
 const h=await harness(t),owner=await h.signup('quota-pdf-owner'),admin=await h.signup('quota-pdf-admin'),other=await h.signup('quota-pdf-other');
 await h.accept(owner);
 const saved=await h.call('/api/assessments',{...owner,method:'POST',body:full()});assert.equal(saved.status,201,saved.bytes.toString());
 const id=saved.json.id;h.env.ADMIN_USER_ID=admin.owner;await h.stop();await h.start();h.setQuota(0,'paid');
 const before=plainRows(h.db,'assessments');
 for(const table of ['assessments','drafts','assessment_quota'])for(const operation of ['INSERT','UPDATE','DELETE'])h.db.exec(`CREATE TEMP TRIGGER zero_readonly_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'history must be read-only'); END`);
 assert.equal((await h.call('/api/assessments',owner)).json.assessments[0].id,id);
 assert.equal((await h.call('/api/admin/assessments',admin)).json.assessments[0].id,id);
 for(const [route,account]of [[`/api/assessments/${id}`,owner],[`/api/admin/assessments/${id}`,admin]]){
  const detail=await h.call(route,account);assert.equal(detail.status,200,detail.bytes.toString());assert.deepEqual(detail.json.report,saved.json.report);
  const pdf=await h.call(route+'/pdf',account);assert.equal(pdf.status,200,pdf.bytes.toString().slice(0,300));
  assert.match(pdf.headers.get('content-type'),/^application\/pdf(?:;|$)/);assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');
  assert.match(pdf.headers.get('content-disposition'),/^attachment;/);assert.equal(pdf.headers.get('cache-control'),'no-store');
  assert.ok(pdf.bytes.length>1000,'the endpoint returned an actual rendered PDF');
 }
 assert.equal((await h.call(`/api/assessments/${id}`,other)).status,404);
 assert.equal((await h.call(`/api/assessments/${id}/pdf`,other)).status,404);
 assert.equal((await h.call(`/api/admin/assessments/${id}/pdf`,owner)).status,403);
 assert.equal((await h.call(`/api/assessments/${id}/pdf`)).status,401);
 assert.deepEqual(plainRows(h.db,'assessments'),before);assert.equal(h.quota().remaining,0);
});

test('SQL insertion and post-insertion failures roll back quota, report, draft deletion and consent consumption',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-rollback');await h.accept(account);await h.saveDraft(account);h.setQuota(1);
 const body=full(),beforeDrafts=plainRows(h.db,'drafts'),beforeConsent=plainRows(h.db,'active_consents');
 for(const table of ['assessments','assessment_consents']){
  h.db.exec(`CREATE TEMP TRIGGER quota_fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic insertion failure'); END`);
  try{
   const response=await h.call('/api/assessments',{...account,method:'POST',body});
   assert.equal(response.status,500,response.bytes.toString());assertNoReport(response);
   assert.equal(h.quota().remaining,1,'debit is rolled back even if an earlier statement already ran');
   assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,0);
   assert.deepEqual(plainRows(h.db,'drafts'),beforeDrafts);assert.deepEqual(plainRows(h.db,'active_consents'),beforeConsent);
  }finally{h.db.exec('DROP TRIGGER quota_fail_insert');}
 }
 const saved=await h.call('/api/assessments',{...account,method:'POST',body});assert.equal(saved.status,201,saved.bytes.toString());
 assert.equal(h.quota().remaining,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,1);
 assert.deepEqual(plainRows(h.db,'drafts'),[]);assert.deepEqual(plainRows(h.db,'active_consents'),[]);
});

test('two separate server processes racing for the last allowance produce exactly one report',{timeout:60000},async t=>{
 const h=await harness(t),a=await h.signup('quota-race-a'),b=await h.signup('quota-race-b');await h.accept(a);await h.accept(b);h.setQuota(1);
 const peer=await h.startPeer(),bodies=[full(),full()];
 const responses=await Promise.all([
  h.call('/api/assessments',{...a,method:'POST',body:bodies[0]}),
  h.call('/api/assessments',{...b,method:'POST',body:bodies[1],endpoint:peer})
 ]);
 assert.deepEqual(responses.map(response=>response.status).sort(),[201,403],responses.map(response=>response.bytes.toString()).join('\n'));
 const loser=responses.findIndex(response=>response.status===403);exhausted(responses[loser]);
 assert.equal(h.quota().remaining,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,1);
 assert.equal((await h.call('/api/consent',[a,b][loser])).json.required,false,'losing the quota race does not consume consent');
 assert.deepEqual((await h.call('/api/quota',{...b,endpoint:peer})).json,{mode:'trial',canStart:false,remaining:0});
 assert.deepEqual((await h.call('/api/quota',a)).json,{mode:'trial',canStart:false,remaining:0});
});

test('concurrent identical submissions across processes remain idempotent at the last allowance',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-race-retry');await h.accept(account);h.setQuota(1);
 const peer=await h.startPeer(),body=full();
 const responses=await Promise.all([
  h.call('/api/assessments',{...account,method:'POST',body}),
  h.call('/api/assessments',{...account,method:'POST',body,endpoint:peer})
 ]);
 assert.deepEqual(responses.map(response=>response.status).sort(),[200,201],responses.map(response=>response.bytes.toString()).join('\n'));
 assert.deepEqual(responses[0].json,responses[1].json);assert.equal(h.quota().remaining,0);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessment_consents').get().n,1);
});

test('additive quota migration preserves legacy report/draft bytes and does not retroactively debit old reports',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-legacy'),body=full(),assessmentId=randomUUID(),oldTime='2025-01-02T03:04:05.000Z';
 const requestHash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
 const report=createStoredReport(body.answers,body.seconds,undefined,body.version),partial=draft(1);
 h.db.prepare('INSERT INTO assessments VALUES (?,?,?,?,?,?,?,?,?,?)').run(assessmentId,account.owner,body.submissionId,body.version,bank.fingerprint,oldTime,requestHash,JSON.stringify(body.answers),JSON.stringify(body.seconds),JSON.stringify(report));
 h.db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?,?)').run(account.owner,partial.version,partial.position,JSON.stringify(partial.answers),JSON.stringify(partial.seconds),oldTime);
 const beforeReports=plainRows(h.db,'assessments'),beforeDrafts=plainRows(h.db,'drafts');
 const schemas=Object.fromEntries(['assessments','drafts'].map(table=>[table,h.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>({...row}))]));
 await h.stop();const legacy=new DatabaseSync(h.file);legacy.exec('DROP TABLE assessment_quota');legacy.close();await h.start();
 assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:10},'legacy records do not reduce the initial allowance');
 assert.deepEqual(plainRows(h.db,'assessments'),beforeReports);assert.deepEqual(plainRows(h.db,'drafts'),beforeDrafts);
 for(const table of ['assessments','drafts'])assert.deepEqual(h.db.prepare(`PRAGMA table_info(${table})`).all().map(row=>({...row})),schemas[table]);
 const retry=await h.call('/api/assessments',{...account,method:'POST',body});assert.equal(retry.status,200,retry.bytes.toString());assert.equal(retry.json.id,assessmentId);
 assert.equal(h.quota().remaining,10,'old idempotent retries are not retroactively billed');
 assert.equal((await h.call(`/api/assessments/${assessmentId}`,account)).status,200);
 assert.deepEqual(plainRows(h.db,'assessments'),beforeReports);assert.deepEqual(plainRows(h.db,'drafts'),beforeDrafts);
 h.setQuota(4,'paid');await h.stop();await h.start();assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:4});
 assert.deepEqual(plainRows(h.db,'assessments'),beforeReports);assert.deepEqual(plainRows(h.db,'drafts'),beforeDrafts);
});

test('quota CLI controls only the selected installation, persists mode/balance, and rejects unsafe adjustments',{timeout:60000},async t=>{
 const h=await harness(t),account=await h.signup('quota-cli');await h.accept(account);
 const saved=await h.call('/api/assessments',{...account,method:'POST',body:full()});assert.equal(saved.status,201);
 const records=plainRows(h.db,'assessments');
 const cli=(args=[],directory=h.dir)=>spawnSync(process.execPath,[path.join(root,'scripts/quota.js'),...args],{cwd:root,env:{PATH:process.env.PATH,DATA_DIR:directory},encoding:'utf8',timeout:10000});
 const ok=args=>{const result=cli(args);assert.equal(result.status,0,result.stderr||result.stdout);return result;};
 ok();ok(['--status']);assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:9});
 ok(['--mode','paid','--set','17']);assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:17});
 ok(['--add','3']);assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:20});
 ok(['--mode','trial']);assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:20});
 ok(['--set','0']);assert.deepEqual(h.quota(),{id:1,mode:'trial',remaining:0});
 const invalid=[['--set','-1'],['--add','-1'],['--set','1.5'],['--add','NaN'],['--set','9007199254740992'],['--set','1','--add','2'],['--mode','unknown'],['--set'],['--unexpected']];
 for(const args of invalid){const before=h.quota(),result=cli(args);assert.notEqual(result.status,0,`${args.join(' ')} unexpectedly succeeded`);assert.deepEqual(h.quota(),before,'invalid CLI input cannot mutate quota');}
 ok(['--set',String(Number.MAX_SAFE_INTEGER)]);
 const overflow=cli(['--add','1']);assert.notEqual(overflow.status,0);assert.equal(h.quota().remaining,Number.MAX_SAFE_INTEGER);
 ok(['--mode','paid','--set','8']);
 assert.deepEqual(plainRows(h.db,'assessments'),records,'operator adjustments never rewrite historical results');
 await h.stop();await h.start();assert.deepEqual(h.quota(),{id:1,mode:'paid',remaining:8});assert.deepEqual(plainRows(h.db,'assessments'),records);
 const nonexistent=path.join(h.dir,'uninitialized');fs.mkdirSync(nonexistent,{mode:0o700});
 const missing=cli(['--status'],nonexistent);assert.notEqual(missing.status,0,'a mistaken DATA_DIR must not silently initialize an installation');
 assert.equal(fs.existsSync(path.join(nonexistent,'assessment.sqlite')),false);
});

test('draft submission identity survives refresh/restart and a lost completion response never causes a second debit',{timeout:60000},async t=>{
 const h=await harness(t),owner=await h.signup('quota-resume-owner'),other=await h.signup('quota-resume-other');
 h.setQuota(1);const consent=await h.accept(owner);await h.saveDraft(owner,1);
 const first=(await h.call('/api/draft',owner)).json.draft;
 assert.equal(first.submissionId,consent.id);
 assert.deepEqual((await h.call('/api/draft',owner)).json.draft,first,'re-reading the draft does not mint another submission ID');
 assert.equal((await h.call('/api/draft',other)).json.draft,null,'another account cannot observe this attempt ID');
 await h.stop();await h.start();
 assert.deepEqual((await h.call('/api/draft',owner)).json.draft,first,'the same server-issued ID is restored after restart');
 for(let position=2;position<=bank.pages.length;position++)assert.equal((await h.call('/api/draft',{...owner,method:'PUT',body:draft(position)})).status,200);
 const complete=(await h.call('/api/draft',owner)).json.draft;assert.equal(complete.submissionId,consent.id);
 const body={...full(),submissionId:complete.submissionId};
 const saved=await h.call('/api/assessments',{...owner,method:'POST',body});assert.equal(saved.status,201,saved.bytes.toString());
 assert.equal(h.quota().remaining,0);assert.equal((await h.call('/api/draft',owner)).json.draft,null);
 assert.equal((await h.call('/api/consent',owner)).json.required,true);
 // Model a response lost after commit: refresh has no draft, but history and the
 // previously retained submission ID both recover the same report at zero.
 await h.stop();await h.start();
 const history=await h.call('/api/assessments',owner);assert.equal(history.status,200);assert.deepEqual(history.json.assessments.map(row=>row.id),[saved.json.id]);
 const retry=await h.call('/api/assessments',{...owner,method:'POST',body});assert.equal(retry.status,200,retry.bytes.toString());assert.deepEqual(retry.json,saved.json);
 assert.equal(h.quota().remaining,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);
 assert.deepEqual((await h.call('/api/assessments',other)).json.assessments,[]);
 assert.equal((await h.call(`/api/assessments/${saved.json.id}`,other)).status,404);
 // Explicitly starting over resets only the unfinished attempt; it does not
 // recreate the old report, restore quota, or reuse a consumed submission ID.
 const next=await h.accept(owner);assert.notEqual(next.id,consent.id);await h.saveDraft(owner,1);
 assert.equal((await h.call('/api/draft',owner)).json.draft.submissionId,next.id);
 assert.equal((await h.call('/api/draft',{...owner,method:'DELETE'})).status,200);
 assert.equal((await h.call('/api/draft',owner)).json.draft,null);
 assert.equal((await h.call('/api/consent',owner)).json.required,true);
 const fresh=await h.accept(owner);assert.notEqual(fresh.id,next.id);assert.notEqual(fresh.id,consent.id);
 await h.saveDraft(owner,1);assert.equal((await h.call('/api/draft',owner)).json.draft.submissionId,fresh.id);
 assert.equal(h.quota().remaining,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM assessments').get().n,1);
});
