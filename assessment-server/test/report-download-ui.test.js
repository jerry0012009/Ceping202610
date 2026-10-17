import vm from 'node:vm';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../public/report-download.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/report-download.html',import.meta.url),'utf8');
// Deliberately synthetic and not a grant for any real report.
const token='eyJ2IjoxLCJyZXBvcnRJZCI6InN5bnRoZXRpYyJ9.'+'A'.repeat(43);
const pdf=()=>new Response('%PDF-1.7\nsynthetic fixture',{headers:{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf"}});
function harness({pageURL='https://example.test/report-download.html#'+encodeURIComponent(token)}={}){
 const requests=[],downloads=[],created=[],revoked=[],timers=[],windowEvents=new Map(),buttonEvents=new Map();
 const button={disabled:false,addEventListener(type,callback){buttonEvents.set(type,callback);}};
 const status={textContent:''};
 const saveLink={hidden:true,href:'',download:'',click(){downloads.push({href:this.href,name:this.download,visible:!this.hidden});}};
 const nodes={download:button,status,'save-pdf':saveLink};
 let respond=async()=>pdf();
 const location=new URL(pageURL);
 const context={
  console,AbortController,
  document:{getElementById:id=>nodes[id]},
  window:{location,addEventListener(type,callback){windowEvents.set(type,callback);}},
  URL:class extends URL{
   static createObjectURL(blob){const value='blob:synthetic-pdf-'+(created.length+1);created.push({url:value,blob});return value;}
   static revokeObjectURL(value){revoked.push(value);}
  },
  setTimeout(callback,ms){timers.push({callback,ms,cleared:false});return timers.length;},
  clearTimeout(id){if(timers[id-1])timers[id-1].cleared=true;},
  fetch:async(url,options)=>{requests.push({url:String(url),options});return respond(url,options);}
 };
 vm.runInNewContext(source,context,{filename:'report-download.js'});
 return {
  button,status,saveLink,requests,downloads,created,revoked,timers,location,
  click(){return buttonEvents.get('click')?.();},
  pagehide(){return windowEvents.get('pagehide')?.({persisted:true});},
  pageshow(){return windowEvents.get('pageshow')?.({persisted:true});},
  respond(fn){respond=fn;}
 };
}

test('landing page keeps privacy hints, explicit save fallback, and same-origin external resources',()=>{
 assert.match(html,/<meta\s+name="referrer"\s+content="no-referrer"/i);
 assert.match(html,/<meta\s+name="robots"\s+content="noindex,nofollow,noarchive"/i);
 assert.match(html,/<a\b[^>]*id="save-pdf"[^>]*\bhidden[^>]*>点此保存PDF/);
 assert.match(html,/id="status"[^>]*role="status"[^>]*aria-live="polite"/);
 assert.match(html,/10分钟有效/);assert.match(html,/请勿转发/);assert.match(html,/在浏览器打开/);
 assert.match(html,/<script\s+src="\.\/report-download\.js[^"]*"\s+defer/);
 assert.doesNotMatch(html,/(?:src|href)=["'](?:https?:)?\/\//i,'the landing page loads no third-party resources');
});

for(const hash of ['', '#', '#%ZZ', '#%E0%A4%A', '#'+('x'.repeat(2049))])test('empty, malformed, or oversized fragments fail before any fetch: '+hash.slice(0,30),async()=>{
 const h=harness({pageURL:'https://example.test/report-download.html'+hash});
 assert.equal(h.button.disabled,true);assert.match(h.status.textContent,/下载链接无效/);
 await h.click();assert.equal(h.requests.length,0);assert.equal(h.downloads.length,0);assert.equal(h.saveLink.hidden,true);
});

for(const [pageURL,expectedURL] of [
 ['https://example.test/report-download.html#'+token,'https://example.test/api/report-download'],
 ['https://example.test/ceping202610/report-download.html?from=wechat#'+encodeURIComponent(token),'https://example.test/ceping202610/api/report-download']
])test('PDF POST stays same-origin and app-prefixed at '+pageURL.split('#')[0],async()=>{
 const h=harness({pageURL}),originalHash=h.location.hash;await h.click();
 assert.equal(h.requests.length,1);
 const {url,options}=h.requests[0];assert.equal(url,expectedURL);
 assert.equal(new URL(url).origin,new URL(pageURL).origin);
 assert.equal(new URL(url).search,'');assert.equal(new URL(url).hash,'','the capability never appears in the request URL');
 assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');
 assert.equal(options.headers['Content-Type'],'application/json');assert.equal(options.headers.Accept,'application/pdf');
 assert.deepEqual(JSON.parse(options.body),{token},'only the unchanged fragment token is submitted');
 assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);
 assert.equal(h.location.hash,originalHash,'the fragment remains available to WeChat open-in-browser');
 assert.equal(h.button.disabled,false);assert.equal(h.timers.every(timer=>timer.cleared),true);
});

test('a decoded fragment is sent unchanged rather than appended to a URL or decoded twice',async()=>{
 const unusual='synthetic+token/with?query=%25&fragment#tail';
 const h=harness({pageURL:'https://example.test/ceping202610/report-download.html#'+encodeURIComponent(unusual)});
 await h.click();
 assert.deepEqual(JSON.parse(h.requests[0].options.body),{token:unusual});
 assert.equal(h.requests[0].url,'https://example.test/ceping202610/api/report-download');
});

test('automatic click leaves an explicit visible manual-save link with the same PDF and UTF-8 filename',async()=>{
 const h=harness();await h.click();
 assert.equal(h.created.length,1);assert.equal(h.saveLink.hidden,false);
 assert.equal(h.saveLink.href,'blob:synthetic-pdf-1');assert.equal(h.saveLink.download,'报告.pdf');
 assert.deepEqual(h.downloads,[{href:'blob:synthetic-pdf-1',name:'报告.pdf',visible:true}]);
 assert.match(h.status.textContent,/点此保存PDF/);assert.match(h.status.textContent,/微信内请先在系统浏览器打开/);
 assert.equal(h.revoked.length,0,'automatic download does not destroy the manual recovery URL');
 h.saveLink.click();assert.equal(h.downloads.length,2);assert.equal(h.requests.length,1,'manual save reuses the prepared PDF');
 assert.equal(h.saveLink.hidden,false);assert.equal(h.revoked.length,0);
});

test('replacing a prepared PDF revokes its old URL and pagehide revokes only the current URL',async()=>{
 const h=harness();await h.click();await h.click();
 assert.equal(h.created.length,2);assert.deepEqual(h.revoked,['blob:synthetic-pdf-1']);
 assert.equal(h.saveLink.hidden,false);assert.equal(h.saveLink.href,'blob:synthetic-pdf-2');
 h.pagehide();assert.deepEqual(h.revoked,['blob:synthetic-pdf-1','blob:synthetic-pdf-2']);assert.equal(h.saveLink.hidden,true);
 h.pagehide();assert.equal(h.revoked.length,2,'repeated pagehide must not revoke a stale URL twice');
});

test('an expired grant displays the server explanation and permits retry without a false save link',async()=>{
 const h=harness();
 h.respond(async()=>new Response(JSON.stringify({error:'下载链接无效或已过期，请返回报告页重新获取。'}),{status:410,headers:{'Content-Type':'application/json'}}));
 await h.click();
 assert.equal(h.status.textContent,'下载链接无效或已过期，请返回报告页重新获取。');
 assert.equal(h.button.disabled,false);assert.equal(h.downloads.length,0);assert.equal(h.created.length,0);assert.equal(h.saveLink.hidden,true);
 h.respond(async()=>pdf());await h.click();assert.equal(h.requests.length,2);assert.equal(h.downloads.length,1);
});

test('busy double clicks share one request and unlock after completion',async()=>{
 const h=harness();let release;
 h.respond(()=>new Promise(resolve=>release=resolve));
 const pending=h.click();assert.equal(h.button.disabled,true);assert.match(h.status.textContent,/正在生成PDF/);
 await h.click();assert.equal(h.requests.length,1);
 release(pdf());await pending;
 assert.equal(h.button.disabled,false);assert.equal(h.downloads.length,1);assert.equal(h.saveLink.hidden,false);
});

test('invalid media types and empty PDFs never create a save link',async()=>{
 const h=harness();
 for(const response of [
  new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),
  new Response('',{headers:{'Content-Type':'application/pdf'}})
 ]){
  h.respond(async()=>response);await h.click();
  assert.equal(h.button.disabled,false);assert.equal(h.downloads.length,0);assert.equal(h.created.length,0);assert.equal(h.saveLink.hidden,true);
  assert.match(h.status.textContent,/服务器未返回PDF|PDF文件为空/);
 }
});

test('timeout aborts the request and keeps the button usable for retry',async()=>{
 const h=harness();
 h.respond((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))));
 const pending=h.click();const timer=h.timers.find(value=>value.ms===120000);assert.ok(timer);timer.callback();await pending;
 assert.equal(h.requests[0].options.signal.aborted,true);assert.equal(h.button.disabled,false);assert.equal(timer.cleared,true);
 assert.match(h.status.textContent,/下载超时/);assert.equal(h.downloads.length,0);assert.equal(h.saveLink.hidden,true);
});

test('pagehide aborts a pending request and ignores a late fetch response even if fetch ignores abort',async()=>{
 const h=harness();let release;
 h.respond(()=>new Promise(resolve=>release=resolve));
 const pending=h.click();h.pagehide();
 assert.equal(h.requests[0].options.signal.aborted,true);
 release(pdf());await pending;
 assert.equal(h.created.length,0);assert.equal(h.downloads.length,0);assert.equal(h.saveLink.hidden,true);
});

test('pagehide ignores a PDF body that finishes after navigation',async()=>{
 const h=harness();let releaseBody;
 h.respond(async()=>({ok:true,headers:new Headers({'Content-Type':'application/pdf'}),blob:()=>new Promise(resolve=>releaseBody=resolve)}));
 const pending=h.click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(typeof releaseBody,'function','the response body is pending');
 h.pagehide();assert.equal(h.requests[0].options.signal.aborted,true);
 releaseBody(new Blob(['%PDF-1.7\nlate fixture']));await pending;
 assert.equal(h.created.length,0);assert.equal(h.downloads.length,0);assert.equal(h.saveLink.hidden,true);
});

test('bfcache pageshow restores download and old completion cannot unlock or replace the newer request',async()=>{
 const h=harness();const releases=[];
 h.respond(()=>new Promise(resolve=>releases.push(resolve)));
 const old=h.click();h.pagehide();h.pageshow();
 assert.equal(h.button.disabled,false,'returning to the page restores its explicit download action');
 const current=h.click();assert.equal(h.requests.length,2);assert.equal(h.button.disabled,true);
 releases[0](pdf());await old;
 assert.equal(h.created.length,0);assert.equal(h.downloads.length,0);assert.equal(h.button.disabled,true,'stale finally cannot unlock the current request');
 releases[1](pdf());await current;
 assert.equal(h.button.disabled,false);assert.equal(h.downloads.length,1);assert.equal(h.saveLink.hidden,false);
});
