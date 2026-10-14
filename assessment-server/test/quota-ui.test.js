import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bank={version:'2.11',total:1,questions:[{id:'Q1',type:'choice',number:1,stem:'保留原题目',instructions:[],options:[{key:'A',text:'原始选项'}]}],groups:[{name:'测试分组',ids:['Q1']}]};
const stored={id:'existing-report',version:'2.11',createdAt:'2026-10-14T00:00:00Z',report:{answered:1,total:1,dimensions:[],totals:[],family:[]}};
const ok=body=>({ok:true,json:async()=>body});
const denied=(status,error,code)=>({ok:false,status,json:async()=>({error,code})});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function harness({isAdmin=false,quota={mode:'trial',canStart:true,remaining:10},draft=null,signedIn=false}={}){
 const nodes=new Map(),listeners={},requests=[],submissions=[];
 const node=id=>nodes.get(id)||nodes.set(id,{innerHTML:'',textContent:'',style:{},querySelectorAll:()=>[],focus(){},scrollIntoView(){}}).get(id);
 let serverUser={id:'owner-a',name:'Synthetic',isAdmin},consentCount=0,quotaHandler=null,questionnaireHandler=null,submissionHandler=null,consentRequired=false,consentId=draft?.submissionId||crypto.randomUUID();
 const context={console,performance,crypto,AbortController,encodeURIComponent,confirm:()=>true,setInterval(){},setTimeout(){return 1;},clearTimeout(){},
  FormData:class{*[Symbol.iterator](){yield ['email','synthetic@example.test'];yield ['password','synthetic'];}},
  document:{getElementById:node,body:{classList:{toggle(){}}},visibilityState:'visible',hasFocus:()=>true,addEventListener(name,fn){listeners[name]=fn;},querySelector:()=>({disabled:false,textContent:'',isConnected:false})},
  window:{addEventListener(){},scrollTo(){}},
  fetch:async(path,options={})=>{
   requests.push({path,method:options.method||'GET',options,body:options.body?JSON.parse(options.body):null});
   if(path==='/api/me')return signedIn?ok({user:{...serverUser}}):denied(401,'Session expired');
   if(path==='/api/auth/sign-in/email'){signedIn=true;return ok({});}
   if(path==='/api/quota')return quotaHandler?quotaHandler():ok({...quota});
   if(path==='/api/consent'){if(options.method==='POST'){consentId ||= crypto.randomUUID();consentRequired=false;}return ok({notice:{version:'notice-test',text:'保持原指导语'},required:consentRequired,consent:consentRequired?null:{id:consentId}});}
   if(path.startsWith('/api/questionnaire'))return questionnaireHandler?questionnaireHandler():ok(bank);
   if(path==='/api/draft'){
    if(options.method==='DELETE'){draft=null;consentId=null;}
    if(options.method==='PUT')draft=JSON.parse(options.body);
    return ok({draft:draft?{...draft,submissionId:draft.submissionId||consentId}:null});
   }
   if(path==='/api/assessments'&&options.method==='POST'){
    const body=JSON.parse(options.body);submissions.push(body);
    if(submissionHandler)return submissionHandler(body);
    quota={...quota,remaining:Math.max(0,(quota.remaining||0)-1)};quota.canStart=quota.remaining>0;draft=null;return ok(stored);
   }
   if(path==='/api/assessments')return ok({assessments:[{id:stored.id,createdAt:stored.createdAt}]});
   if(path==='/api/assessments/'+stored.id)return ok(stored);
   throw new Error('Unexpected '+path);
  },
 };
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`requestConsent=async()=>{globalThis.onConsent();return true;};globalThis.T={start,resume,next,fail,history,showReport,refreshQuota,account,api,auth,setUser(value){user=value;account();},get user(){return user},get state(){return state},get view(){return view},get data(){return data},get heldState(){return heldState},get quota(){return quota}};})();`),Object.assign(context,{onConsent(){consentCount++;}}));
 await tick();if(!signedIn)context.T.setUser({...serverUser});requests.length=0;
 return {T:context.T,node,requests,submissions,get draft(){return draft;},get consentCount(){return consentCount;},get consentId(){return consentId;},setQuota(value){quota=value;},setQuotaHandler(value){quotaHandler=value;},setQuestionnaireHandler(value){questionnaireHandler=value;},setSubmissionHandler(value){submissionHandler=value;},setConsentRequired(value){consentRequired=value;if(value)consentId=null;},async login(id='owner-a'){serverUser={...serverUser,id};await listeners.submit({preventDefault(){},target:{id:'authForm',querySelector:()=>({disabled:false,isConnected:false}),reset(){}}});await tick();}};
}

