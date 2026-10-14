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
  assert.match(node('main').innerHTML,/参考区间基于模拟作答，并结合题目含义作暂定调整，非实测人群常模。/);
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
 const {T,node}=await harness();const report=calculateReport(T.state.answers,T.state.seconds);T.showReport({version:'2.9',createdAt:new Date().toISOString(),report});const html=node('main').innerHTML;assert.match(html,/<h3>职业性格<\/h3>/);assert.match(html,/<h3>心理困扰倾向<\/h3>/);assert.match(html,/较高：/);assert.match(html,/较低：/);assert.doesNotMatch(html,/>[^<]*(?:PF[1-7]|ST[1-3]|MH[1-6]|RV[1-3]|SJ[1-3])[^<]*</);assert.doesNotMatch(html,/data-action="dimension"|典型回答|查看典型/);
 for(const row of [...report.totals.filter(v=>v.code==='RV'),...report.dimensions])for(const key of ['definition','highMeaning','lowMeaning'])assert.ok(html.includes(row[key]),row.code+'.'+key+' renders in its report card');
 const radar=T.radar('完整中文维度',report.dimensions.filter(x=>x.code.startsWith('PF')));assert.match(radar,/<tspan/);assert.match(radar,/主动进取/);assert.doesNotMatch(radar,/PF[1-7]/);
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
  assert.match(html,/参照中心 54\.5<br>参照区间 45\.5—63\.5/);
  assert.equal(JSON.stringify(row),before);
 }
 const report={totals:rows.slice(0,4).map((row,i)=>({...row,code:['ST','PF','MH','RV'][i]})),dimensions:rows,family:[],facts:{},answered:80,total:80},before=JSON.stringify(report);
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report});
 for(const [i,[label,band]] of scoreBands.entries())assert.equal(node('main').innerHTML.split(`<span class="delta score-band-${band}">${label}</span>`).length-1,i<4?2:1);
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


test('work value cards and radar replace the combined point, with Chinese labels and neutral preference note',async()=>{
 const {T,node}=await harness(),report=calculateReport(T.state.answers,T.state.seconds);
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report});const html=node('main').innerHTML;
 const names=['稳定保障偏好','学习成长偏好','报酬回报偏好'];for(const name of names)assert.ok(html.includes(name));
 assert.equal((html.match(/<h3>工作价值观<\/h3>/g)||[]).length,0);assert.match(html,/三项为独立得分，不是百分比，不相加为100/);
 assert.doesNotMatch(html,/>[^<]*(?:WV_STABILITY|WV_GROWTH|WV_REWARD|ST3)[^<]*</);
 const radar=T.radar('工作投入与情境判断',report.dimensions.filter(row=>/^(ST|SJ|WV_)/.test(row.code)));
 assert.equal((radar.match(/<circle /g)||[]).length,8);for(const name of names)assert.ok(radar.includes('<title>'+name+'</title>'));assert.doesNotMatch(radar,/<title>工作价值观<\/title>/);
 const missing={...report,reportSummary:undefined,dimensions:report.dimensions.filter(row=>!row.code.startsWith('WV_')),workValuePreferences:null,workValueNotice:'',workValueUnavailable:'本记录缺少可兼容的完整作答，暂无法展示工作价值观分项。'};
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report:missing});assert.match(node('main').innerHTML,/暂无法展示工作价值观分项/);for(const name of names)assert.ok(!node('main').innerHTML.includes(name));
});


test('cards, radar legends and source footnote identify reviewed reference centers honestly',async()=>{
 const {T,node}=await harness(),report=calculateReport(T.state.answers,T.state.seconds);T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report});
 const html=node('main').innerHTML;assert.match(html,/参照中心/);assert.doesNotMatch(html,/模拟参照均值/);assert.match(html,/参考区间基于模拟作答，并结合题目含义作暂定调整，非实测人群常模。/);
 assert.match(T.radar('工作投入与情境判断',report.dimensions.filter(row=>/^(ST|SJ|WV_)/.test(row.code))),/legend-line gray[^]*参照中心/);
});

