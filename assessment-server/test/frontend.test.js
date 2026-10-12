import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {questionnaire,calculateReport,validateSubmission} from '../scoring.js';
import {answerDetails} from '../answer-details.js';

// DOM-only harness: validates rendering and request contracts without opening a browser.
async function harness({failDraftOnce=false,failSubmissionOnce=false,holdSaves=false,failStatus=0}={}) {
  const nodes=new Map();
  const node=id=>nodes.get(id)||nodes.set(id,{
    innerHTML:'',textContent:'',style:{},classList:{toggle(){}},
    focus(){},scrollIntoView(){},remove(){this.removed=true;},querySelectorAll:()=>[],
  }).get(id);
  const draftRequests=[],submissionRequests=[],requestHeaders=[],gates=[],timers=[];let releaseSaves=!holdSaves;
  let draft=null;
  const context={
    console,performance,crypto,AbortController,Math,Date,Number,String,Object,Array,JSON,Promise,Error,
    encodeURIComponent,clearTimeout(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},setInterval(){},confirm:()=>true,
    document:{getElementById:node,body:{classList:{toggle(){}}},visibilityState:'visible',
      hasFocus:()=>true,addEventListener(){},querySelector:()=>({disabled:false,textContent:'',isConnected:false})},
    window:{scrollTo(){},addEventListener(){}},
    fetch:async(url,options={})=>{requestHeaders.push({url,headers:options.headers,method:options.method});
      const ok=value=>({ok:true,json:async()=>value});
      if(url==='/api/questionnaire')return ok(questionnaire);
      if(url==='/api/draft'){
        if(options.method==='DELETE'){draft=null;return ok({ok:true});}
        if(options.method==='PUT'){
          const body=JSON.parse(options.body);draftRequests.push(body);if(!releaseSaves)await new Promise((resolve,reject)=>{gates.push(resolve);options.signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});});if(failStatus){const status=failStatus;failStatus=0;return {ok:false,status,json:async()=>({error:'Session expired'})};}
          if(failDraftOnce){failDraftOnce=false;throw new Error('Simulated lost response');}
          const pages=context.T.pages;
          assert.equal(body.position,(draft?.position||0)+1);
          const ids=new Set(pages.slice(0,body.position).flatMap(p=>p.ids));
          assert(Object.keys(body.answers).every(id=>ids.has(id)));
          assert(Object.keys(body.seconds).every(id=>ids.has(id)));
          for(const key of ['answers','seconds']){
            for(const id of Object.keys(draft?.[key]||{}))assert.deepEqual(body[key][id],draft[key][id]);
          }
          draft=body;return ok({ok:true,position:body.position});
        }
        return ok({draft});
      }
      if(url==='/api/assessments'&&options.method==='POST'){
        const body=JSON.parse(options.body);submissionRequests.push(body);
        if(failSubmissionOnce){failSubmissionOnce=false;throw new Error('Simulated lost response');}
        validateSubmission(body);
        assert.equal(draft.position,context.T.pages.length);
        assert.deepEqual(body.answers,draft.answers);
        assert.deepEqual(body.seconds,draft.seconds);
        draft=null;
        return ok({id:'saved-report',version:'2.9',createdAt:new Date().toISOString(),report:calculateReport(body.answers,body.seconds)});
      }
      return {ok:false,status:401,json:async()=>({})};
    },
  };
  let source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  source=source.replace(/\}\)\(\);\s*$/,`globalThis.T={showAnswerDetails,metric,radar,field,familyText,mutate,start,done,drain,awaitSaved,fail,get heldState(){return heldState},setUser(value){user=value},questionPage,next,showReport,clearPrivateUI,get report(){return report},get savedDraft(){return savedDraft},get state(){return state},get pages(){return pages}};})();`);
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setTimeout(resolve,0));
  context.T.setUser({id:'owner-a'});
  await context.T.start();
  for(const q of questionnaire.questions){
    if(q.type==='family'){context.T.state.answers[q.id]={other:'<script>alert(1)</script>'};continue;}
    context.T.state.answers[q.id]=q.type==='tenure'?{none:false,months:['12','24','36'],status:'已离职'}:
      q.type==='double'?{most:q.options[0].key,least:q.options[1].key}:q.options[0].key;
    assert(context.T.done(q.id),q.id);
  }
  return {T:context.T,node,draftRequests,submissionRequests,requestHeaders,timeoutSave(){timers.findLast(t=>t.ms===15000).fn();},release(){releaseSaves=true;gates.splice(0).forEach(r=>r());}};
}

