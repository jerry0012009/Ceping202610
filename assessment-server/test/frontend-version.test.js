import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

// Isolated public-client harness: distinct question banks catch accidental rebinding.
// No private scoring rules, account credentials, browser storage or live requests.
const bank=(version,size,key,label)=>({version,total:size,groups:[{name:'测试问卷 '+version,ids:Array.from({length:size},(_,i)=>'Q'+(i+1))}],questions:Array.from({length:size},(_,i)=>({id:'Q'+(i+1),number:i+1,type:'single',stem:label+' '+(i+1),instructions:[],options:[{key,text:label+'选项'}]}))});
const archived=bank('2.9',7,'L','旧版题目');
const latest=bank('2.11',13,'N','新版题目');
const snapshot=()=>({version:'2.9',answers:Object.fromEntries(archived.questions.slice(0,6).map(q=>[q.id,'L'])),seconds:Object.fromEntries(archived.questions.slice(0,6).map(q=>[q.id,3])),position:1});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function harness({draft=null,current=latest}={}){
 const nodes=new Map(),listeners={},requests=[],confirmations=[],decisions=[];
 const node=id=>nodes.get(id)||nodes.set(id,{innerHTML:'',textContent:'',style:{},classList:{toggle(){}},querySelectorAll:()=>[],focus(){},scrollIntoView(){}}).get(id);
 let owner='owner-a',signedIn=false,questionnaireFailure=null,questionnaireOverride=null,deleteFailure=null,saveFailure=null;
 const ok=body=>({ok:true,json:async()=>body});
 const error=(status,message)=>({ok:false,status,json:async()=>({message})});
 const context={console,performance:{now:()=>1000},crypto,AbortController,Math,Date,Number,String,Object,Array,JSON,Promise,Error,encodeURIComponent,
  clearTimeout(){},setTimeout(){return 1;},setInterval(){},
  FormData:class{*[Symbol.iterator](){yield ['email','synthetic@example.test'];yield ['password','synthetic'];}},
  confirm(message){confirmations.push(message);return decisions.length?decisions.shift():true;},
  document:{getElementById:node,body:{classList:{toggle(){}}},visibilityState:'visible',hasFocus:()=>true,addEventListener(type,fn){listeners[type]=fn;},querySelector:()=>({disabled:false,textContent:'',isConnected:false})},
  window:{scrollTo(){},addEventListener(){}},
  fetch:async(url,options={})=>{
   if(url==='/api/consent')return ok({notice:{version:'notice-test',text:'授权管理员查看'},consent:{id:'test',version:'notice-test'},required:false});
   requests.push({url,method:options.method||'GET',headers:options.headers,body:options.body?JSON.parse(options.body):undefined});
   if(url==='/api/auth/sign-in/email'){signedIn=true;return ok({});}
   if(url==='/api/me')return signedIn?ok({user:{id:owner}}):error(401,'Session expired');
   if(url==='/api/assessments'&&options.method!=='POST')return ok({assessments:[]});
   if(url.startsWith('/api/questionnaire')){
    if(questionnaireFailure)return error(questionnaireFailure,'Requested questionnaire unavailable');
    if(questionnaireOverride)return ok(questionnaireOverride);
    const version=new URL(url,'https://test.invalid').searchParams.get('version');
    return !version?ok(current):version==='2.9'?ok(archived):version==='2.11'?ok(latest):error(422,'Unknown questionnaire version');
   }
   if(url==='/api/draft'){
    if(options.method==='DELETE'){
     if(deleteFailure)return error(deleteFailure,'Restart failed');
     draft=null;return ok({ok:true});
    }
    if(options.method==='PUT'){
     if(saveFailure){const status=saveFailure;saveFailure=null;return error(status,'Session expired');}
     assert.equal(options.headers['X-Assessment-Owner'],owner);
     draft=JSON.parse(options.body);return ok({ok:true,position:draft.position});
    }
    return ok({draft});
   }
   if(url==='/api/assessments'&&options.method==='POST'){
    const body=JSON.parse(options.body);
    assert.equal(options.headers['X-Assessment-Owner'],owner);
    assert.equal(body.version,draft.version);
    assert.deepEqual(body.answers,draft.answers);
    draft=null;
    return ok({id:'synthetic-report',version:body.version,createdAt:'2026-10-12T00:00:00Z',report:{answered:Object.keys(body.answers).length,total:Object.keys(body.answers).length,dimensions:[],totals:[],family:[]}});
   }
   throw new Error('Unexpected request '+url);
  },
 };
 let source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 source=source.replace(/\}\)\(\);\s*$/,`requestConsent=async notice=>confirm(notice.text);globalThis.T={start,resume,history,next,fail,question,showAnswerDetails,mutate,awaitSaved,loadQuestionnaire,useQuestionnaire,questionPage,draftPayload,setUser(value){user=value},get state(){return state},get data(){return data},get pages(){return pages},get heldState(){return heldState},get savedDraft(){return savedDraft},get view(){return view}};})();`);
 vm.runInNewContext(source,context);await tick();context.T.setUser({id:owner});requests.length=0;
 return {T:context.T,node,requests,confirmations,decisions,get draft(){return draft;},setCurrent(value){current=value;},setQuestionnaireFailure(value){questionnaireFailure=value;},setQuestionnaireOverride(value){questionnaireOverride=value;},setDeleteFailure(value){deleteFailure=value;},setSaveFailure(value){saveFailure=value;},setOwner(value){owner=value;context.T.setUser({id:owner});},async login(value=owner){owner=value;await listeners.submit({preventDefault(){},target:{id:'authForm',querySelector:()=>({disabled:false,isConnected:false}),reset(){}}});await tick();}};
}