for(const isAdmin of [false,true])test(`trial quota is visible to ${isAdmin?'admin':'ordinary'} users and starts from fresh server data`,async()=>{
 const h=await harness({isAdmin});await h.T.refreshQuota();assert.match(h.node('account').innerHTML,/剩余试用次数：10次/);assert.doesNotMatch(h.node('account').innerHTML,/剩余测评次数/);
 assert.equal(h.requests[0].options.cache,'no-store');assert.equal(h.requests[0].options.headers['X-Assessment-Owner'],'owner-a');
 h.setQuota({mode:'trial',canStart:true,remaining:3});await h.T.start();assert.match(h.node('account').innerHTML,/剩余试用次数：3次/);assert.equal(h.T.view,'questions');assert.equal(h.consentCount,1);
});

test('paid counts render only for admins, even if an unexpected response contains an ordinary-user count',async()=>{
 for(const isAdmin of [false,true]){const h=await harness({isAdmin,quota:{mode:'paid',canStart:true,remaining:23}});await h.T.refreshQuota();if(isAdmin)assert.match(h.node('account').innerHTML,/剩余测评次数：23次/);else{assert.doesNotMatch(h.node('account').innerHTML,/剩余|23次/);assert.equal(Object.hasOwn(h.T.quota,'remaining'),false);}}
 const h=await harness({quota:{mode:'paid',canStart:true}});await h.T.start();assert.equal(h.T.view,'questions');assert.doesNotMatch(h.node('account').innerHTML,/剩余/);
});

for(const mode of ['trial','paid'])test(`${mode} exhaustion blocks new assessments before consent and draft deletion`,async()=>{
 const original={version:'2.11',answers:{Q1:'A'},position:0,seconds:{}},h=await harness({quota:{mode,canStart:false,...(mode==='trial'?{remaining:0}:{})},draft:original});
 await assert.rejects(h.T.start(),error=>error.status===403&&error.code==='QUOTA_EXHAUSTED'&&error.message===(mode==='trial'?'试用次数已用完，请联系管理员。':'测评次数已用完，请联系管理员。'));
 assert.equal(h.draft,original);assert.equal(h.T.state.version,null);assert.notEqual(h.T.view,'questions');assert.equal(h.consentCount,0);assert.deepEqual(h.requests.map(r=>r.path),['/api/quota']);
});

test('resuming a stored draft at zero never loads answers or a questionnaire',async()=>{
 const original={version:'2.11',answers:{Q1:'A'},position:0,seconds:{}},h=await harness({quota:{mode:'trial',canStart:false,remaining:0},draft:original});await assert.rejects(h.T.resume(),{code:'QUOTA_EXHAUSTED'});
 assert.equal(h.draft,original);assert.equal(h.T.state.version,null);assert.equal(h.T.data,null);assert.deepEqual(h.requests.map(r=>r.path),['/api/quota']);
});

test('cached questionnaire resume rechecks quota and retains all in-memory answers at zero',async()=>{
 const h=await harness();await h.T.start();h.T.state.answers.Q1='A';const original=h.T.state;await h.T.history();h.requests.length=0;h.setQuota({mode:'trial',canStart:false,remaining:0});await assert.rejects(h.T.resume(),{code:'QUOTA_EXHAUSTED'});
 assert.equal(h.T.state,original);assert.equal(h.T.state.answers.Q1,'A');assert.equal(h.T.view,'history');assert.deepEqual(h.requests.map(r=>r.path),['/api/quota']);assert.match(h.node('main').innerHTML,/查看报告/);
});

test('quota is checked again if consent becomes required during resume',async()=>{
 const h=await harness({draft:{version:'2.11',answers:{Q1:'A'},position:0,seconds:{}}});h.setConsentRequired(true);let checks=0;h.setQuotaHandler(()=>ok({mode:'trial',canStart:++checks===1,remaining:checks===1?1:0}));await assert.rejects(h.T.resume(),{code:'QUOTA_EXHAUSTED'});assert.equal(h.consentCount,1);assert.equal(h.T.state.version,null);assert.equal(h.requests.some(r=>r.method==='POST'),false);
});