test('frontend renders all questions, saves locked pages and renders sanitized report',async()=>{
  const {T,node,draftRequests,submissionRequests}=await harness();
  assert.equal(T.pages.length,17);
  for(let i=0;i<T.pages.length;i++){
    assert.equal(T.state.position,i);T.questionPage();
    assert(!node('main').innerHTML.includes('<script>alert'));
    await T.next();
  }
  assert.equal(draftRequests.length,17);
  assert.equal(submissionRequests[0].answers.QB002.months[0],12);
  assert.match(node('main').innerHTML,/测评结果/);
  assert.match(node('main').innerHTML,/参考区间基于模拟作答设定，非实测人群常模。/);
  assert.doesNotMatch(node('main').innerHTML,/data-action="dimension"|查看典型|典型回答|data-code=/);
  assert(!node('main').innerHTML.includes('<script>alert'));
  assert.equal(Object.keys(T.state.answers).length,0);
});

test('uncertain draft save retries identical data; uncertain final save reuses submission UUID',async()=>{
  const {T,draftRequests,submissionRequests}=await harness({failDraftOnce:true,failSubmissionOnce:true});
  await T.next();
  assert.equal(T.state.position,1);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(T.state.queue.length,1);
  assert(T.state.saveError);
  await T.awaitSaved();
  assert.deepEqual(draftRequests[0],draftRequests[1]);
  while(T.state.position<T.pages.length-1)await T.next();
  await assert.rejects(T.next(),/Simulated lost response/);
  assert.equal(T.state.committed,T.pages.length);
  await T.next();
  assert.deepEqual(submissionRequests[0],submissionRequests[1]);
});

test('public client has no embedded scoring engine, storage migration or preview controls',()=>{
  const client=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(client,/localStorage|sessionStorage|QUESTION_DATA|scoreText|referenceProfile|engine\.calculate|developerMode|测试填答|开发预览|调试/);
});

test('private report state is removed when an account session is cleared',async()=>{
  const {T,node}=await harness();
  T.showReport({version:'2.9',createdAt:new Date().toISOString(),report:{dimensions:[],totals:[],family:[],facts:{},answered:0,total:0}});
  assert(T.report);
  T.clearPrivateUI();
  assert.equal(T.report,null);
  assert.equal(T.savedDraft,null);
});


test('family forms use 无 and old 不适用 values display compatibly without changing stored answers',async()=>{
 const {T}=await harness();
 const select=T.field('婚姻状况','status','不适用','INFO014',['未婚','已婚']);
 assert.match(select,/>无<\/option>/);assert.match(select,/<option selected>无<\/option>/);assert.doesNotMatch(select,/不适用/);
 const text=T.field('其他说明','other','不适用','INFO014');assert.match(text,/value="无"/);assert.match(text,/无相关情况可填“无”/);
 const saved={id:'INFO014',answer:{status:'不适用',other:'保留用户原文，不适用其他条件'}};const before=JSON.stringify(saved);
 assert.equal(T.familyText(saved),'婚姻状况：无<br>其他说明：保留用户原文，不适用其他条件');assert.equal(JSON.stringify(saved),before);
 assert.equal(T.familyText({id:'INFO014',answer:{}}),'未填 / 无');
});


test('slow saves never block page advance; frozen FIFO payloads drain before final submission',async()=>{
 const {T,node,draftRequests,submissionRequests,release}=await harness({holdSaves:true});
 await T.next();assert.equal(T.state.position,1);assert.equal(T.state.confirmed,0);assert.equal(T.state.queue.length,1);assert.match(node('saveStatus').innerHTML,/保存中/);
 const frozen=JSON.stringify(T.state.queue[0]);
 await T.next();assert.equal(T.state.position,2);assert.equal(draftRequests.length,1);assert.equal(JSON.stringify(T.state.queue[0]),frozen);
 while(T.state.position<T.pages.length-1)await T.next();let finished=false;const final=T.next().then(()=>finished=true);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(finished,false);assert.equal(submissionRequests.length,0);
 release();await final;assert.equal(draftRequests.length,T.pages.length);assert.deepEqual(draftRequests.map(x=>x.position),Array.from({length:T.pages.length},(_,i)=>i+1));assert.equal(submissionRequests.length,1);
});