test('employment report and print content show exact answers, labeled slots and no fact scores',async()=>{
 const {T,node}=await harness();
 const render=answers=>{const report=calculateReport({...T.state.answers,...answers},T.state.seconds);T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report});return node('main').innerHTML.split('<h2>工作经历</h2>')[1].split('<h2>家庭与支持信息</h2>')[0];};
 for(const [key,text]of [['A','0家'],['B','1家'],['C','2家'],['D','3家'],['E','4家'],['F','5家及以上']]){
  const html=render({QB001:key,QB002:{months:[60,0,0],status:'仍在职'}});assert.match(html,new RegExp('<p>'+text+'</p>'));assert.match(html,/最近一段：60个月/);assert.match(html,/上一段：0个月（无该段经历）/);assert.match(html,/再上一段：0个月（无该段经历）/);assert.match(html,/最近一段状态：仍在职/);assert.doesNotMatch(html,/事实稳定性分|事实持续性分|在职持续性参照|>100<|>B</);
 }
 const slots=render({QB002:{months:[12,0,36],status:'已离职'}});assert.match(slots,/最近一段：12个月/);assert.match(slots,/再上一段：36个月/);assert.match(slots,/最近一段状态：已离职/);
 assert.match(render({QB002:{months:[.5,12.25,0],status:'仍在职'}}),/最近一段：0.5个月/);
 const none=render({QB002:{none:true,months:[60,0,0],status:'仍在职'}});assert.match(none,/没有正式工作经历/);assert.doesNotMatch(none,/仍在职|60个月/);
 const zero=render({QB002:{months:[0,0,0]}});assert.match(zero,/没有正式工作经历/);assert.match(zero,/最近一段状态：未填写/);assert.doesNotMatch(zero,/仍在职|已离职/);
 const missing=render({QB002:undefined});assert.match(missing,/未填写/);assert.doesNotMatch(missing,/没有正式工作经历/);
 const base=calculateReport({...T.state.answers,QB001:'B',QB002:{months:[60,0,0],status:'仍在职'}},{});
 base.employmentAnswers={source:'legacy-facts',employersText:null,tenure:{noExperience:false,months:null,status:null,recordedMonths:[60]}};
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report:base});const legacy=node('main').innerHTML.split('<h2>工作经历</h2>')[1].split('<h2>家庭与支持信息</h2>')[0];assert.match(legacy,/已记录的在职月数：60个月/);assert.match(legacy,/原记录未保留各段对应关系/);assert.match(legacy,/最近一段状态：原记录未保留/);assert.doesNotMatch(legacy,/最近一段：60个月|上一段：/);
 base.employmentAnswers={source:'completion',employersText:'<img src=x onerror=alert(1)>',tenure:{noExperience:false,months:['<svg onload=alert(1)>',0,36],status:'<script>alert(1)</script>',recordedMonths:[]}};
 T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report:base});assert.doesNotMatch(node('main').innerHTML,/<img src=x|<svg onload|<script>alert/);assert.match(node('main').innerHTML,/&lt;script&gt;/);
 const client=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.doesNotMatch(client,/事实稳定性分|事实持续性分|工作经历事实参照/);assert.match(client,/async function downloadPDF\(/);assert.doesNotMatch(client,/window\.print\(\)/);
});

test('historical partial report clearly separates answer/scoring versions and never displays unavailable scores as zero',async()=>{
 const {T,node}=await harness(),r=calculateReport(T.state.answers,T.state.seconds);r.answerVersion='2.9';r.scoringVersion='2.11';r.rescoringStatus='partial';r.rescoringNotice='第41题含旧选项，相关指标无法完整重算。';const metric=r.dimensions.find(v=>v.code==='SJ1');metric.score=null;metric.raw=null;metric.label='无法重算';metric.unavailableReason='当前题库没有该旧选项映射，原始答案未改写。';T.showReport({version:'2.9',createdAt:'2026-10-12T00:00:00Z',report:r});const html=node('main').innerHTML;assert.match(html,/答卷 V2.9 · 计分 V2.11/);assert.match(html,/第41题含旧选项，相关指标无法完整重算/);assert.match(html,/无法重算/);assert.match(html,/当前题库没有该旧选项映射，原始答案未改写/);const card=html.split('<h3>'+metric.name+'</h3>')[1].split('</article>')[0];assert.doesNotMatch(card,/>0(?:\.0)?<\/b>/);
});