test('a new start rechecks quota after consent before deleting the previous draft',async()=>{
 const original={version:'2.11',answers:{Q1:'A'},position:0,seconds:{}},h=await harness({draft:original});let checks=0;h.setQuotaHandler(()=>ok({mode:'trial',canStart:++checks===1,remaining:checks===1?1:0}));await assert.rejects(h.T.start(),{code:'QUOTA_EXHAUSTED'});assert.equal(h.consentCount,1);assert.equal(h.draft,original);assert.equal(h.T.state.version,null);assert.equal(h.requests.some(r=>r.method==='DELETE'),false);
});

test('persisted draft attempt IDs survive refresh and are reused by final submission',async()=>{
 const submissionId=crypto.randomUUID(),draft={version:'2.11',answers:{Q1:'A'},seconds:{},position:1,submissionId};
 for(let refresh=0;refresh<2;refresh++){const h=await harness({draft});await h.T.resume();assert.equal(h.T.state.submissionId,submissionId);await h.T.next();assert.equal(h.submissions[0].submissionId,submissionId);}
});

test('legacy drafts adopt the persisted existing or newly accepted consent ID',async()=>{
 for(const needsConsent of [false,true]){const h=await harness({draft:{version:'2.11',answers:{Q1:'A'},seconds:{},position:0}});if(needsConsent)h.setConsentRequired(true);await h.T.resume();assert.equal(h.T.state.submissionId,h.consentId);assert.match(h.T.state.submissionId,/^[a-f0-9-]{36}$/);assert.equal(h.consentCount,needsConsent?1:0);}
});

test('an explicit new attempt gets a distinct consent ID while held retries retain their original ID',async()=>{
 const h=await harness();await h.T.start();const first=h.T.state.submissionId;assert.equal(first,h.consentId);await h.T.start();const second=h.T.state.submissionId;assert.equal(second,h.consentId);assert.notEqual(second,first);
 h.T.state.answers.Q1='A';h.setConsentRequired(true);await h.T.resume();assert.equal(h.T.state.submissionId,second);assert.notEqual(h.consentId,second);
});

test('quota failure and invalid quota data fail closed without losing a stored draft',async()=>{
 for(const response of [denied(503,'暂时不可用'),ok({mode:'trial',canStart:true,remaining:-1}),ok({mode:'paid'}),ok({mode:'trial',canStart:true})]){const h=await harness({draft:{version:'2.11',answers:{Q1:'A'},position:0,seconds:{}}});h.setQuotaHandler(()=>response);await assert.rejects(h.T.start());assert.equal(h.T.state.version,null);assert.equal(h.draft.answers.Q1,'A');assert.equal(h.consentCount,0);assert.equal(h.requests.length,1);}
});

test('submission exhaustion preserves locked answers, draft and retry UUID and surfaces the server message',async()=>{
 const h=await harness();await h.T.start();h.T.state.answers.Q1='A';const original=h.T.state;h.setQuota({mode:'trial',canStart:false,remaining:0});h.setSubmissionHandler(()=>denied(403,'试用次数已用完，请联系管理员。','QUOTA_EXHAUSTED'));
 let failure;try{await h.T.next();}catch(error){failure=error;}assert.equal(failure.code,'QUOTA_EXHAUSTED');h.T.fail(failure);await tick();assert.equal(h.T.state,original);assert.equal(h.T.state.answers.Q1,'A');assert.equal(h.T.state.committed,1);assert.equal(h.draft.answers.Q1,'A');assert.match(h.node('submitError').textContent,/试用次数已用完.*已填写内容已保留/);assert.match(h.node('account').innerHTML,/剩余试用次数：0次/);
 h.setSubmissionHandler(()=>ok(stored));await h.T.next();assert.equal(h.submissions.length,2);assert.deepEqual(h.submissions[0],h.submissions[1]);assert.equal(h.T.view,'report');assert.match(h.node('main').innerHTML,/导出PDF/);
});