test('failed background save retains frozen queue and next page; session failure holds it under original account',async()=>{
 const {T,draftRequests}=await harness({failStatus:401});T.setUser({id:'owner-a'});await T.next();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(T.state.position,1);assert.equal(T.state.queue.length,1);assert.equal(T.state.saveError.status,401);const original=T.state;const payload=JSON.stringify(original.queue[0]);
 T.fail(original.saveError);assert.equal(T.heldState.userId,'owner-a');assert.equal(T.heldState.state,original);assert.equal(JSON.stringify(T.heldState.state.queue[0]),payload);assert.equal(Object.keys(T.state.answers).length,0);assert.equal(draftRequests.length,1);
});


test('hung save times out and retries exact frozen head without losing later pages',async()=>{
 const {T,draftRequests,release,timeoutSave}=await harness({holdSaves:true});await T.next();await T.next();const original=JSON.stringify(draftRequests[0]);
 timeoutSave();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(T.state.queue.length,2);assert.match(T.state.saveError.message,/超时/);assert.equal(T.state.confirmed,0);
 release();await T.awaitSaved();assert.equal(JSON.stringify(draftRequests[1]),original);assert.deepEqual(draftRequests.map(x=>x.position),[1,1,2]);assert.equal(T.state.confirmed,2);
});


test('queued writes keep their original owner header after account context changes',async()=>{
 const {T,requestHeaders,release}=await harness({holdSaves:true});await T.next();await T.next();T.setUser({id:'owner-b'});release();await T.awaitSaved();
 const writes=requestHeaders.filter(r=>r.method==='PUT'||r.method==='DELETE');assert.equal(writes.length,3);for(const r of writes)assert.equal(r.headers['X-Assessment-Owner'],'owner-a');while(T.state.position<T.pages.length-1)await T.next();await T.next();const final=requestHeaders.find(r=>r.url==='/api/assessments'&&r.method==='POST');assert.equal(final.headers['X-Assessment-Owner'],'owner-a');
});


test('report cards and radar show Chinese names and explanations without codes or representative answers',async()=>{
 const {T,node}=await harness();const report=calculateReport(T.state.answers,T.state.seconds);T.showReport({version:'2.9',createdAt:new Date().toISOString(),report});const html=node('main').innerHTML;assert.match(html,/职业性格匹配度/);assert.match(html,/心理问题倾向/);assert.match(html,/较高：/);assert.match(html,/较低：/);assert.doesNotMatch(html,/>[^<]*(?:PF[1-7]|ST[1-3]|MH[1-6]|RV[1-3]|SJ[1-3])[^<]*</);assert.doesNotMatch(html,/data-action="dimension"|典型回答|查看典型/);
 for(const row of [...report.totals,...report.dimensions])for(const key of ['definition','highMeaning','lowMeaning'])assert.ok(html.includes(row[key]),row.code+'.'+key+' renders in its report card');
 const radar=T.radar('完整中文维度',report.dimensions.filter(x=>x.code.startsWith('PF')));assert.match(radar,/<tspan/);assert.match(radar,/自驱与成就追求/);assert.doesNotMatch(radar,/PF[1-7]/);
});

test('admin answer details show every original question with escaped owner and free text',async()=>{
 const {T,node}=await harness();const answers={...T.state.answers,INFO014:{other:'<script>private-test</script>'}};const details=answerDetails('2.9',answers);T.showAnswerDetails({id:'record',owner:{name:'<img onerror=bad>',email:'admin@example.test'},createdAt:new Date().toISOString(),...details});const html=node('main').innerHTML;assert.equal((html.match(/class="question"/g)||[]).length,questionnaire.questions.length);assert.match(html,/逐题作答/);assert.match(html,/返回管理历史/);assert.match(html,/&lt;script&gt;private-test/);assert.doesNotMatch(html,/<script>|<img onerror|data-action="dimension"/);
});

const scoreBands=[['较低','low'],['稍低','slightly-low'],['平均','average'],['稍高','slightly-high'],['较高','high']];

