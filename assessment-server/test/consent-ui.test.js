import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bank={version:'2.11',total:1,questions:[{id:'Q1',type:'choice',number:1,stem:'题目',instructions:[],options:[{key:'A',text:'回答'}]}],groups:[{name:'测试分组',ids:['Q1']}]};
async function harness({active=false,draft=null,postFailure=false}={}){
 const nodes=new Map(),requests=[],dialogs=[];let draftValue=draft;
 const node=id=>nodes.get(id)||nodes.set(id,{innerHTML:'',textContent:'',style:{},querySelectorAll:()=>[]}).get(id);
 function element(){const handlers={};return {disabled:false,checked:false,addEventListener(name,fn){handlers[name]=fn;},fire(name){handlers[name]?.({preventDefault(){}});},focus(){}};}
 function dialog(){const parts={'#consentCheck':element(),'[data-consent="accept"]':element(),'[data-consent="cancel"]':element()},events={};parts['[data-consent="accept"]'].disabled=true;const d={open:false,innerHTML:'',setAttribute(){},querySelector:q=>parts[q],addEventListener(n,fn){events[n]=fn;},showModal(){this.open=true;dialogs.push(this);},close(){this.open=false;events.close?.();},remove(){this.removed=true;},cancel(){events.cancel?.({preventDefault(){}});}};return d;}
 const ok=body=>({ok:true,json:async()=>body});
 const context={console,performance,crypto,AbortController,setTimeout,clearTimeout,setInterval(){},encodeURIComponent,confirm:()=>true,document:{getElementById:node,body:{append(){},classList:{toggle(){}}},visibilityState:'visible',hasFocus:()=>true,addEventListener(){},createElement:dialog},window:{addEventListener(){},scrollTo(){}},fetch:async(path,options={})=>{
 if(path==='/api/quota')return ok({mode:'trial',canStart:true,remaining:10});
 if(path==='/api/me')return {ok:false,status:401,json:async()=>({})};requests.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null,headers:options.headers});
 if(path==='/api/consent'){if(options.method==='POST'){if(postFailure)return {ok:false,status:503,json:async()=>({message:'无法保存同意'})};active=true;}return ok({notice:{version:'notice-v2.12-1',text:'服务端指导语<script>bad</script>\n三个部分'},required:!active,consent:active?{id:'consent',version:'notice-v2.12-1',acceptedAt:'2026-10-14T00:00:00Z'}:null});}
 if(path==='/api/draft'){if(options.method==='DELETE'){draftValue=null;active=false;}return ok({draft:draftValue});}
 if(path.startsWith('/api/questionnaire'))return ok(bank);
 throw new Error('Unexpected '+path);
 }};
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`globalThis.T={start,resume,requestConsent,setUser(v){user=v},get state(){return state},get view(){return view}};})();`),context);await tick();context.T.setUser({id:'owner'});
 return {T:context.T,requests,dialogs,node,get draft(){return draftValue;},accept(){const d=dialogs.at(-1),check=d.querySelector('#consentCheck');check.checked=true;check.fire('change');d.querySelector('[data-consent="accept"]').fire('click');}};
}
test('new attempts display unchecked backend notice and collect no answers until explicit agreement',async()=>{
 const h=await harness({active:true});const pending=h.T.start();await tick();assert.equal(h.dialogs.length,1);const d=h.dialogs[0],button=d.querySelector('[data-consent="accept"]');assert.equal(button.disabled,true);assert.equal(d.querySelector('#consentCheck').checked,false);assert.match(d.innerHTML,/服务端指导语&lt;script&gt;bad&lt;\/script&gt;/);assert.equal(h.T.state.version,null);assert.deepEqual(h.requests.map(r=>r.path),['/api/consent']);button.fire('click');await tick();assert.equal(h.T.state.version,null);
 h.accept();await pending;assert.equal(h.T.view,'questions');assert.deepEqual(h.requests.map(r=>r.method+' '+r.path),['GET /api/consent','GET /api/questionnaire','DELETE /api/draft','POST /api/consent']);assert.deepEqual(h.requests.at(-1).body,{version:'notice-v2.12-1',accepted:true});assert.equal(h.requests.at(-1).headers['X-Assessment-Owner'],'owner');assert.equal(d.removed,true);
});
for(const escape of [false,true])test(`canceling consent ${escape?'with Escape':'by button'} leaves stored draft and fresh state untouched`,async()=>{
 const draft={version:'2.11',position:0,answers:{Q1:'A'},seconds:{}},h=await harness({draft}),pending=h.T.start();await tick();const d=h.dialogs[0];if(escape)d.cancel();else d.querySelector('[data-consent="cancel"]').fire('click');await pending;assert.equal(h.draft,draft);assert.equal(h.T.state.version,null);assert.equal(h.requests.filter(r=>r.method!=='GET').length,0);
});
test('legacy draft needs explicit consent before resume, but already consented drafts resume directly',async()=>{
 const draft={version:'2.11',position:0,answers:{Q1:'A'},seconds:{}};
 for(const active of [false,true]){const h=await harness({draft,active}),pending=h.T.resume();await tick();if(!active){assert.equal(h.T.view,'auth');assert.equal(h.dialogs.length,1);h.accept();}await pending;assert.equal(h.T.view,'questions');assert.equal(h.T.state.answers.Q1,'A');assert.equal(h.requests.some(r=>r.method==='DELETE'),false);assert.equal(h.requests.filter(r=>r.method==='POST').length,active?0:1);}
});
test('failed consent persistence and account switching never initialize a new questionnaire',async()=>{
 const h=await harness({postFailure:true}),pending=h.T.start();await tick();h.accept();await assert.rejects(pending,/无法保存同意/);assert.equal(h.T.state.version,null);
 const switched=await harness(),other=switched.T.start();await tick();switched.T.setUser({id:'other'});switched.accept();await assert.rejects(other,/账户已切换/);assert.equal(switched.requests.filter(r=>r.method!=='GET').length,0);assert.equal(switched.T.state.version,null);
});
