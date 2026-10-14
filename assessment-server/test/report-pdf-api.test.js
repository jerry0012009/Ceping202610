import {acceptCurrentNotice} from './consent-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createApplication} from '../server.js';
import {pdfDisposition,PDF_REVISION} from '../report-pdf.js';

// These fixtures contain only synthetic answers and accounts.
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.11-40.json',import.meta.url))).rows[0];
const legacyFixture=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)))[0];
const hasPdfText=spawnSync('pdftotext',['-v']).status===0;
function assertPdf(response){
 assert.equal(response.status,200,response.body.toString('utf8').slice(0,500));
 assert.match(response.headers.get('content-type'),/^application\/pdf(?:;|$)/i);
 assert.match(response.headers.get('cache-control'),/(?:^|[,\s])no-store(?:$|[,\s])/);
 assert.equal(response.body.subarray(0,5).toString(),'%PDF-');
 assert.equal(response.headers.get('x-report-export-version'),PDF_REVISION);
 const disposition=response.headers.get('content-disposition');
 assert.match(disposition,/^attachment;/i);
 assert.doesNotMatch(disposition,/[\r\n\x00]/);
 const fallback=disposition.match(/(?:^|;)\s*filename="([^"\r\n]+)"/i);
 assert.ok(fallback,'an ASCII fallback filename is present');
 assert.match(fallback[1],/^[\x20-\x7e]+\.pdf$/i);
 assert.doesNotMatch(fallback[1],/[\\/]/);
 const extended=disposition.match(/(?:^|;)\s*filename\*=UTF-8''([^;\s]+)/i);
 assert.ok(extended,'RFC 5987 UTF-8 filename is present');
 const name=decodeURIComponent(extended[1]);
 assert.match(name,/[\u3400-\u9fff]/,'download name retains Chinese text');
 assert.match(name,/\.pdf$/i);
 assert.doesNotMatch(name,/[\x00-\x1f\x7f\\/]/,'download name cannot inject headers or path separators');
}
function pdfText(response){
 const result=spawnSync('pdftotext',['-layout','-','-'],{input:response.body,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,result.stderr?.toString());
 return result.stdout.toString('utf8');
}

test('PDF API enforces owner/admin access and renders trusted stored reports without mutating records',{timeout:120000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assessment-pdf-api-'));
 const env={APP_ORIGIN:'http://localhost:3000',AUTH_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir};
 let instance,server,base;
 const start=async()=>{instance=await createApplication(env);server=instance.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{if(server?.listening)await new Promise(resolve=>server.close(resolve));instance?.db.close();};
 const call=async(route,{cookie,owner,method='GET',body}={})=>{
  const response=await fetch(base+route,{method,headers:{origin:env.APP_ORIGIN,connection:'close',...(cookie?{cookie}:{}),...(owner?{'X-Assessment-Owner':owner}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const bytes=Buffer.from(await response.arrayBuffer());let json;try{json=JSON.parse(bytes.toString('utf8'));}catch{}
  return {status:response.status,headers:response.headers,body:bytes,json,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
 };
 const signup=async(name,email)=>{const response=await call('/api/auth/sign-up/email',{method:'POST',body:{name,email,password:'synthetic-pdf-password-123'}});assert.equal(response.status,200,response.body.toString());return {cookie:response.cookie,owner:response.json.user.id};};
 const record=id=>({...instance.db.prepare('SELECT * FROM assessments WHERE id=?').get(id)});
 const audit=()=>instance.db.prepare('SELECT * FROM admin_audit ORDER BY created_at,id').all().map(row=>({...row}));
 try{
  await start();
  const owner=await signup('合成报告用户','pdf-owner@example.test');
  const admin=await signup('Synthetic PDF Admin','pdf-admin@example.test');
  const other=await signup('Synthetic PDF Other','pdf-other@example.test');
  await acceptCurrentNotice(base,owner.cookie,env.APP_ORIGIN);
  const saved=await call('/api/assessments',{...owner,method:'POST',body:{version:'2.11',answers:fixture.answers,seconds:fixture.seconds,submissionId:randomUUID()}});
  assert.equal(saved.status,201,saved.body.toString());
  const id=saved.json.id,ownerRoute=`/api/assessments/${id}/pdf`,adminRoute=`/api/admin/assessments/${id}/pdf`;
  const original=record(id);

  await t.test('anonymous, unrelated owner, and unbound administrator cannot export',async()=>{
   for(const route of [ownerRoute,adminRoute])assert.equal((await call(route)).status,401);
   assert.equal((await call(ownerRoute,other)).status,404);
   assert.equal((await call(ownerRoute,admin)).status,404);
   assert.equal((await call(adminRoute,admin)).status,403);
   assert.equal((await call(adminRoute,owner)).status,403);
   assert.equal(audit().length,0,'denied requests do not record successful exports');
   assert.deepEqual(record(id),original);
  });

  env.ADMIN_USER_ID=admin.owner;await stop();await start();
  // Fail even a same-value rewrite, not merely changes observable in the final snapshot.
  for(const table of ['assessments','drafts'])for(const operation of ['INSERT','UPDATE','DELETE'])instance.db.exec(`CREATE TEMP TRIGGER pdf_read_only_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'PDF exports must be read-only'); END`);
  await t.test('owner receives an attachment with Chinese filename; forged scores and identity are ignored',async()=>{
   assert.equal((await call(ownerRoute,{...owner,owner:other.owner})).status,401,'stale account-bound download request is rejected');
   const clean=await call(ownerRoute,owner);assertPdf(clean);
   const forged=new URLSearchParams({score:'999999.9',PF:'999999.9',name:'FORGED_QUERY_OWNER',email:'forged-query@example.test',version:'future',report:JSON.stringify({totals:[{code:'PF',score:999999.9}]})});
   const altered=await call(ownerRoute+'?'+forged,owner);assertPdf(altered);
   assert.equal(altered.headers.get('content-disposition'),clean.headers.get('content-disposition'));
   if(hasPdfText){
    const text=pdfText(clean);assert.equal(pdfText(altered),text,'query data cannot change rendered report');
    assert.match(text,/合成报告用户/);
    assert.doesNotMatch(text,/FORGED_QUERY_OWNER|forged-query@example\.test|999999\.9|internalEvidence/);
   }else t.diagnostic('pdftotext is unavailable; semantic PDF text comparison was not run');
   assert.deepEqual(record(id),original,'successful exports leave the entire stored assessment unchanged');
   assert.equal(audit().length,0,'owner exports do not create administrator audit events');
  });

  await t.test('bound administrator can export the report owner and produces ID-only audit metadata',async()=>{
   assert.equal((await call(adminRoute,{...admin,owner:owner.owner})).status,401,'administrator account-switch guard is enforced');
   const response=await call(adminRoute,admin);assertPdf(response);
   if(hasPdfText){const text=pdfText(response);assert.match(text,/合成报告用户/);assert.doesNotMatch(text,/Synthetic PDF Admin|pdf-admin@example\.test/);}
   const rows=audit();assert.equal(rows.length,1);
   assert.deepEqual(Object.keys(rows[0]),['id','admin_id','action','report_id','created_at']);
   assert.equal(rows[0].admin_id,admin.owner);assert.equal(rows[0].report_id,id);assert.equal(rows[0].action,'export-pdf');
   assert.ok(Number.isFinite(Date.parse(rows[0].created_at)));assert.ok(rows[0].id);
   assert.doesNotMatch(JSON.stringify(rows),/answers|seconds|score|pdf-owner@example|合成报告用户/);
   assert.deepEqual(record(id),original);
   assert.equal((await call(adminRoute,other)).status,403);
   assert.equal((await call('/api/admin/assessments/'+randomUUID()+'/pdf',admin)).status,404);
   assert.equal((await call('/api/assessments/'+randomUUID()+'/pdf',owner)).status,404);
   assert.deepEqual(audit(),rows);
  });

  for(const table of ['assessments','drafts'])for(const operation of ['INSERT','UPDATE','DELETE'])instance.db.exec(`DROP TRIGGER pdf_read_only_${table}_${operation}`);

  await t.test('unsupported version/fingerprint and invalid answer records fail closed with 422',async()=>{
   const beforeAudit=audit();
   for(const [column,value]of [['version','unregistered-future'],['fingerprint','unknown-fingerprint'],['answers_json','{}'],['answers_json','{bad-json']]){
    instance.db.prepare(`UPDATE assessments SET ${column}=? WHERE id=?`).run(value,id);
    const damaged=record(id);
    try{
     for(const [route,account]of [[ownerRoute,owner],[adminRoute,admin]]){
      const response=await call(route,account);assert.equal(response.status,422,`${column}: ${response.body.toString()}`);
      assert.doesNotMatch(response.headers.get('content-type')||'',/application\/pdf/);
      assert.equal(response.headers.get('content-disposition'),null);
      assert.ok(response.json?.error);assert.equal(response.json.report,undefined);
      assert.deepEqual(record(id),damaged,'failed export must not repair or rewrite original evidence');
     }
    }finally{instance.db.prepare(`UPDATE assessments SET ${column}=? WHERE id=?`).run(original[column],id);}
   }
   assert.deepEqual(audit(),beforeAudit,'failed render cannot be audited as a completed export');
  });

  await t.test('historical answer version is retained while current interpretation is exported read-only',async()=>{
   await acceptCurrentNotice(base,owner.cookie,env.APP_ORIGIN);
   const legacy=await call('/api/assessments',{...owner,method:'POST',body:{version:'2.9',answers:legacyFixture.answers,seconds:legacyFixture.seconds,submissionId:randomUUID()}});
   assert.equal(legacy.status,201,legacy.body.toString());
   assert.equal(legacy.json.version,'2.9','the original answer version stays in the API record');
   assert.equal(legacy.json.report.answerVersion,'2.9');
   assert.equal(legacy.json.report.scoringVersion,'2.11');
   assert.equal(legacy.json.report.displayVersion,'2.12');
   const legacyId=legacy.json.id,before=record(legacyId);
   const historical=await call(`/api/assessments/${legacyId}`,owner);
   assert.equal(historical.status,200);
   assert.equal(historical.json.report.answerVersion,'2.9');
   assert.equal(historical.json.report.scoringVersion,'2.11');
   const response=await call(`/api/assessments/${legacyId}/pdf`,owner);assertPdf(response);
   if(hasPdfText){
    const text=pdfText(response);assert.match(text,/V\s*2\.12/);assert.match(text,/合成报告用户/);
    assert.doesNotMatch(text,/V\s*2\.(?:9|10|11)\b|答卷\s*V|计分\s*V|answerVersion|scoringVersion/,'PDF displays only the product release, not internal technical versions');
   }
   assert.deepEqual(record(legacyId),before);
  });

  env.ADMIN_USER_ID='';await stop();await start();
  await t.test('revoking the immutable admin binding immediately revokes PDF access',async()=>{
   assert.equal((await call(adminRoute,admin)).status,403);
   assert.deepEqual(record(id),original);
  });
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('PDF filename strips unsafe account-name characters and encodes RFC 5987 punctuation',()=>{
 const header=pdfDisposition({createdAt:'2026-10-14T00:00:00Z',owner:{name:'合成/\\\r\n\x00\u202e用户: "<>|?* (测试)\'!'}});
 assert.doesNotMatch(header,/[\r\n\x00\u202e]/);
 const encoded=header.match(/filename\*=UTF-8''([^;\s]+)/)?.[1];assert.ok(encoded);
 assert.doesNotMatch(encoded,/[!'()*]/);
 const decoded=decodeURIComponent(encoded);assert.match(decoded,/合成用户/);
 assert.doesNotMatch(decoded,/[\x00-\x1f\x7f\\/:*?"<>|\u202e]/);
 assert.match(decoded,/2026-10-14_V2\.12\.pdf$/);
});
