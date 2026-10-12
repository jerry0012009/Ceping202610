import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApplication} from '../server.js';
import {engine,data,calculateReport,validateSubmission} from './legacy-helpers.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)));
test('all 40 synthetic answer sets exactly equal frozen V2.8 engine numerical baseline; V2.9 references match approved candidate',()=>{
 assert.equal(fixtures.length,40);
 for(const c of fixtures){validateSubmission({version:'2.9',answers:c.answers,seconds:c.seconds,submissionId:randomUUID()});const r=engine.calculate(c.answers,c.seconds);assert.deepEqual({raw:r.raw,reference:r.reference,totals:r.totals},c.expected,c.id);const safe=calculateReport(c.answers,c.seconds);for(const row of safe.dimensions.filter(row=>!row.code.startsWith('WV_')))assert.equal(row.score,r.reference[row.code]);assert.ok(!JSON.stringify(safe).includes('trace'));}
 const ref=JSON.parse(fs.readFileSync(new URL('../private/approved-reference.json',import.meta.url)));assert.deepEqual(engine.defaults(),ref.allParameters);
});
test('HTTP auth, isolation, validation, idempotence, restart and static secrecy',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assessment-test-'));const port=35000+Math.floor(Math.random()*20000),origin=`http://127.0.0.1:${port}`;
 const env={AUTH_SECRET:randomBytes(32).toString('hex'),APP_ORIGIN:origin,DATA_DIR:dir};let instance,server;
 async function start(){instance=await createApplication(env);server=instance.app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));}
 async function stop(){await new Promise(resolve=>server.close(resolve));instance.db.close();}
 async function call(route,{method='GET',body,cookie,customOrigin=origin,expectedOwner}={}){let owner=expectedOwner;if(owner===undefined&&cookie&&['PUT','POST','DELETE'].includes(method)&&!route.startsWith('/api/auth/')){const me=await fetch(origin+'/api/me',{headers:{cookie,connection:'close'}});owner=(await me.json()).user?.id;}const r=await fetch(origin+route,{method,headers:{...(owner?{'X-Assessment-Owner':owner}:{}),connection:'close',...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),origin:customOrigin},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text)}catch{}return{status:r.status,json,text,cookies:r.headers.getSetCookie(),headers:r.headers};}
 const signup=async(email)=>{const r=await call('/api/auth/sign-up/email',{method:'POST',body:{name:'Synthetic Test',email,password:'test-password-strong-123'}});assert.equal(r.status,200,r.text);assert.ok(r.cookies.some(x=>/HttpOnly/i.test(x)&&/SameSite=Lax/i.test(x)));return r.cookies.map(x=>x.split(';')[0]).join('; ');};
 try{
 await start();assert.equal((await call('/api/me')).status,401);assert.equal((await call('/api/questionnaire')).status,401);
 const a=await signup('a@example.com'),b=await signup('b@example.com');assert.equal((await call('/api/me',{cookie:a})).status,200);
 const q=await call('/api/questionnaire',{cookie:a});assert.equal(q.json.questions.length,data.questions.length);assert.ok(!('scores'in q.json.questions[0]));assert.ok(!('coeff'in q.json));
 const body={version:'2.9',answers:fixtures[0].answers,seconds:fixtures[0].seconds,submissionId:randomUUID()};
 assert.equal((await call('/api/assessments',{method:'POST',body,cookie:a,customOrigin:'https://evil.example'})).status,403);
 for(const altered of [{...body,version:'missing'},{...body,score:100},{...body,answers:{...body.answers,QB001:'fake'}},{...body,seconds:{...body.seconds,QB001:-1}},{...body,answers:{...body.answers,unknown:'A'}}])assert.equal((await call('/api/assessments',{method:'POST',body:altered,cookie:a})).status,400);
 const saved=await call('/api/assessments',{method:'POST',body,cookie:a});assert.equal(saved.status,201,saved.text);const id=saved.json.id;assert.equal(saved.json.report.internalEvidence,undefined);assert.ok(JSON.parse(instance.db.prepare('SELECT report_json FROM assessments WHERE id=?').get(id).report_json).internalEvidence,'evidence stored privately');
 const retry=await call('/api/assessments',{method:'POST',body,cookie:a});assert.equal(retry.status,200);assert.deepEqual(retry.json,saved.json);
 assert.equal((await call('/api/assessments',{method:'POST',body:{...body,seconds:{...body.seconds,QB001:1}},cookie:a})).status,409);
 assert.equal((await call('/api/assessments/'+id,{cookie:b})).status,404);assert.deepEqual((await call('/api/assessments',{cookie:b})).json.assessments,[]);
 assert.equal((await call('/api/assessments/'+id,{method:'PUT',body,cookie:b})).status,404);
 for(const route of ['/private/questionnaire-v2.9.json','/private/engine-v2.9.cjs','/data/assessment.sqlite','/.env','/server.js','/scoring.js','/test/fixtures/regression-40.json'])assert.equal((await call(route)).status,404,route);
 await stop();await start();assert.deepEqual((await call('/api/assessments/'+id,{cookie:a})).json,saved.json);
 assert.equal((await call('/api/assessments',{cookie:a})).json.assessments.length,1);
 assert.equal((await call('/api/auth/sign-out',{method:'POST',body:{},cookie:a})).status,200);assert.equal((await call('/api/me',{cookie:a})).status,401);
 const login=await call('/api/auth/sign-in/email',{method:'POST',body:{email:'a@example.com',password:'test-password-strong-123'}});assert.equal(login.status,200,login.text);
 assert.equal((await call('/api/auth/sign-in/email',{method:'POST',body:{email:'a@example.com',password:'wrong-password'}})).status,401);
 }finally{if(server?.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('production fails closed without valid origin/secret',async()=>{
 await assert.rejects(createApplication({NODE_ENV:'production',AUTH_SECRET:randomBytes(32).toString('hex')}));await assert.rejects(createApplication({APP_ORIGIN:'http://localhost:3000'}));
});