test('all five score bands color total and dimension badges and bars without changing scores or references',async()=>{
 const {T,node}=await harness();
 const rows=scoreBands.map(([label],i)=>Object.freeze({code:`PF${i+1}`,name:`档位测试${i+1}`,label,score:67.25,mean:54.5,lower:45.5,upper:63.5,coverage:Object.freeze({answered:4,total:5})}));
 for(const total of [false,true])for(const [i,[label,band]] of scoreBands.entries()){
  const row=rows[i],before=JSON.stringify(row),html=T.metric(row,total);
  assert.match(html,new RegExp(`<article class="${total?'total-card':'metric-card'}">`));
  assert.ok(html.includes(`<span class="delta score-band-${band}">${label}</span>`));
  assert.ok(html.includes(`<i class="score-band-${band}" style="width:67.25%"></i>`));
  assert.match(html,/>67\.3(?:<small>\/ 100<\/small>)?<\/b>/);
  assert.match(html,/class="reference-band" style="left:45\.5%;width:18%"/);
  assert.match(html,/<em style="left:54\.5%"><\/em>/);
  assert.match(html,/模拟参照均值 54\.5<br>模拟参照区间 45\.5—63\.5/);
  assert.equal(JSON.stringify(row),before);
 }
 const report={totals:rows,dimensions:rows,family:[],facts:{},answered:80,total:80},before=JSON.stringify(report);
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report});
 for(const [label,band] of scoreBands)assert.equal(node('main').innerHTML.split(`<span class="delta score-band-${band}">${label}</span>`).length-1,2);
 assert.match(node('main').innerHTML,/颜色仅区分得分档位，高低分的具体含义请结合各项说明。/);
 assert.equal(JSON.stringify(report),before);
});

