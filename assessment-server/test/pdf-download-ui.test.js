import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const saved=()=>({id:'record/a',version:'2.11',createdAt:'2026-10-14T00:00:00Z',report:{dimensions:[],family:[],totals:[]}});
async function harness({pageURL='https://example.test/'}={}){
 const buttons=Array.from({length:2},()=>({disabled:false,textContent:'导出PDF'})),nodes=new Map(),downloads=[],requests=[],timers=[],revoked=[];
 const node=id=>nodes.get(id)||nodes.set(id,{innerHTML:'',textContent:'',querySelectorAll:()=>buttons}).get(id);
 let respond=async()=>new Response('%PDF-1.7\nfixture',{headers:{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"}});
 const context={console,performance,AbortController,encodeURIComponent,decodeURIComponent,setInterval(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},
 document:{getElementById:node,hasFocus:()=>true,visibilityState:'visible',addEventListener(){},body:{classList:{toggle(){}},append(){}},createElement:()=>({remove(){},click(){downloads.push({href:this.href,name:this.download});}})},
 window:{location:{href:pageURL},addEventListener(){},scrollTo(){}},URL:class extends URL{static createObjectURL(){return 'blob:local-pdf';}static revokeObjectURL(url){revoked.push(url);}},
 fetch:async(path,options)=>{if(path==='/api/me')return {ok:false,status:401,json:async()=>({})};requests.push({path:String(path),options});return respond(path,options);}};
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`globalThis.T={downloadPDF,pdfFilename,showReport,clearPrivateUI,setView,setUser(value){user=value}};})();`),context);
 await new Promise(resolve=>setTimeout(resolve,0));context.T.setUser({id:'viewer'});context.T.showReport(saved());
 return {T:context.T,buttons,node,downloads,requests,timers,revoked,respond(fn){respond=fn;}};
}
test('both report actions download authenticated binary with UTF-8 filename and delayed URL cleanup',async()=>{
 const h=await harness();await h.T.downloadPDF();assert.equal(h.requests[0].path,'https://example.test/api/assessments/record%2Fa/pdf');assert.equal(h.requests[0].options.credentials,'same-origin');assert.equal(h.requests[0].options.headers['X-Assessment-Owner'],'viewer');assert.equal(h.downloads[0].name,'报告.pdf');assert.equal(h.buttons.every(b=>!b.disabled&&b.textContent==='导出PDF'),true);h.timers.find(t=>t.ms===60000).fn();assert.deepEqual(h.revoked,['blob:local-pdf']);
 h.T.showReport({...saved(),owner:{id:'subject'}});await h.T.downloadPDF();assert.equal(h.requests[1].path,'https://example.test/api/admin/assessments/record%2Fa/pdf');
});
test('concurrent download clicks share a lock and errors restore both buttons for retry',async()=>{
 const h=await harness();let release;h.respond(()=>new Promise(resolve=>release=resolve));const pending=h.T.downloadPDF();assert(h.buttons.every(b=>b.disabled));await h.T.downloadPDF();assert.equal(h.requests.length,1);release(new Response(JSON.stringify({message:'请稍后再试'}),{status:503,headers:{'Content-Type':'application/json'}}));await pending;assert(h.buttons.every(b=>!b.disabled));assert.equal(h.node('toast').textContent,'请稍后再试');assert.match(h.node('main').innerHTML,/测评结果/);
 h.respond(async()=>new Response('%PDF-1.7',{headers:{'Content-Type':'application/pdf'}}));await h.T.downloadPDF();assert.equal(h.downloads.length,1);
});
for(const action of ['navigate','clear','account','replace'])test(`pending PDF cannot download after ${action}`,async()=>{
 const h=await harness();let release;h.respond(()=>new Promise(resolve=>release=resolve));const pending=h.T.downloadPDF();
 if(action==='navigate')h.T.setView('history');if(action==='clear')h.T.clearPrivateUI();if(action==='account')h.T.setUser({id:'another'});if(action==='replace')h.T.showReport({...saved(),id:'other'});
 release(new Response('%PDF-1.7',{headers:{'Content-Type':'application/pdf'}}));await pending;assert.equal(h.downloads.length,0);assert(h.buttons.every(b=>!b.disabled));
});
test('stale binary body completion, invalid media type and empty PDFs cannot trigger downloads',async()=>{
 const h=await harness();let release;h.respond(async()=>({ok:true,headers:new Headers({'Content-Type':'application/pdf'}),blob:()=>new Promise(resolve=>release=resolve)}));const pending=h.T.downloadPDF();await new Promise(resolve=>setTimeout(resolve,0));h.T.clearPrivateUI();release(new Blob(['%PDF']));await pending;assert.equal(h.downloads.length,0);
 for(const response of [new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),new Response('',{headers:{'Content-Type':'application/pdf'}})]){h.T.showReport(saved());h.respond(async()=>response);await h.T.downloadPDF();assert.equal(h.downloads.length,0);assert(h.buttons.every(b=>!b.disabled));}
});
test('filenames drop paths, dangerous characters and non-PDF extensions with deterministic fallback',async()=>{
 const {T}=await harness();assert.equal(T.pdfFilename('attachment; filename="../../safe.pdf"','a'),'safe.pdf');assert.equal(T.pdfFilename("attachment; filename*=UTF-8''..%2F%00bad%3Aname.pdf",'a'),'_bad_name.pdf');assert.equal(T.pdfFilename('attachment; filename="bad.exe"','a/b'),'assessment-a_b.pdf');assert.equal(T.pdfFilename("attachment; filename*=UTF-8''%ZZ; filename=backup.pdf",'a'),'backup.pdf');assert.equal(T.pdfFilename(null,'a'),'assessment-a.pdf');
});
test('timeout aborts the request and restores both download actions',async()=>{
 const h=await harness();h.respond((path,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))));const pending=h.T.downloadPDF();h.timers.find(t=>t.ms===120000).fn();await pending;assert.equal(h.requests[0].options.signal.aborted,true);assert(h.buttons.every(b=>!b.disabled));assert.match(h.node('toast').textContent,/超时/);assert.equal(h.downloads.length,0);
});
test('expired authentication clears report state rather than downloading an error payload',async()=>{
 const h=await harness();h.respond(async()=>new Response('{}',{status:401,headers:{'Content-Type':'application/json'}}));await h.T.downloadPDF();assert.match(h.node('main').innerHTML,/欢迎回来/);assert.equal(h.downloads.length,0);await h.T.downloadPDF();assert.equal(h.requests.length,1);
});

for(const [pageURL,prefix] of [
 ['https://example.test/',''],
 ['https://example.test/index.html',''],
 ['https://example.test/ceping202610/','/ceping202610'],
 ['https://example.test/ceping202610/index.html?source=history#report','/ceping202610'],
 ['https://example.test/ceping202610','/ceping202610'],
])test(`PDF routes stay under the app folder at ${pageURL}`,async()=>{
 const h=await harness({pageURL});await h.T.downloadPDF();assert.equal(h.requests[0].path,`https://example.test${prefix}/api/assessments/record%2Fa/pdf`);
 h.T.showReport({...saved(),owner:{id:'subject'}});await h.T.downloadPDF();assert.equal(h.requests[1].path,`https://example.test${prefix}/api/admin/assessments/record%2Fa/pdf`);
});
