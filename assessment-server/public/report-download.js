(function(){
'use strict';
const button=document.getElementById('download'),status=document.getElementById('status');
let preparedURL=null;
const saveLink=document.getElementById('save-pdf');
window.addEventListener('pagehide',()=>{if(preparedURL)URL.revokeObjectURL(preparedURL);preparedURL=null;saveLink.hidden=true;});
let token='';try{token=decodeURIComponent(window.location.hash.slice(1));}catch{}
if(!token||token.length>2048){button.disabled=true;status.textContent='下载链接无效，请返回报告页重新获取。';return;}
// Keep the fragment while this page is open so WeChat's "open in browser" can carry it.
// Fragments are not transmitted in HTTP URLs; no analytics or third-party resources load.
button.addEventListener('click',async()=>{
 if(button.disabled)return;button.disabled=true;status.textContent='正在生成PDF…';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
 try{
  const response=await fetch(new URL('./api/report-download',window.location.href),{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json',Accept:'application/pdf'},body:JSON.stringify({token}),signal:controller.signal});
  if(!response.ok){let body={};try{body=await response.json();}catch{}throw new Error(body.error||'报告暂时无法下载，请稍后重试。');}
  if(!/^application\/pdf(?:\s*;|$)/i.test(response.headers.get('Content-Type')||''))throw new Error('服务器未返回PDF，请稍后重试。');
  const blob=await response.blob();if(!blob.size)throw new Error('PDF文件为空，请稍后重试。');
  let filename='assessment-report.pdf';
  const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;\s]+)/i)?.[1];
  if(encoded){try{const value=decodeURIComponent(encoded).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"|?*]/g,'_');if(value.toLowerCase().endsWith('.pdf'))filename=value.slice(0,180);}catch{}}
  if(preparedURL)URL.revokeObjectURL(preparedURL);
  preparedURL=URL.createObjectURL(blob);saveLink.href=preparedURL;saveLink.download=filename;saveLink.hidden=false;saveLink.click();
  status.textContent='已尝试下载。请查看浏览器的下载列表；若未保存，请点“点此保存PDF”。微信内请先在系统浏览器打开。';
 }catch(error){status.textContent=error.name==='AbortError'?'下载超时，请重试。':error.message;}
 finally{clearTimeout(timer);button.disabled=false;}
});
})();