test('a lost successful response can retry its existing report after the final quota is consumed',async()=>{
 const h=await harness({quota:{mode:'trial',canStart:true,remaining:1}});await h.T.start();h.T.state.answers.Q1='A';let first=true;h.setSubmissionHandler(()=>{h.setQuota({mode:'trial',canStart:false,remaining:0});if(first){first=false;throw new Error('Lost response');}return ok(stored);});
 await assert.rejects(h.T.next(),/Lost response/);await h.T.refreshQuota();h.requests.length=0;await h.T.next();assert.equal(h.T.view,'report');assert.deepEqual(h.submissions[0],h.submissions[1]);assert.deepEqual(h.requests.map(r=>r.path),['/api/assessments','/api/quota']);assert.match(h.node('account').innerHTML,/剩余试用次数：0次/);
});

test('successful completion refreshes quota without preventing historical report access at zero',async()=>{
 const h=await harness({quota:{mode:'trial',canStart:true,remaining:1}});await h.T.start();h.T.state.answers.Q1='A';await h.T.next();assert.equal(h.T.view,'report');assert.match(h.node('account').innerHTML,/剩余试用次数：0次/);assert.equal(Object.keys(h.T.state.answers).length,0);await h.T.history();assert.match(h.node('main').innerHTML,/查看报告/);h.T.showReport(await h.T.api('/api/assessments/'+stored.id));assert.match(h.node('main').innerHTML,/导出PDF/);
});

test('login and existing-session initialization display fresh quota',async()=>{
 const existing=await harness({signedIn:true,quota:{mode:'trial',canStart:true,remaining:4}});assert.match(existing.node('account').innerHTML,/剩余试用次数：4次/);
 const h=await harness();await h.login();assert.match(h.node('account').innerHTML,/剩余试用次数：10次/);h.setQuota({mode:'trial',canStart:true,remaining:2});await h.login();assert.match(h.node('account').innerHTML,/剩余试用次数：2次/);
});

test('same-account re-login at zero keeps the held answers and opens usable history',async()=>{
 const h=await harness();await h.T.start();h.T.state.answers.Q1='A';const original=h.T.state;h.T.fail(Object.assign(new Error('Expired'),{status:401}));h.setQuota({mode:'trial',canStart:false,remaining:0});await h.login();assert.equal(h.T.heldState.state,original);assert.equal(h.T.heldState.state.answers.Q1,'A');assert.equal(h.T.view,'history');assert.match(h.node('main').innerHTML,/继续上次测评/);assert.match(h.node('toast').textContent,/试用次数已用完/);
});

test('delayed quota responses from a previous account cannot display counts or start answers',async()=>{
 const h=await harness(),gate=deferred();h.setQuotaHandler(()=>gate.promise);const pending=h.T.start();await tick();h.T.setUser({id:'owner-b',isAdmin:false});gate.resolve(ok({mode:'paid',canStart:true,remaining:999}));await assert.rejects(pending,/账户已切换/);assert.equal(h.T.state.version,null);assert.doesNotMatch(h.node('account').innerHTML,/999|剩余/);assert.equal(h.consentCount,0);
});

test('late questionnaire replies after switching accounts cannot delete drafts or enter answers',async()=>{
 for(const action of ['start','resume']){const h=await harness({draft:{version:'2.11',answers:{Q1:'A'},position:0,seconds:{}}}),gate=deferred();h.setQuestionnaireHandler(()=>gate.promise);const pending=h.T[action]();await tick();h.T.setUser({id:'owner-b'});gate.resolve(ok(bank));await assert.rejects(pending,/账户已切换/);assert.equal(h.T.state.version,null);assert.equal(h.T.data,null);assert.equal(h.requests.some(r=>r.method==='DELETE'),false);assert.equal(h.draft.answers.Q1,'A');}
});

test('newer quota requests win over stale same-account responses',async()=>{
 const h=await harness(),first=deferred(),second=deferred();let calls=0;h.setQuotaHandler(()=>++calls===1?first.promise:second.promise);const pendingFirst=h.T.refreshQuota(),pendingSecond=h.T.refreshQuota();second.resolve(ok({mode:'trial',canStart:false,remaining:0}));await pendingSecond;first.resolve(ok({mode:'trial',canStart:true,remaining:10}));await pendingFirst;assert.match(h.node('account').innerHTML,/剩余试用次数：0次/);assert.doesNotMatch(h.node('account').innerHTML,/10次/);
});
