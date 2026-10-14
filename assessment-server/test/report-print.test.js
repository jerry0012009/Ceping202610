import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../public/report-print.js',import.meta.url),'utf8');
const context={window:{addEventListener(){}},console,document:{}};vm.createContext(context);vm.runInContext(source,context);
const renderer=context.window.AssessmentPrint;
const row=(code,score=62.345,label='平均')=>({code,name:'指标 '+code,score,label,mean:50,lower:35,upper:65,definition:'定义',highMeaning:'高分含义',lowMeaning:'低分含义',coverage:{answered:4,total:4}});
const report={version:'2.11',answered:89,total:89,totals:['ST','PF','MH','RV'].map(code=>row(code)),dimensions:['ST1','ST2','WV_STABILITY','WV_GROWTH','WV_REWARD',...Array.from({length:7},(_,i)=>'PF'+(i+1)),...Array.from({length:3},(_,i)=>'SJ'+(i+1)),...Array.from({length:6},(_,i)=>'MH'+(i+1)),...Array.from({length:3},(_,i)=>'RV'+(i+1))].map(code=>row(code)),employmentAnswers:{employersText:'2家',tenure:{months:[.5,12.25,0],status:'已离职'}},family:[],interpretationNotes:['使用限制'],timingNotice:'计时限制',referenceDescription:'非实测常模'};
const saved={id:'local-synthetic-fixture',createdAt:'2026-10-14T01:00:00Z',version:'2.11',report};
const html=(item=saved,options={})=>renderer.sections(item,options).map(section=>section.title+section.subtitle+section.blocks.join('')).join('');
test('approved report structure renders 4 totals, 24 dimensions and 3 vector radars from actual data',()=>{
 const before=JSON.stringify(saved),sections=renderer.sections(saved),out=html();
 assert.equal(sections.length,10);assert.equal((out.match(/data-metric=/g)||[]).length,28);assert.equal((out.match(/class="rp-radar"/g)||[]).length,3);assert.equal((out.match(/data-overview=/g)||[]).length,4);
 assert.match(out,/62\.3/);assert.match(out,/0\.5个月 · 已离职/);assert.match(out,/12\.25个月/);assert.match(out,/0个月（无该段经历）/);assert.match(out,/使用限制/);assert.match(out,/计时限制/);assert.match(out,/非实测常模/);assert.equal(JSON.stringify(saved),before);
 assert.doesNotMatch(out,/示例|虚拟作答|P01H|canvas|<img/);
});
test('all score bands are dynamic and missing historical scores do not become zero or fake radar points',()=>{
 for(const [label,band] of [['较低','low'],['稍低','slightly-low'],['平均','average'],['稍高','slightly-high'],['较高','high']])assert.match(renderer.metric(row('PF1',88.81,label)),new RegExp('score-band-'+band));
 const missing={...row('SJ1'),score:null,label:'无法重算',unavailableReason:'旧选项没有当前映射'};
 const out=renderer.metric(missing);assert.match(out,/—/);assert.match(out,/无法重算/);assert.match(out,/旧选项没有当前映射/);assert.doesNotMatch(renderer.bar(missing),/<circle/);
 const radar=renderer.radar('测试',[row('SJ1'),missing,row('SJ3')]);assert.equal((radar.match(/<circle/g)||[]).length,2);assert.doesNotMatch(radar,/stroke="#28465f" stroke-width="1.5"/);
});
test('owner is the viewed report owner, historical answer/scoring versions remain separate, and sample labels are opt-in',()=>{
 const item={...saved,owner:{name:'报告本人',email:'owner@example.test'},report:{...report,answerVersion:'2.9',scoringVersion:'2.11',rescoringNotice:'按当前规则重新解读'}};
 const out=html(item,{owner:{name:'管理员',email:'admin@example.test'}});assert.match(out,/报告本人/);assert.doesNotMatch(out,/管理员|admin@example/);assert.match(out,/答卷 V2.9 · 计分 V2.11/);assert.match(out,/按当前规则重新解读/);assert.doesNotMatch(out,/示例|虚拟/);
 assert.match(html(saved,{sample:true}),/测评结果报告（示例）/);assert.match(html(saved,{sample:true}),/基于虚拟作答生成，仅用于展示报告形式/);
});
test('optional support text is escaped, split losslessly and never sent to an external service',()=>{
 const value='支持安排<&>\n'+'𠮷'.repeat(1000),rows=renderer.recordRows('说明',value);
 assert.equal(rows.length,5);assert.ok(rows.every(x=>!x.includes('<&>')));assert.equal((rows.join('').match(/𠮷/g)||[]).length,1000);assert.match(rows.join(''),/（续）/);
 const out=html({...saved,report:{...report,family:[{id:'x',stem:'家庭信息',answer:{note:'<script>bad()</script>'}}]}},{familyFields:{x:[['支持说明','note']]}});assert.match(out,/&lt;script&gt;bad/);assert.doesNotMatch(out,/<script>/);
 assert.doesNotMatch(source,/\bfetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest|https:\/\//);
});
test('font assets and print CSS are same-origin and A4, with all report content retained as text and vectors',()=>{
 const css=fs.readFileSync(new URL('../public/report-print.css',import.meta.url),'utf8');assert.match(css,/@page\{size:A4 portrait;margin:0\}/);assert.match(css,/print-color-adjust:exact/);assert.match(css,/report-print-available/);assert.doesNotMatch(css,/https?:\/\//);
 for(const weight of ['Regular','Bold'])assert.equal(fs.readFileSync(new URL('../public/fonts/NotoSansCJKsc-'+weight+'.woff2',import.meta.url)).subarray(0,4).toString(),'wOF2');
 assert.match(fs.readFileSync(new URL('../public/fonts/LICENSE-Noto.txt',import.meta.url),'utf8'),/SIL OPEN FONT LICENSE/);
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.doesNotMatch(app,/window\.print|AssessmentPrint/);assert.match(app,/async function downloadPDF\(/);
});
test('V2.12 client only loads screen assets and downloads server PDFs',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 for(const file of ['style.css','app.js'])assert.ok(html.includes(`./${file}?v=2.12`),file);
 assert.doesNotMatch(html,/report-print|AssessmentPrint|打印窗口/);
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.doesNotMatch(app,/window\.print|AssessmentPrint|另存为 PDF|打印 \/ 导出 PDF/);
 assert.equal((app.match(/data-action="downloadPDF">导出PDF/g)||[]).length,2);
});

function lifecycleHarness({cssVersion='2.11-report-3',fontFailure=false}={}){
 const classes=new Set(),events={},roots=[];
 class Element{
  constructor(){this.children=[];this.dataset={};this.className='';this.innerHTML='';}
  append(n){this.children.push(n);n.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
  getBoundingClientRect(){return {bottom:100};}
  querySelector(sel){if(sel==='[data-overflow="true"]')return null;if(sel==='.rp-body'){return this.body||(this.body=new Element());}if(sel==='.rp-page-number')return this.number||(this.number=new Element());return null;}
  querySelectorAll(){return [];}
 }
 const body=new Element();body.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x))};
 const doc={body,title:'网页标题',createElement:()=>{const e=new Element();roots.push(e);return e;},fonts:{load:async()=>{if(fontFailure)throw new Error('font blocked');return [{}];},check:()=>!fontFailure}};
 const win={addEventListener:(name,fn)=>events[name]=fn,getComputedStyle:()=>({getPropertyValue:()=>cssVersion})};
 const ctx={window:win,document:doc,console};vm.createContext(ctx);vm.runInContext(source,ctx);
 return {api:win.AssessmentPrint,classes,events,doc,setCSS(v){cssVersion=v;},setFontFailure(v){fontFailure=v;}};
}
test('missing or stale CSS and failed fonts never mark a mounted report printable',async()=>{
 for(const options of [{cssVersion:''},{cssVersion:'2.11-report-2'},{fontFailure:true}]){
  const h=lifecycleHarness(options);h.api.mount(saved);await assert.rejects(h.api.ready());assert.equal(h.classes.has('report-print-ready'),false);h.events.beforeprint();assert.equal(h.classes.has('report-print-ready'),false);
 }
});
test('current report becomes ready; invalidation and clear remove permission to print stale content',async()=>{
 const h=lifecycleHarness();h.api.mount(saved);await h.api.ready();assert.equal(h.classes.has('report-print-ready'),true);assert.equal(h.doc.body.children.length,1);
 h.setCSS('');await assert.rejects(h.api.ready());assert.equal(h.classes.has('report-print-ready'),false);h.events.beforeprint();assert.equal(h.classes.has('report-print-ready'),false);
 h.api.clear();assert.equal(h.doc.body.children.length,0);assert.equal(h.classes.has('report-print-available'),false);assert.equal(h.classes.has('report-print-ready'),false);await assert.rejects(h.api.ready(),/请先打开/);
 h.setCSS('2.11-report-3');h.api.mount({...saved,id:'second'});await h.api.ready();assert.equal(h.doc.body.children.length,1);h.setFontFailure(true);h.events.beforeprint();assert.equal(h.classes.has('report-print-ready'),false);
});
test('approved employment label width and radar header rule remain local presentation changes',()=>{
 const css=fs.readFileSync(new URL('../public/report-print.css',import.meta.url),'utf8');assert.match(css,/grid-template-columns:180pt minmax\(0,1fr\)/);assert.match(css,/\.rp-radar-table-head\{border-bottom:\.6pt solid #d9e1e6\}/);assert.match(html(),/rp-record-row rp-employment-row/);
});