test('report-4 orders conclusion summary then four domains, with three domain radars and unchanged metric values',async()=>{
 const {T,node}=await harness();
 const codeGroups=[['ST1','ST2','WV_STABILITY','WV_GROWTH','WV_REWARD'],['PF1','PF2','PF3','PF4','PF5','PF6','PF7','SJ1','SJ2','SJ3'],['MH1','MH2','MH3','MH4','MH5','MH6'],['RV1','RV2','RV3']];
 const row=(code,i)=>({code,name:'名称'+code,score:40+i,mean:50,lower:35,upper:65,label:'平均',definition:'定义'+code,highMeaning:'高分'+code,lowMeaning:'低分'+code});
 const report={totals:['ST','PF','MH','RV'].map(row),dimensions:codeGroups.flat().map(row),family:[],answered:89,total:89,workValueNotice:'工作价值观限制',workValueDerivationNotice:'推导限制',interpretationNotes:['整体限制']},before=JSON.stringify(report);
 T.showReport({id:'test',version:'2.11',createdAt:'2026-10-14T00:00:00Z',report});const html=node('main').innerHTML;
 assert.equal((html.match(/<svg /g)||[]).length,3);assert.equal((html.match(/class="metric-card"/g)||[]).length,24);assert.equal((html.match(/class="total-card"/g)||[]).length,4);
 const sections=html.split('<section class="report-domain">');assert.equal(sections.length,5);
 assert.match(sections[0],/本次总体概述/);assert.doesNotMatch(sections[0],/<svg|综合指标概览|图形面积/);assert.doesNotMatch(sections[0],/名称RV/);
 for(const [i,title] of ['职业稳定性','职业性格','心理困扰倾向','掩饰性与作答质量'].entries()){
  const section=sections[i+1];assert.match(section,new RegExp('<h2>'+title+'</h2>'));assert.equal((section.match(/<svg /g)||[]).length,i<3?1:0);assert.equal((section.match(/class="metric-card"/g)||[]).length,codeGroups[i].length);
  for(const code of codeGroups[i])assert.ok(section.includes('<h3>名称'+code+'</h3>'));
 }
 assert.match(sections[1],/工作价值观限制/);assert.match(sections[1],/推导限制/);assert.match(sections[2],/radar-card-wide/);assert.match(sections[4],/名称RV<\/h3>/);assert.match(html,/整体限制/);assert.equal(JSON.stringify(report),before);
 const css=fs.readFileSync(new URL('../public/style.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:650px\)\{\.radars\{grid-template-columns:1fr\}/);
});

test('conclusion cards use server interpretations once, escape summary prose and keep original values',async()=>{
 const {T,node}=await harness();const r=calculateReport(T.state.answers,T.state.seconds);
 r.reportSummary={cards:['ST','PF','MH'].map(code=>({code,interpretation:'解读'+code+'<script>bad()</script>'})),overview:'本次动态概述<img src=x onerror=bad>\n依据实际得分'};const before=JSON.stringify(r);
 T.showReport({id:'summary-test',version:'2.11',createdAt:'2026-10-14T00:00:00Z',report:r});const overview=node('main').innerHTML.split('<section class="report-domain">')[0];
 assert.equal((overview.match(/data-conclusion=/g)||[]).length,3);assert.equal((overview.match(/class="big-score"/g)||[]).length,3);assert.equal((overview.match(/class="delta /g)||[]).length,3);assert.doesNotMatch(overview,/<svg|<script>|<img|较高：|较低：/);
 for(const code of ['ST','PF','MH']){assert.equal(overview.split('解读'+code).length-1,1);assert.match(overview,/&lt;script&gt;bad/);const total=r.totals.find(row=>row.code===code);assert.ok(overview.includes(total.score.toFixed(1)+'<small>/ 100</small>'));}
 assert.match(overview,/本次动态概述&lt;img src=x onerror=bad&gt;/);assert.match(overview,/依据实际得分/);assert.equal(JSON.stringify(r),before);
});