const questionnaireRequests=h=>h.requests.filter(r=>r.url.startsWith('/api/questionnaire'));
const writes=h=>h.requests.filter(r=>r.method!=='GET'&&!r.url.startsWith('/api/auth/'));

test('a new assessment fetches the latest version and pins its new state',async()=>{
 const h=await harness();await h.T.start();
 assert.equal(h.T.state.version,'2.11');assert.equal(h.T.data.version,'2.11');assert.equal(h.T.pages.length,3);
 assert.deepEqual(questionnaireRequests(h).map(r=>r.url),['/api/questionnaire']);
 assert.match(h.node('main').innerHTML,/新版题目/);assert.doesNotMatch(h.node('main').innerHTML,/旧版题目/);
 assert.equal(writes(h)[0].headers['X-Assessment-Owner'],'owner-a');
 assert.match(h.confirmations[0],/授权管理员查看/);
});

test('a saved 2.9 draft loads its archived bank, preserves locked pages, and submits as 2.9',async()=>{
 const saved=snapshot(),before=JSON.stringify(saved),h=await harness({draft:saved});await h.T.resume();
 assert.equal(h.T.state.version,'2.9');assert.equal(h.T.data.version,'2.9');assert.equal(h.T.pages.length,2);assert.equal(h.T.state.position,1);assert.equal(h.T.state.committed,1);assert.equal(h.T.state.confirmed,1);
 assert.equal(JSON.stringify(saved),before);assert.deepEqual(questionnaireRequests(h).map(r=>r.url),['/api/questionnaire?version=2.9']);
 assert.match(h.node('main').innerHTML,/旧版题目 7/);assert.doesNotMatch(h.node('main').innerHTML,/新版题目/);
 h.T.state.answers.Q7='L';await h.T.next();
 const writeRequests=writes(h);assert.deepEqual(writeRequests.map(r=>r.url),['/api/draft','/api/assessments']);
 for(const request of writeRequests){assert.equal(request.body.version,'2.9');assert.equal(request.headers['X-Assessment-Owner'],'owner-a');assert.equal(Object.keys(request.body.answers).length,7);assert.equal(request.body.answers.Q7,'L');}
 assert.equal(h.T.view,'report');assert.match(h.node('main').innerHTML,/测评结果/);assert.doesNotMatch(h.node('main').innerHTML,/答卷 V|计分 V/);
});

test('an in-memory legacy draft reloads its own bank rather than accepting cached latest data',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state;
 h.T.useQuestionnaire(latest);h.requests.length=0;await h.T.resume();
 assert.equal(h.T.state,original);assert.equal(h.T.state.answers.Q7,'L');assert.equal(h.T.data.version,'2.9');
 assert.deepEqual(h.requests.map(r=>r.url),['/api/questionnaire?version=2.9']);assert.match(h.node('main').innerHTML,/旧版题目/);
});

test('an unanswered in-memory assessment remains pinned across navigation',async()=>{
 const h=await harness({current:archived});await h.T.start();const original=h.T.state;h.setCurrent(latest);await h.T.history();
 assert.match(h.node('main').innerHTML,/data-action="resume"/);h.requests.length=0;await h.T.resume();
 assert.equal(h.T.state,original);assert.equal(h.T.state.version,'2.9');assert.equal(h.requests.length,0);assert.match(h.node('main').innerHTML,/旧版题目/);
});

