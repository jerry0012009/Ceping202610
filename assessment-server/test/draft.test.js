import {acceptCurrentNotice} from './consent-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApplication} from '../server.js';
import {pages,data} from './legacy-helpers.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-40.json',import.meta.url)))[0];
test('draft ownership, ordered immutable pages, explicit persistence, resume, completion, and deletion',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assessment-draft-'));let port,origin,instance,server;
 const env={AUTH_SECRET:randomBytes(32).toString('hex'),DATA_DIR:dir};
 async function start(){instance=await createApplication({...env,APP_ORIGIN:origin||'http://localhost:3000'});server=instance.app.listen(port||0,'127.0.0.1');await new Promise(r=>server.once('listening',r));if(!port){port=server.address().port;origin=`http://127.0.0.1:${port}`;await stop();return start();}}
 async function stop(){await new Promise(r=>server.close(r));instance.db.close();}
 async function call(route,{method='GET',body,cookie,requestOrigin=origin,expectedOwner}={}){let owner=expectedOwner;if(owner===undefined&&cookie&&['PUT','POST','DELETE'].includes(method)&&!route.startsWith('/api/auth/')){const me=await fetch(origin+'/api/me',{headers:{cookie,connection:'close'}});owner=(await me.json()).user?.id;}const r=await fetch(origin+route,{method,headers:{...(owner?{'X-Assessment-Owner':owner}:{}),connection:'close',origin:requestOrigin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let json;try{json=JSON.parse(text)}catch{}return{status:r.status,json,text,cookies:r.headers.getSetCookie()};}
 const signup=async(email)=>{const r=await call('/api/auth/sign-up/email',{method:'POST',body:{name:'Draft Test',email,password:'test-draft-password-12345'}});assert.equal(r.status,200,r.text);return r.cookies.map(x=>x.split(';')[0]).join('; ');};
 const payload=position=>{const ids=pages.slice(0,position).flat();return{version:'2.9',position,answers:Object.fromEntries(Object.entries(fixture.answers).filter(([id])=>ids.includes(id))),seconds:Object.fromEntries(Object.entries(fixture.seconds).filter(([id])=>ids.includes(id)))};};
 try{
 await start();assert.equal((await call('/api/draft')).status,401);
 const a=await signup('draft-a@example.test'),b=await signup('draft-b@example.test');
 await acceptCurrentNotice(origin,a);
 const ownerA=(await call('/api/me',{cookie:a})).json.user.id;
 const before=instance.db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n;
 assert.equal((await call('/api/draft',{method:'PUT',cookie:b,expectedOwner:ownerA,body:payload(1)})).status,401);
 assert.equal((await call('/api/assessments',{method:'POST',cookie:b,expectedOwner:ownerA,body:{version:'2.9',answers:fixture.answers,seconds:fixture.seconds,submissionId:randomUUID()}})).status,401);
 assert.equal((await call('/api/draft',{method:'DELETE',cookie:b,expectedOwner:ownerA})).status,401);
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,expectedOwner:'',body:payload(1)})).status,409);
 assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n,before);
 assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM assessments').get().n,0);

 assert.equal((await call('/api/draft',{cookie:a})).json.draft,null);
 assert.equal((await call('/api/draft',{cookie:b})).json.draft,null);
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:payload(2)})).status,409,'cannot skip first page');
 for(const body of [{...payload(1),version:undefined},{...payload(1),position:0},{...payload(1),position:1.5},{...payload(1),user_id:'other-user'},{...payload(1),answers:{}},{...payload(1),answers:{...payload(1).answers,[pages.slice(1).flat().find(id=>Object.hasOwn(fixture.answers,id))]:fixture.answers[pages.slice(1).flat().find(id=>Object.hasOwn(fixture.answers,id))]}}])assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body})).status,400,JSON.stringify(body));
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:payload(1),requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:payload(1)})).status,200);
 const first=(await call('/api/draft',{cookie:a})).json.draft;assert.deepEqual(first.answers,payload(1).answers);
 assert.equal((await call('/api/draft',{cookie:b})).json.draft,null,'A draft invisible to B');
 assert.equal((await call('/api/draft',{method:'DELETE',cookie:b})).status,200);
 assert.deepEqual((await call('/api/draft',{cookie:a})).json.draft,first,'B deletion leaves A intact');
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:payload(1)})).status,200,'exact duplicate idempotent');
 const altered=structuredClone(payload(2));altered.answers.QB001=altered.answers.QB001==='A'?'B':'A';
 assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:altered})).status,409,'saved answer locked');
 const skippedFamily=pages[0].find(id=>data.questions.find(q=>q.id===id).type==='family'&&!Object.hasOwn(first.answers,id));
 if(skippedFamily){const changed=structuredClone(payload(2));changed.answers[skippedFamily]={detail:'late addition'};assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:changed})).status,409,'skipped family field locked');}
 const alteredSeconds=structuredClone(payload(2)),timedFirst=Object.keys(first.seconds)[0];if(timedFirst){alteredSeconds.seconds[timedFirst]+=1;assert.equal((await call('/api/draft',{method:'PUT',cookie:a,body:alteredSeconds})).status,409,'saved timer locked');}
 const full={version:'2.9',submissionId:randomUUID(),answers:fixture.answers,seconds:fixture.seconds};
 assert.equal((await call('/api/assessments',{method:'POST',cookie:a,body:full})).status,409,'incomplete draft cannot finalize');
 await stop();await start();assert.deepEqual((await call('/api/draft',{cookie:a})).json.draft,first,'SQLite restart resumes exact draft');
 assert.equal((await call('/api/auth/sign-out',{method:'POST',cookie:a,body:{}})).status,200);assert.equal((await call('/api/draft',{cookie:a})).status,401);
 const login=await call('/api/auth/sign-in/email',{method:'POST',body:{email:'draft-a@example.test',password:'test-draft-password-12345'}});assert.equal(login.status,200);const renewed=login.cookies.map(x=>x.split(';')[0]).join('; ');assert.deepEqual((await call('/api/draft',{cookie:renewed})).json.draft,first,'relogin restores same account draft');
 for(let i=2;i<=pages.length;i++)assert.equal((await call('/api/draft',{method:'PUT',cookie:renewed,body:payload(i)})).status,200,`page ${i}`);
 assert.equal((await call('/api/draft',{method:'PUT',cookie:renewed,body:payload(pages.length-1)})).status,409,'cannot rewind committed draft');
 const complete=payload(pages.length);full.answers=complete.answers;full.seconds=complete.seconds;
 const saved=await call('/api/assessments',{method:'POST',cookie:renewed,body:full});assert.equal(saved.status,201,saved.text);assert.equal((await call('/api/draft',{cookie:renewed})).json.draft,null,'final submission clears draft');
 assert.equal((await call('/api/assessments/'+saved.json.id,{cookie:b})).status,404);
 assert.equal((await call('/api/assessments',{cookie:b})).json.assessments.length,0);
 for(const row of saved.json.report.dimensions)if(row.example){assert.deepEqual(row.example.answer,full.answers[row.example.id]);assert.deepEqual(Object.keys(row.example).sort(),['id','number','stem','answer','answerText'].sort());}
 assert.ok(!/"(?:trace|records|weights|contribution|coeff|scoreText)":/.test(saved.text),'report examples omit scoring internals');
 await acceptCurrentNotice(origin,b);
 assert.equal((await call('/api/draft',{method:'PUT',cookie:b,body:payload(1)})).status,200);
 const bDraft=(await call('/api/draft',{cookie:b})).json.draft;
 assert.equal((await call('/api/draft',{method:'DELETE',cookie:b,expectedOwner:ownerA})).status,401);
 assert.deepEqual((await call('/api/draft',{cookie:b})).json.draft,bDraft,'stale A page cannot delete B draft after cookie switch');
 assert.equal((await call('/api/draft',{method:'DELETE',cookie:b,requestOrigin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/draft',{method:'DELETE',cookie:b})).status,200);assert.equal((await call('/api/draft',{cookie:b})).json.draft,null);
 }finally{if(server?.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