test('unknown and missing score labels use the neutral band and cannot inject CSS classes or markup',async()=>{
 const {T}=await harness();
 for(const total of [false,true])for(const label of [undefined,null,'','未知档位','constructor','__proto__','较高" onclick="bad','<img src=x onerror=bad>']){
  const row=Object.freeze({name:'兼容报告',label,score:12.3,mean:50,lower:40,upper:60}),before=JSON.stringify(row),html=T.metric(row,total);
  assert.match(html,/<span class="delta score-band-average">/);
  assert.match(html,/<i class="score-band-average" style="width:12\.3%"><\/i>/);
  assert.doesNotMatch(html,/<img|onclick="bad|class="[^"]*(?:constructor|__proto__|未知档位)/);
  assert.equal(JSON.stringify(row),before);
 }
 assert.match(T.metric({name:'兼容报告',label:'未知档位'}),/>未知档位<\/span>/);
 assert.match(T.metric({name:'兼容报告',label:'<img src=x onerror=bad>'}),/&lt;img src=x onerror=bad&gt;/);
});

test('five score palettes are distinct with WCAG AA text contrast and retained print labels',()=>{
 const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8'),palettes=[];
 const luminance=hex=>{
  const channels=hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return channels.reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 };
 for(const [,band] of scoreBands){
  const body=css.match(new RegExp(`\\.score-band-${band}\\{([^}]+)\\}`))?.[1];assert.ok(body,band);
  const colors=Object.fromEntries([...body.matchAll(/--band-(text|tint|border|accent):(#[a-f\d]{6})/gi)].map(x=>[x[1],x[2]]));
  const l=[luminance(colors.text),luminance(colors.tint)].sort((a,b)=>b-a),contrast=(l[0]+.05)/(l[1]+.05);
  assert.ok(contrast>=4.5,`${band} badge text contrast ${contrast.toFixed(2)} must meet 4.5:1`);palettes.push(colors);
 }
 for(const property of ['text','tint','border','accent'])assert.equal(new Set(palettes.map(p=>p[property])).size,5,`${property} distinguishes all five bands`);
 assert.match(css,/\.metric-bar i\{background:var\(--band-accent,/);
 assert.match(css,/@media print\{\.delta,\.metric-bar i\{print-color-adjust:exact;-webkit-print-color-adjust:exact\}\}/);
});


test('only children and cohabitation use their scoped applicability labels in forms and report display',async()=>{
 const {T}=await harness();
 for(const [id,key,label,options,empty] of [
  ['INFO018','children','目前是否已有子女（选填）',['没有','有','不愿填写'],'不适用'],
  ['INFO023','living','是否与您同住',['是','否','部分时间'],'不适用/其他'],
 ]){
  for(const value of ['',...options,'无','不适用',empty]){
   const html=T.field(label,key,value,id,options),expected=['无','不适用'].includes(value)?empty:value;
   assert.match(html,new RegExp(`<option value="">请选择 / ${empty}</option>`));
   assert.deepEqual([...html.matchAll(/<option(?: selected| )?>([^<]*)<\/option>/g)].map(m=>m[1]),[...options,empty]);
   assert.deepEqual([...html.matchAll(/<option selected>([^<]*)<\/option>/g)].map(m=>m[1]),expected?[expected]:[]);
   assert.doesNotMatch(html,/>无<\/option>/);
   const saved=Object.freeze({id,answer:Object.freeze({[key]:value})}),before=JSON.stringify(saved);
   assert.equal(T.familyText(saved),value?`${label}：${expected}`:'未填 / 无');
   assert.equal(JSON.stringify(saved),before);
  }
 }
 for(const [id,key,options] of [['INFO014','status',['未婚','已婚','离异','其他']],['INFO017','status',['是','否','部分时间']],['INFO020','stage',['未入学','幼儿园','小学','初中','高中及以上']],['INFO022','carer',['我自己','配偶','男方父母','女方父母','保姆/其他']]]){
  const html=T.field('原字段',key,'不适用',id,options);assert.match(html,/<option value="">请选择 \/ 无<\/option>/);assert.match(html,/<option selected>无<\/option>/);assert.doesNotMatch(html,/不适用/);
 }
 const support=T.field('需要说明的照料或支持安排（选填）','arrangement','无','INFO018','textarea');
 assert.match(support,/<textarea[^>]*placeholder="按需填写；无相关情况可填“无”">无<\/textarea>/);
 assert.match(T.field('老人目前居住地（选填）','place','不适用','INFO023'),/value="无"/);
 assert.match(T.familyText({id:'INFO018',answer:{children:'没有',arrangement:'不适用其他安排'}}),/目前是否已有子女（选填）：没有<br>需要说明的照料或支持安排（选填）：不适用其他安排/);
});

for(const legacy of [false,true])test(`family applicability ${legacy?'legacy values stay unchanged':'new selections round-trip'} through locked-page draft and final save`,async()=>{
 const {T,node,draftRequests,submissionRequests}=await harness();
 T.state.answers.INFO018={children:legacy?'无':'没有',arrangement:'保留支持说明'};
 T.state.answers.INFO023={living:legacy?'不适用':'否',place:'原居住地',age:'68'};
 const expected={INFO018:legacy?'无':'不适用',INFO023:legacy?'不适用':'不适用/其他'};
 if(!legacy){
  for(const [id,key,value]of [['INFO018','children','不适用'],['INFO023','living','不适用/其他']]){
   T.state.position=T.pages.findIndex(p=>p.ids.includes(id));T.questionPage();T.mutate({dataset:{id,field:key},value});
   assert.equal(T.state.answers[id][key],value);
  }
  T.state.position=0;
 }
 const original=JSON.stringify(T.state.answers);
 for(let i=0;i<T.pages.length;i++){
  T.questionPage();
  if(T.pages[i].ids.includes('INFO018'))assert.match(node('main').innerHTML,/<option selected>不适用<\/option>/);
  if(T.pages[i].ids.includes('INFO023'))assert.match(node('main').innerHTML,/<option selected>不适用\/其他<\/option>/);
  await T.next();
 }
 const submitted=submissionRequests[0].answers;
 assert.equal(submitted.INFO018.children,expected.INFO018);assert.equal(submitted.INFO023.living,expected.INFO023);
 assert.equal(submitted.INFO018.arrangement,'保留支持说明');assert.equal(submitted.INFO023.place,'原居住地');assert.equal(submitted.INFO023.age,'68');
 const originalAnswers=JSON.parse(original);for(const id of ['INFO018','INFO023']){
  assert.deepEqual(submitted[id],originalAnswers[id]);
  for(const request of draftRequests.filter(p=>p.answers[id]))assert.deepEqual(request.answers[id],originalAnswers[id]);
 }
 assert.match(node('main').innerHTML,/目前是否已有子女（选填）：不适用/);assert.match(node('main').innerHTML,/是否与您同住：不适用\/其他/);
});