test('session expiry and same-account re-login restore the exact version and frozen save queue',async()=>{
 const h=await harness({current:archived});await h.T.start();
 for(const q of archived.questions)h.T.state.answers[q.id]='L';h.setSaveFailure(401);await h.T.next();await tick();
 const original=h.T.state,payload=JSON.stringify(original.queue[0]),submissionId=original.submissionId;
 assert.equal(original.saveError.status,401);h.T.fail(original.saveError);assert.equal(h.T.heldState.state,original);
 h.setCurrent(latest);h.requests.length=0;await h.login();await h.T.awaitSaved();
 assert.equal(h.T.state,original);assert.equal(h.T.heldState,null);assert.equal(h.T.state.version,'2.9');assert.equal(h.T.state.submissionId,submissionId);assert.equal(h.T.data.version,'2.9');assert.equal(h.T.state.answers.Q7,'L');
 assert.deepEqual(questionnaireRequests(h).map(r=>r.url),['/api/questionnaire?version=2.9']);
 const retried=writes(h).find(r=>r.method==='PUT');assert.equal(JSON.stringify(retried.body),payload);assert.equal(retried.headers['X-Assessment-Owner'],'owner-a');
 await h.T.next();assert.equal(writes(h).find(r=>r.url==='/api/assessments').body.version,'2.9');
});

test('even an unanswered legacy assessment is retained through session expiry',async()=>{
 const h=await harness({current:archived});await h.T.start();const original=h.T.state;
 h.T.fail(Object.assign(new Error('Expired'),{status:401}));assert.equal(h.T.heldState.state,original);h.setCurrent(latest);await h.login();
 assert.equal(h.T.state,original);assert.equal(h.T.state.version,'2.9');assert.equal(h.T.data.version,'2.9');
});

for(const status of [401,503])test(`an interrupted legacy-bank load (${status}) keeps the held draft for another login`,async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state;
 h.T.fail(Object.assign(new Error('Expired'),{status:401}));h.setQuestionnaireFailure(status);await h.login();
 assert.equal(h.T.heldState.state,original);assert.equal(h.T.heldState.state.answers.Q7,'L');assert.equal(h.T.heldState.state.version,'2.9');
 h.setQuestionnaireFailure(null);await h.login();assert.equal(h.T.state,original);assert.equal(h.T.heldState,null);assert.equal(h.T.data.version,'2.9');
});

test('failed re-login recovery can also be retried with Continue without losing held answers',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state;
 h.T.fail(Object.assign(new Error('Expired'),{status:401}));h.setQuestionnaireFailure(503);await h.login();
 h.setQuestionnaireFailure(null);await h.T.resume();assert.equal(h.T.state,original);assert.equal(h.T.state.answers.Q7,'L');assert.equal(h.T.heldState,null);assert.equal(h.T.data.version,'2.9');
});

test('history offers Continue for an unsaved held draft after its bank failed to load during login',async()=>{
 const h=await harness({current:archived});await h.T.start();h.T.state.answers.Q1='L';const original=h.T.state;
 h.T.fail(Object.assign(new Error('Expired'),{status:401}));h.setQuestionnaireFailure(503);await h.login();await h.T.history();
 assert.equal(h.draft,null);assert.match(h.node('main').innerHTML,/data-action="resume"/);
 h.setQuestionnaireFailure(null);await h.T.resume();assert.equal(h.T.state,original);assert.equal(h.T.state.answers.Q1,'L');assert.equal(h.T.data.version,'2.9');
});

test('a different account cannot automatically recover or replay the held legacy draft',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state;
 h.T.fail(Object.assign(new Error('Expired'),{status:401}));h.requests.length=0;await h.login('owner-b');
 assert.equal(h.T.view,'history');assert.equal(h.T.heldState.state,original);assert.equal(h.T.state.version,null);assert.equal(writes(h).length,0);assert.equal(questionnaireRequests(h).length,0);
 h.decisions.push(false);await h.T.resume();assert.equal(h.T.heldState.state,original);assert.equal(writes(h).length,0);
 await h.login('owner-a');assert.equal(h.T.state,original);assert.equal(h.T.state.ownerId,'owner-a');assert.equal(h.T.data.version,'2.9');
});

test('resuming a memory state with the wrong owner fails before fetching or rendering its answers',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.setOwner('owner-b');h.requests.length=0;
 await assert.rejects(h.T.resume(),/原账户/);assert.equal(h.requests.length,0);assert.equal(h.T.state.ownerId,'owner-a');
});

