import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {releaseVersion} from './release-version.js';
export const PDF_REVISION=releaseVersion;
const renderer=fileURLToPath(new URL('./report-pdf/render_report.py',import.meta.url));
const failure=()=>Object.assign(new Error('PDF 暂时无法生成，请稍后重试或联系管理员。'),{status:503});
let active=0;
// Bounded subprocesses, memory-only stdin/stdout; no report files or external service.
export async function generateReportPdf(saved,{signal}={}){
 if(active>=2)throw Object.assign(new Error('PDF 生成繁忙，请稍后重试。'),{status:503});
 if(signal?.aborted)throw failure();
 const input=JSON.stringify(saved);
 if(Buffer.byteLength(input)>512*1024)throw failure();
 active++;
 try{return await new Promise((resolve,reject)=>{
  const child=spawn('python3',[renderer],{stdio:['pipe','pipe','pipe'],shell:false});
  const parts=[];let bytes=0,settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
  const abort=()=>{child.kill('SIGKILL');finish(failure());};
  const timeout=setTimeout(abort,30000);timeout.unref();
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',part=>{bytes+=part.length;if(bytes>20*1024*1024)return abort();parts.push(part);});
  // Never log renderer stderr: report content must not enter operational logs.
  child.stderr.on('data',()=>{});
  child.on('error',()=>finish(failure()));
  child.stdin.on('error',()=>{child.kill('SIGKILL');finish(failure());});
  child.on('close',code=>{
   if(settled)return;
   const pdf=Buffer.concat(parts);
   if(code!==0||!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))||!pdf.subarray(-40).includes(Buffer.from('%%EOF')))return finish(failure());
   finish(null,pdf);
  });
  child.stdin.end(input);
 });}finally{active--;}
}
export function pdfDisposition(saved){
 const safe=value=>String(value??'').toWellFormed().replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\/:*?"<>|]/g,'').trim();
 const name=Array.from(safe(saved.owner?.name)).slice(0,50).join('');
 const date=/^\d{4}-\d{2}-\d{2}/.exec(saved.createdAt||'')?.[0]||'report';
 const filename=`渡仁_职业与心理健康测评${name?'_'+name:''}_${date}_V${releaseVersion}.pdf`;
 const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return `attachment; filename="assessment-report-${date}.pdf"; filename*=UTF-8''${encoded}`;
}
