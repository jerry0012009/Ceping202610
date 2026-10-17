import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const saved=()=>({id:'record/a',version:'2.11',createdAt:'2026-10-14T00:00:00Z',report:{dimensions:[],family:[],totals:[]}});
async function harness({pageURL='https://example.test/',clipboard='available',userAgent=''}={}){
 const buttons=Array.from({length:2},()=>({disabled:false,textContent:'导出PDF'})),nodes=new Map(),downloads=[],requests=[],timers=[],revoked=[],copies=[];
 let now=Date.now();
 const node=id=>{
  if(nodes.has(id))return nodes.get(id);
  const value={textContent:'',value:'',hidden:false,disabled:false,selected:false,querySelectorAll:()=>buttons,focus(){this.focused=true;},select(){this.selected=true;},scrollIntoView(){this.scrolled=true;}};
  let html='';Object.defineProperty(value,'innerHTML',{get:()=>html,set(text){html=text;if(id==='main'){node('pdfFallback').hidden=true;node('pdfDownloadURL').value='';node('pdfLinkStatus').textContent='';node('copyPDFLink').disabled=false;}}});nodes.set(id,value);return value;
 };
 let respond=async(path)=>String(path).endsWith('/pdf-link')?new Response(JSON.stringify({token:'limited-report-token',expiresAt:new Date(now+600000).toISOString()}),{headers:{'Content-Type':'application/json'}}):new Response('%PDF-1.7\nfixture',{headers:{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"}});
 const context={console,performance,AbortController,encodeURIComponent,decodeURIComponent,Date:class extends Date{static now(){return now;}},setInterval(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(id){if(timers[id-1])timers[id-1].cleared=true;},
 document:{getElementById:node,hasFocus:()=>true,visibilityState:'visible',addEventListener(){},body:{classList:{toggle(){}},append(){}},createElement:()=>({remove(){},click(){downloads.push({href:this.href,name:this.download});}})},
 navigator:{userAgent,...(clipboard==='missing'?{}:{clipboard:{async writeText(text){if(clipboard==='denied')throw new Error('NotAllowedError');copies.push(text);}}})},
 window:{location:{href:pageURL},addEventListener(){},scrollTo(){}},URL:class extends URL{static createObjectURL(){return 'blob:local-pdf';}static revokeObjectURL(url){revoked.push(url);}},
 fetch:async(path,options)=>{if(path==='/api/me')return {ok:false,status:401,json:async()=>({})};requests.push({path:String(path),options});return respond(path,options);}};
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`globalThis.T={downloadPDF,copyPDFLink,pdfFilename,showReport,clearPrivateUI,setView,setUser(value){user=value}};})();`),context);
 await new Promise(resolve=>setTimeout(resolve,0));context.T.setUser({id:'viewer'});context.T.showReport(saved());
 return {T:context.T,buttons,node,downloads,requests,timers,revoked,copies,advance(ms){now+=ms;},respond(fn){respond=fn;}};
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

test('mobile WeChat export keeps a persistent recovery panel even after a successful blob click',async()=>{
 const h=await harness({userAgent:'Mozilla/5.0 (iPhone) MicroMessenger/8.0'});
 assert.equal(h.node('pdfFallback').hidden,true);await h.T.downloadPDF();
 assert.equal(h.downloads.length,1);assert.equal(h.node('pdfFallback').hidden,false);assert.equal(h.node('pdfFallback').scrolled,true);
 assert.match(h.node('main').innerHTML,/微信内可点击右上角/);assert.match(h.node('main').innerHTML,/Safari \/ Chrome/);
 assert.match(h.node('main').innerHTML,/<textarea id="pdfDownloadURL"[^>]*readonly/);assert.match(h.node('main').innerHTML,/10分钟后失效/);
 assert.equal(h.requests.length,1,'export alone must not mint a bearer link');
});
test('recovery panel remains available when the PDF request fails',async()=>{
 const h=await harness();h.respond(async()=>new Response('{}',{status:503,headers:{'Content-Type':'application/json'}}));await h.T.downloadPDF();
 assert.equal(h.node('pdfFallback').hidden,false);assert.equal(h.node('copyPDFLink').disabled,false);assert.equal(h.downloads.length,0);
});
test('fallback mints an authenticated single-report link and keeps its token only in the fragment',async()=>{
 const h=await harness({pageURL:'https://example.test/ceping202610/index.html?source=history#report'});await h.T.copyPDFLink();
 assert.equal(h.requests[0].path,'https://example.test/ceping202610/api/assessments/record%2Fa/pdf-link');
 assert.equal(h.requests[0].options.method,'POST');assert.equal(h.requests[0].options.credentials,'same-origin');assert.equal(h.requests[0].options.cache,'no-store');assert.equal(h.requests[0].options.headers['X-Assessment-Owner'],'viewer');
 const url=new URL(h.copies[0]);assert.equal(url.pathname,'/ceping202610/report-download.html');assert.equal(url.search,'');assert.equal(decodeURIComponent(url.hash.slice(1)),'limited-report-token');
 assert.equal(h.node('pdfDownloadURL').value,h.copies[0]);assert.match(h.node('pdfLinkStatus').textContent,/链接已复制/);
 await h.T.copyPDFLink();assert.equal(h.requests.length,1);assert.equal(h.copies.length,2,'unexpired links may be copied repeatedly');
});
for(const clipboard of ['denied','missing'])test('manual copy remains available when clipboard is '+clipboard,async()=>{
 const h=await harness({clipboard});await h.T.copyPDFLink();
 assert.equal(h.copies.length,0);assert.match(h.node('pdfDownloadURL').value,/#limited-report-token$/);
 assert.equal(h.node('pdfDownloadURL').selected,true);assert.equal(h.node('pdfFallback').hidden,false);
 assert.match(h.node('pdfLinkStatus').textContent,/手动复制/);assert.equal(h.node('copyPDFLink').disabled,false);
});
test('repeated copy after expiry requests a fresh link even when background timers did not run',async()=>{
 const h=await harness();await h.T.copyPDFLink();h.advance(600001);
 h.respond(async()=>new Response(JSON.stringify({token:'replacement/token?value',expiresAt:Date.now()+1200000}),{headers:{'Content-Type':'application/json'}}));
 await h.T.copyPDFLink();assert.equal(h.requests.length,2);assert.equal(h.copies.length,2);assert.notEqual(h.copies[0],h.copies[1]);
 assert.equal(decodeURIComponent(new URL(h.copies[1]).hash.slice(1)),'replacement/token?value');assert.equal(new URL(h.copies[1]).search,'');
});
test('expiry visibly clears stale download links and permits regeneration',async()=>{
 const h=await harness();await h.T.copyPDFLink();const expiry=h.timers.find(t=>t.ms===600000);assert(expiry);h.advance(600001);expiry.fn();
 assert.equal(h.node('pdfDownloadURL').value,'');assert.match(h.node('pdfLinkStatus').textContent,/已过期/);assert.equal(h.node('copyPDFLink').disabled,false);
 await h.T.copyPDFLink();assert.equal(h.requests.length,2);assert.match(h.node('pdfDownloadURL').value,/#limited-report-token$/);
});
test('concurrent copy clicks share a lock and generation failures leave a retry button',async()=>{
 const h=await harness();let release;h.respond(()=>new Promise(resolve=>release=resolve));const pending=h.T.copyPDFLink();
 assert.equal(h.node('copyPDFLink').disabled,true);await h.T.copyPDFLink();assert.equal(h.requests.length,1);
 release(new Response(JSON.stringify({message:'生成受限，请稍后重试'}),{status:429,headers:{'Content-Type':'application/json'}}));await pending;
 assert.equal(h.node('copyPDFLink').disabled,false);assert.match(h.node('pdfLinkStatus').textContent,/生成受限/);assert.equal(h.node('pdfDownloadURL').value,'');
});
for(const action of ['navigate','clear','account','sameAccount','replace'])test('pending link cannot appear or copy after '+action,async()=>{
 const h=await harness();let release;h.respond(()=>new Promise(resolve=>release=resolve));const pending=h.T.copyPDFLink();
 if(action==='navigate')h.T.setView('history');if(action==='clear')h.T.clearPrivateUI();if(action==='account')h.T.setUser({id:'another'});if(action==='sameAccount')h.T.setUser({id:'viewer'});if(action==='replace')h.T.showReport({...saved(),id:'other'});
 release(new Response(JSON.stringify({token:'stale-token',expiresAt:Date.now()+600000}),{headers:{'Content-Type':'application/json'}}));await pending;
 assert.equal(h.copies.length,0);assert.equal(h.node('pdfDownloadURL').value,'');
 if(['navigate','clear','replace'].includes(action))assert.equal(h.requests[0].options.signal.aborted,true);
});
test('navigation clears an existing fallback link and its expiry timer',async()=>{
 const h=await harness();await h.T.copyPDFLink();const expiry=h.timers.find(t=>t.ms===600000);h.T.setView('history');
 assert.equal(h.node('pdfDownloadURL').value,'');assert.equal(h.node('pdfFallback').hidden,true);assert.equal(expiry.cleared,true);
});
test('link generation timeout aborts without hiding the manual recovery section',async()=>{
 const h=await harness();h.respond((path,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))));
 const pending=h.T.copyPDFLink();h.timers.find(t=>t.ms===15000).fn();await pending;
 assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.node('copyPDFLink').disabled,false);assert.equal(h.node('pdfFallback').hidden,false);assert.match(h.node('pdfLinkStatus').textContent,/超时/);
});
test('invalid or expired link responses never expose or copy a token',async()=>{
 const h=await harness();
 for(const body of [{token:'token',expiresAt:'yesterday'},{token:'token',expiresAt:0},{token:'',expiresAt:Date.now()+600000},{}]){
  h.respond(async()=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}}));await h.T.copyPDFLink();
  assert.equal(h.node('pdfDownloadURL').value,'');assert.equal(h.copies.length,0);assert.equal(h.node('copyPDFLink').disabled,false);assert.match(h.node('pdfLinkStatus').textContent,/无效/);
 }
});
test('expired authentication while minting a link clears report and recovery UI',async()=>{
 const h=await harness();h.respond(async()=>new Response('{}',{status:401,headers:{'Content-Type':'application/json'}}));await h.T.copyPDFLink();
 assert.match(h.node('main').innerHTML,/欢迎回来/);assert.equal(h.node('pdfFallback').hidden,true);assert.equal(h.copies.length,0);await h.T.copyPDFLink();assert.equal(h.requests.length,1);
});
for(const [pageURL,prefix] of [
 ['https://example.test/',''],
 ['https://example.test/index.html',''],
 ['https://example.test/ceping202610/','/ceping202610'],
 ['https://example.test/ceping202610/index.html?source=history#report','/ceping202610'],
 ['https://example.test/ceping202610','/ceping202610'],
])test('own and admin fallback links stay under the app folder at '+pageURL,async()=>{
 const h=await harness({pageURL});await h.T.copyPDFLink();assert.equal(h.requests[0].path,'https://example.test'+prefix+'/api/assessments/record%2Fa/pdf-link');assert.equal(new URL(h.copies[0]).pathname,prefix+'/report-download.html');
 h.T.showReport({...saved(),owner:{id:'subject'}});await h.T.copyPDFLink();assert.equal(h.requests[1].path,'https://example.test'+prefix+'/api/admin/assessments/record%2Fa/pdf-link');assert.equal(h.requests[1].options.headers['X-Assessment-Owner'],'viewer');
});