test('a mismatched version response is rejected without binding or deleting the saved draft',async()=>{
 const saved=snapshot(),before=JSON.stringify(saved),h=await harness({draft:saved});h.setQuestionnaireOverride(latest);
 await assert.rejects(h.T.resume(),/版本暂时不可用/);
 assert.equal(h.T.data,null);assert.equal(h.T.state.version,null);assert.equal(JSON.stringify(h.draft),before);assert.equal(writes(h).length,0);
 assert.deepEqual(questionnaireRequests(h).map(r=>r.url),['/api/questionnaire?version=2.9']);
 h.setQuestionnaireOverride(null);await h.T.resume();assert.equal(h.T.state.version,'2.9');
});

test('an unavailable archive is not replaced with latest data and its draft remains untouched',async()=>{
 const saved={...snapshot(),version:'2.8'},before=JSON.stringify(saved),h=await harness({draft:saved});
 await assert.rejects(h.T.resume(),/Unknown questionnaire version/);
 assert.equal(h.T.data,null);assert.equal(h.T.state.version,null);assert.equal(JSON.stringify(h.draft),before);assert.equal(writes(h).length,0);
 assert.deepEqual(questionnaireRequests(h).map(r=>r.url),['/api/questionnaire?version=2.8']);
});

test('a draft without a version is never silently assigned the latest questionnaire',async()=>{
 const saved={...snapshot(),version:undefined},h=await harness({draft:saved});await assert.rejects(h.T.resume(),/缺少问卷版本/);
 assert.equal(questionnaireRequests(h).length,0);assert.equal(writes(h).length,0);assert.equal(h.draft,saved);
});

for(const decisions of [[false],[true,false]])test(`canceling restart (${decisions.join(',')}) preserves the active legacy state`,async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state,originalBank=h.T.data;
 h.requests.length=0;h.decisions.push(...decisions);await h.T.start();
 assert.equal(h.T.state,original);assert.equal(h.T.data,originalBank);assert.equal(h.T.state.answers.Q7,'L');assert.equal(h.requests.length,0);
});

test('an explicitly confirmed restart switches an old draft to latest only after successful deletion',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.requests.length=0;await h.T.start();
 assert.equal(h.T.state.version,'2.11');assert.equal(h.T.data.version,'2.11');assert.equal(Object.keys(h.T.state.answers).length,0);assert.equal(h.draft,null);
 assert.deepEqual(h.requests.map(r=>r.url),['/api/questionnaire','/api/draft']);assert.equal(writes(h)[0].method,'DELETE');assert.equal(writes(h)[0].headers['X-Assessment-Owner'],'owner-a');
 assert.match(h.confirmations[0],/删除上次尚未完成/);assert.match(h.confirmations[1],/授权管理员查看/);
});

for(const stage of ['questionnaire','deletion'])test(`a failed restart at ${stage} preserves old answers, state and questionnaire`,async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.state.answers.Q7='L';const original=h.T.state,originalBank=h.T.data;
 if(stage==='questionnaire')h.setQuestionnaireFailure(503);else h.setDeleteFailure(503);
 await assert.rejects(h.T.start(),stage==='questionnaire'?/unavailable/:/Restart failed/);
 assert.equal(h.T.state,original);assert.equal(h.T.data,originalBank);assert.equal(h.T.state.answers.Q7,'L');assert.equal(h.draft.version,'2.9');
 h.setQuestionnaireFailure(null);h.setDeleteFailure(null);await h.T.resume();assert.equal(h.T.state.version,'2.9');assert.match(h.node('main').innerHTML,/旧版题目/);
});

test('confirming one restart prompt then canceling another does not discard another account’s held draft',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();const original=h.T.state;h.T.fail(Object.assign(new Error('Expired'),{status:401}));await h.login('owner-b');
 h.decisions.push(true,false);h.requests.length=0;await h.T.start();
 assert.equal(h.T.heldState.state,original);assert.equal(h.requests.length,0);assert.equal(h.T.state.version,null);
});

test('a bank-state mismatch blocks rendering, draft payloads and final advancement',async()=>{
 const h=await harness({draft:snapshot()});await h.T.resume();h.T.useQuestionnaire(latest);h.requests.length=0;
 assert.throws(()=>h.T.questionPage(),/版本与当前进度不一致/);assert.throws(()=>h.T.draftPayload(1),/版本与当前进度不一致/);await assert.rejects(h.T.next(),/版本与当前进度不一致/);
 assert.equal(writes(h).length,0);assert.equal(h.T.state.version,'2.9');
});


const q41=keys=>({id:'QB246',number:41,type:'choice',stem:'核实工作差异时先做什么？',instructions:[],options:keys.map(key=>({key,text:'原始选项'+key}))});
const q41Bank=keys=>({version:keys.length===2?'2.10':'2.9',total:1,groups:[{name:'工作中的选择',ids:['QB246']}],questions:[q41(keys)]});

test('2.10 Q41 displays A/B but selecting visible B saves and submits original key D',async()=>{
 const current=q41Bank(['A','D']),before=JSON.stringify(current),h=await harness({current});await h.T.start();
 const html=h.node('main').innerHTML;
 assert.deepEqual([...html.matchAll(/<span class="key">([^<]+)<\/span>/g)].map(m=>m[1]),['A','B']);
 assert.deepEqual([...html.matchAll(/type="radio"[^>]+value="([^"]+)"/g)].map(m=>m[1]),['A','D']);
 h.T.mutate({dataset:{id:'QB246'},value:'D'});assert.equal(h.T.state.answers.QB246,'D');
 assert.match(h.T.question(current.questions[0]),/value="D"[^>]*checked><span class="key">B<\/span>/);
 await h.T.next();for(const request of writes(h).filter(r=>r.method!=='DELETE')){assert.equal(request.body.version,'2.10');assert.equal(request.body.answers.QB246,'D');}
 assert.equal(JSON.stringify(current),before);
});

test('archived 2.9 Q41 retains A/B/C/D labels and original selected key',async()=>{
 const current=q41Bank(['A','B','C','D']),h=await harness({current});await h.T.start();h.T.state.answers.QB246='D';
 const html=h.T.question(current.questions[0]);assert.deepEqual([...html.matchAll(/<span class="key">([^<]+)<\/span>/g)].map(m=>m[1]),['A','B','C','D']);
 assert.match(html,/value="D"[^>]*checked><span class="key">D<\/span>/);
});

for(const keys of [['A','D'],['A','B','C','D']])test(`admin Q41 option display preserves ${keys.length===2?'A/B labels with original D selection':'all four historical labels'}`,async()=>{
 const h=await harness(),q={...q41(keys),answered:true,answerText:(keys.length===2?'B':'D')+' · 原始选项D'};
 q.options=q.options.map(option=>({...option,selection:option.key==='D'?'selected':'unselected'}));
 const saved={owner:{name:'Synthetic',email:'synthetic@example.test'},createdAt:'2026-10-12T00:00:00Z',questionnaireVersion:keys.length===2?'2.10':'2.9',questions:[q]},before=JSON.stringify(saved);
 h.T.showAnswerDetails(saved);const html=h.node('main').innerHTML;
 assert.match(html,new RegExp((keys.length===2?'B':'D')+' · 原始选项D <b>（已选）</b>'));
 if(keys.length===2)assert.doesNotMatch(html,/D · 原始选项D/);else for(const key of keys)assert.ok(html.includes(key+' · 原始选项'+key));
 assert.equal(JSON.stringify(saved),before);assert.equal(saved.questions[0].options.at(-1).key,'D');
});

for(const keys of [['A','C','D'],['A','B','D'],['A','B','C']])test(`2.11 three-option labels are continuous while stored keys remain ${keys.join('/')}`,async()=>{
 const q={id:'QBTEST',number:40,type:'choice',stem:'三项选择',instructions:[],options:keys.map(key=>({key,text:'原始选项'+key}))},current={version:'2.11',total:1,groups:[{name:'三选一',ids:[q.id]}],questions:[q]},h=await harness({current});await h.T.start();assert.deepEqual([...h.node('main').innerHTML.matchAll(/<span class="key">([^<]+)<\/span>/g)].map(m=>m[1]),['A','B','C']);h.T.mutate({dataset:{id:q.id},value:keys[2]});await h.T.next();for(const request of writes(h).filter(r=>r.method!=='DELETE')){assert.equal(request.body.version,'2.11');assert.equal(request.body.answers[q.id],keys[2]);}
 const detail={...q,answered:true,answerText:'C · 原始选项'+keys[2],options:q.options.map(o=>({...o,selection:o.key===keys[2]?'selected':'unselected'}))};h.T.showAnswerDetails({owner:{name:'Synthetic',email:'synthetic@example.test'},version:'2.11',questionnaireVersion:'2.11',createdAt:'2026-10-12T00:00:00Z',questions:[detail]});assert.match(h.node('main').innerHTML,new RegExp('C · 原始选项'+keys[2]+' <b>（已选）</b>'));
});
