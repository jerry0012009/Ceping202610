(function(){
'use strict';
const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number.isFinite(v)?Number(v).toFixed(1):'—',pct=v=>Math.max(0,Math.min(100,Number(v)||0));
let user=null,data=null,qMap={},pages=[],state=fresh(),view='auth',register=false,busy=false,report=null,savedDraft=null,last=performance.now(),toastTimer,heldState=null,pdfDownload=null,pdfLink=null,consentOpen=false,quota=null,quotaRequest=0;
function fresh(){return {ownerId:null,version:null,answers:{},seconds:{},position:0,committed:0,confirmed:0,queue:[],saving:null,saveError:null,focus:null,submissionId:null};}
function toast(message){el('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el('toast').textContent='',4500);}
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...((path==='/api/draft'&&['PUT','DELETE'].includes(options.method))||(path==='/api/assessments'&&options.method==='POST')?{'X-Assessment-Owner':user?.id||''}:{}),...options.headers}});let body={};try{body=await response.json();}catch{}if(!response.ok){const error=new Error(typeof body.message==='string'?body.message:typeof body.error==='string'?body.error:response.status===401?'登录已过期，请重新登录。':'请求未完成，请稍后重试。');error.status=response.status;if(typeof body.code==='string')error.code=body.code;throw error;}return body;}
async function post(path,body,ownerId=user?.id){if(path!=='/api/assessments')return api(path,{method:'POST',body:JSON.stringify(body)});const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{return await api(path,{method:'POST',body:JSON.stringify(body),headers:{'X-Assessment-Owner':ownerId||''},signal:controller.signal});}catch(error){if(error.name==='AbortError')throw new Error('提交超时，请重试。');throw error;}finally{clearTimeout(timeout);}}
function done(id){const q=qMap[id],a=state.answers[id];if(!q)return false;if(q.type==='family')return a&&Object.values(a).some(v=>String(v).trim());if(q.type==='tenure')return a?.none===true||(Array.isArray(a?.months)&&a.months.length===3&&a.months.every(v=>String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1200)&&((Number(a.months[0])>0&&['仍在职','已离职'].includes(a.status))||a.months.every(v=>Number(v)===0)));if(q.type==='double')return q.options.some(o=>o.key===a?.most)&&q.options.some(o=>o.key===a?.least)&&a.most!==a.least;return q.options.some(o=>o.key===a);}
function count(){return data.questions.filter(q=>q.type!=='family'&&done(q.id)).length;}
function flush(){const now=performance.now(),q=qMap[state.focus];if(!consentOpen&&view==='questions'&&state.position>=state.committed&&q&&q.type!=='family'&&q.type!=='tenure'&&document.visibilityState==='visible'&&document.hasFocus()){state.seconds[q.id]=(state.seconds[q.id]||0)+Math.max(0,Math.min(5,(now-last)/1000));}last=now;}
function quotaLabel(){if(!user||quota?.owner!==user||!Number.isInteger(quota.remaining))return '';const label=quota.mode==='trial'?'剩余试用次数':user.isAdmin?'剩余测评次数':null;return label?`<span class="subtle quota-status" role="status" aria-live="polite">${label}：${quota.remaining}次</span>`:'';}
function account(){el('account').innerHTML=user?`<span class="account-summary"><span class="subtle account-name">${esc(user.name||user.email)}</span>${quotaLabel()}</span><button class="btn" data-action="history">历史报告</button>${user.isAdmin?'<button class="btn" data-action="adminHistory">管理历史</button>':''}<button class="btn" data-action="new">新测评</button><button class="btn ghost" data-action="copyAccountId">复制账户编号</button><button class="btn ghost" data-action="logout">退出</button>`:'';}
function checkAccount(owner){if(!owner?.id||user!==owner)throw new Error('账户已切换，请重新打开测评。');}
async function refreshQuota(owner=user){
 checkAccount(owner);const request=++quotaRequest;quota=null;account();
 const value=await api('/api/quota',{cache:'no-store',headers:{'X-Assessment-Owner':owner.id}});checkAccount(owner);
 const showCount=value.mode==='trial'||owner.isAdmin;
 if(!['trial','paid'].includes(value.mode)||typeof value.canStart!=='boolean'||(showCount&&(!Number.isSafeInteger(value.remaining)||value.remaining<0)))throw new Error('剩余次数暂时无法读取，请稍后重试。');
 const result={owner,mode:value.mode,canStart:value.canStart,...(showCount?{remaining:value.remaining}:{})};if(request===quotaRequest){quota=result;account();}return result;
}
async function refreshQuotaQuietly(owner=user){try{return await refreshQuota(owner);}catch(error){if(user===owner){if(error.status===401)fail(error);else toast('剩余次数暂时无法更新，请稍后重试。');}return null;}}
async function requireQuota(owner){const value=await refreshQuota(owner);if(!value.canStart){const error=new Error(value.mode==='trial'?'试用次数已用完，请联系管理员。':'测评次数已用完，请联系管理员。');error.status=403;error.code='QUOTA_EXHAUSTED';throw error;}return value;}
function setView(next){flush();cancelPDFDownload();cancelPDFLink();if(next!=='report'){report=null;}view=next;document.body.classList.toggle('no-sidebar',next!=='questions');account();}
function clearPrivateUI(){cancelPDFDownload();cancelPDFLink();report=null;savedDraft=null;}

function pdfButtons(loading){for(const button of el('main').querySelectorAll('[data-action="downloadPDF"]')){button.disabled=loading;button.textContent=loading?'正在生成PDF…':'导出PDF';}}
function cancelPDFDownload(){if(!pdfDownload)return;const current=pdfDownload;pdfDownload=null;current.controller.abort();pdfButtons(false);}
function pdfFilename(disposition,id){
 const fallback='assessment-'+String(id||'report').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100)+'.pdf';
 const extended=String(disposition||'').match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i);
 const ordinary=String(disposition||'').match(/(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i);
 let name='';
 if(extended){try{name=decodeURIComponent(extended[1].trim());}catch{}}
 if(!name&&ordinary)name=(ordinary[1]??ordinary[2]).trim().replace(/\\(.)/g,'$1');
 name=name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"|?*]/g,'_').trim().replace(/^\.+/,'');
 if(!name||!name.toLowerCase().endsWith('.pdf'))return fallback;
 return name.slice(0,-4).slice(0,160)+'.pdf';
}

function pdfLocation(saved){
 const pageURL=new URL(window.location.href);
 const appBase=new URL(pageURL.pathname.endsWith('/')||pageURL.pathname.endsWith('/index.html')?'./':pageURL.pathname+'/',pageURL);
 const path=new URL((saved.owner?'api/admin/assessments/':'api/assessments/')+encodeURIComponent(saved.id)+'/pdf',appBase);
 if(path.origin!==pageURL.origin)throw new Error('PDF下载地址无效，请刷新后重试。');
 return {appBase,path};
}
function cancelPDFLink(){
 const current=pdfLink;pdfLink=null;
 if(current){current.request?.controller.abort();clearTimeout(current.expiryTimer);}
 const panel=el('pdfFallback'),url=el('pdfDownloadURL');if(panel)panel.hidden=true;if(url)url.value='';
}
function activePDFLink(current){return pdfLink===current&&report===current.saved&&view==='report'&&user===current.owner;}
function pdfLinkButton(current){
 if(!activePDFLink(current))return;
 const button=el('copyPDFLink');if(!button)return;
 button.disabled=!!current.request||current.copying;button.textContent=current.request?'正在生成链接…':current.copying?'正在复制链接…':current.url&&current.expiresAt>Date.now()?'复制下载链接':'生成并复制下载链接';
}
function showPDFFallback(){
 if(view!=='report'||!report?.id||!user?.id)return null;
 if(pdfLink&&!activePDFLink(pdfLink))cancelPDFLink();
 if(!pdfLink)pdfLink={saved:report,owner:user,url:'',expiresAt:0,request:null,copying:false,expiryTimer:null};
 const panel=el('pdfFallback');if(panel){const opening=panel.hidden;panel.hidden=false;if(opening)panel.scrollIntoView({behavior:'smooth',block:'nearest'});}
 pdfLinkButton(pdfLink);return pdfLink;
}
async function copyPDFLink(){
 const current=showPDFFallback();if(!current||current.request||current.copying)return;
 current.copying=true;pdfLinkButton(current);
 const active=()=>activePDFLink(current);
 const status=el('pdfLinkStatus'),field=el('pdfDownloadURL');
 try{
  if(!current.url||current.expiresAt<=Date.now()){
   current.url='';field.value='';clearTimeout(current.expiryTimer);
   const request={controller:new AbortController(),timedOut:false};current.request=request;pdfLinkButton(current);
   status.textContent='正在生成仅限本报告的临时下载链接…';
   const timeout=setTimeout(()=>{request.timedOut=true;request.controller.abort();},15000);
   let body;
   try{
    const {path}=pdfLocation(current.saved);
    body=await api(new URL(path.href+'-link'),{method:'POST',cache:'no-store',headers:{'X-Assessment-Owner':current.owner.id},signal:request.controller.signal});
   }catch(error){if(request.timedOut)throw new Error('链接生成超时，请重试。');throw error;}
   finally{clearTimeout(timeout);if(current.request===request)current.request=null;}
   if(!active())return;
   const expiresAt=typeof body?.expiresAt==='number'?body.expiresAt:Date.parse(body?.expiresAt);
   if(typeof body?.token!=='string'||!body.token||body.token.length>4096||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('下载链接无效，请重新生成。');
   const link=new URL('report-download.html',pdfLocation(current.saved).appBase);link.hash=encodeURIComponent(body.token);
   current.url=link.href;current.expiresAt=expiresAt;field.value=current.url;
   current.expiryTimer=setTimeout(()=>{if(!active())return;current.url='';field.value='';status.textContent='下载链接已过期，请再次点击按钮生成新链接。';pdfLinkButton(current);},Math.max(0,expiresAt-Date.now()));
  }
  if(!active())return;
  pdfLinkButton(current);
  const until=new Date(current.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  try{
   if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
   await navigator.clipboard.writeText(current.url);
   if(active())status.textContent='链接已复制，请在系统浏览器粘贴打开。有效至 '+until+'；请勿转发。';
  }catch{
   if(!active())return;
   field.focus();field.select();status.textContent='自动复制未成功，请长按或选中上方链接手动复制，再到系统浏览器粘贴打开。有效至 '+until+'。';
  }
 }catch(error){if(active()&&error.name!=='AbortError'){if(error.status===401)fail(error);else status.textContent=error.message||'下载链接暂时无法生成，请重试。';}}
 finally{current.copying=false;if(active())pdfLinkButton(current);}
}

async function downloadPDF(){
 if(pdfDownload||view!=='report'||!report?.id||!user?.id)return;
 showPDFFallback();
 const saved=report,owner=user,ownerId=owner.id,current={controller:new AbortController()};pdfDownload=current;pdfButtons(true);
 const active=()=>pdfDownload===current&&report===saved&&view==='report'&&user===owner;
 const timeout=setTimeout(()=>{current.timedOut=true;current.controller.abort();},120000);
 try{
  const {path}=pdfLocation(saved);
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/pdf','X-Assessment-Owner':ownerId},signal:current.controller.signal});
  if(!active())return;
  if(!response.ok){let body={};try{body=await response.json();}catch{}const error=new Error(typeof body.message==='string'?body.message:typeof body.error==='string'?body.error:response.status===401?'登录已过期，请重新登录。':'报告暂时无法导出，请稍后重试。');error.status=response.status;throw error;}
  if(!/^application\/pdf(?:\s*;|$)/i.test(response.headers.get('Content-Type')||''))throw new Error('服务器未返回PDF文件，请稍后重试。');
  const blob=await response.blob();if(!active())return;
  if(!blob.size)throw new Error('PDF文件为空，请稍后重试。');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  try{link.href=url;link.download=pdfFilename(response.headers.get('Content-Disposition'),saved.id);link.hidden=true;document.body.append(link);link.click();}
  finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 }catch(error){if(active()){if(current.timedOut)toast('PDF生成超时，请稍后重试。');else if(error.name!=='AbortError'){if(error.status===401)fail(error);else toast(error.message||'报告暂时无法导出，请稍后重试。');}}}
 finally{clearTimeout(timeout);if(pdfDownload===current){pdfDownload=null;pdfButtons(false);}}
}

function auth(){quota=null;quotaRequest++;clearPrivateUI();setView('auth');el('main').innerHTML=`<section class="auth-card"><div class="auth-switch" role="group" aria-label="登录或注册"><button type="button" class="auth-tab" data-action="authMode" data-mode="login" aria-pressed="${!register}">登录</button><button type="button" class="auth-tab" data-action="authMode" data-mode="register" aria-pressed="${register}">注册</button></div><p class="auth-first-use">首次使用请注册</p><div class="eyebrow">PERSONAL ASSESSMENT</div><h1>${register?'创建账户':'欢迎回来'}</h1><p class="privacy-note">登录后填写问卷，完成后可在账户中查看历史报告。</p><form id="authForm">${register?'<label class="field"><span>姓名</span><input name="name" autocomplete="name" maxlength="100" required></label>':''}<label class="field"><span>邮箱</span><input type="email" name="email" autocomplete="username" required maxlength="254"></label><label class="field"><span>密码${register?'（至少6位）':''}</span><input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="6"':''} maxlength="128" required></label><p class="error" id="authError" role="alert"></p><button class="btn primary" type="submit">${register?'注册并登录':'登录'}</button></form></section>`;}
async function loadQuestionnaire(version){const questionnaire=await api('/api/questionnaire'+(version===undefined?'':'?version='+encodeURIComponent(version)));if(version!==undefined&&questionnaire.version!==version)throw new Error('已保存进度所需的问卷版本暂时不可用，请稍后重试。原进度已保留。');return questionnaire;}
function useQuestionnaire(questionnaire){data=questionnaire;qMap=Object.fromEntries(data.questions.map(q=>[q.id,q]));pages=data.groups.flatMap((g,group)=>Array.from({length:Math.ceil(g.ids.length/6)},(_,i)=>({group,ids:g.ids.slice(i*6,(i+1)*6)})));}
function checkQuestionnaireVersion(){if(!state.version||data?.version!==state.version)throw new Error('问卷版本与当前进度不一致，请重新打开“继续上次测评”。原进度已保留。');}
function nav(){const c=count();el('sidebar').innerHTML='<div class="nav-label">问卷目录 · 顺序填写</div>'+data.groups.map((g,i)=>`<div class="nav-item ${pages[state.position].group===i?'active':''}"><span class="nav-num">0${i+1}</span><span>${esc(g.name)}</span><small>${g.ids.filter(done).length}/${g.ids.length}</small></div>`).join('')+`<div class="side-bottom"><b>${c} / ${data.total}</b> 道测评题已答<div class="side-progress"><i style="width:${c/data.total*100}%"></i></div>已确认 ${state.committed} / ${pages.length} 页</div>`;}
const familyFields={
 INFO014:[['婚姻状况','status',['未婚','已婚','离异','其他']],['其他说明','other']],
 INFO016:[['配偶/对象工作地','place']],
 INFO017:[['目前是否两地分居','status',['是','否','部分时间']]],
 INFO018:[['目前是否已有子女（选填）','children',['没有','有','不愿填写']],['需要说明的照料或支持安排（选填）','arrangement','textarea']],
 INFO019:[['孩子年龄（岁；多孩可分别填写）','age']],
 INFO020:[['家里最小的孩子上学了吗','stage',['未入学','幼儿园','小学','初中','高中及以上']]],
 INFO022:[['平常谁带孩子（主要照顾人）','carer',['我自己','配偶','男方父母','女方父母','保姆/其他']],['保姆/其他说明','other']],
 INFO023:[['老人目前居住地（选填）','place'],['年龄（可填多位）','age'],['是否与您同住','living',['是','否','部分时间']]],
};
function familyEmptyLabel(id,key){return id==='INFO018'&&key==='children'?'不适用':id==='INFO023'&&key==='living'?'不适用/其他':'无';}
function familyDisplay(value,id,key){const empty=familyEmptyLabel(id,key);return typeof value==='string'&&(value.trim()==='不适用'||(empty!=='无'&&value.trim()==='无'))?empty:value;}
function field(label,key,value,id,choices){
 value=familyDisplay(value,id,key);
 if(Array.isArray(choices)){const empty=familyEmptyLabel(id,key);return `<label class="field"><span>${esc(label)}</span><select data-id="${id}" data-field="${key}" aria-label="${esc(label)}"><option value="">请选择 / ${esc(empty)}</option>${choices.concat(empty).map(v=>`<option ${value===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`;}
 const tag=choices==='textarea'?'textarea':'input';return `<label class="field"><span>${esc(label)}</span>${tag==='textarea'?`<textarea data-id="${id}" data-field="${key}" placeholder="按需填写；无相关情况可填“无”">${esc(value)}</textarea>`:`<input data-id="${id}" data-field="${key}" value="${esc(value)}" placeholder="按需填写；无相关情况可填“无”" maxlength="1000">`}</label>`;
}
// Visible labels may be consecutive while persisted option keys remain archival identifiers.
function optionLabel(q,option){return q.type==='choice'&&q.options.every(o=>/^[A-Z]$/.test(o.key))?String.fromCharCode(65+q.options.findIndex(o=>o.key===option.key)):option.key;}
function question(q){
 const a=state.answers[q.id],answered=done(q.id);let controls='';
 if(q.type==='family')controls=familyFields[q.id].map(([label,key,options])=>field(label,key,a?.[key]||'',q.id,options)).join('');
 else if(q.type==='tenure')controls=`<label class="switch" style="margin-bottom:16px"><input type="checkbox" data-id="${q.id}" data-field="none" ${a?.none?'checked':''}>没有正式工作经历</label>${a?.none?'':`<div class="field-row">${['最近一段','上一段','再上一段'].map((label,i)=>`<label class="field"><span>${label}在职月数</span><input data-id="${q.id}" data-month="${i}" value="${esc(a?.months?.[i]??'')}" placeholder="如12；不存在填0" inputmode="decimal" aria-label="${label}在职月数"></label>`).join('')}</div><label class="field"><span>最近一段状态</span><select data-id="${q.id}" data-field="status"><option value="">请选择</option>${['仍在职','已离职'].map(s=>`<option ${a?.status===s?'selected':''}>${s}</option>`).join('')}</select></label>`}`;
 else if(q.type==='double')controls=q.options.map(o=>`<div class="option" style="cursor:default"><span class="key">${esc(optionLabel(q,o))}</span><span>${esc(o.text)}</span></div>`).join('')+`<div class="double-grid">${[['most','最像我'],['least','最不像我']].map(([slot,label])=>`<label class="field"><span>${label}</span><select data-id="${q.id}" data-slot="${slot}" aria-label="${label}"><option value="">请选择</option>${q.options.map(o=>`<option value="${o.key}" ${a?.[slot]===o.key?'selected':''}>${esc(optionLabel(q,o))} · ${esc(o.text)}</option>`).join('')}</select></label>`).join('')}</div>`;
 else controls=`<div class="${q.type==='scale'?'scale':'options'}">`+q.options.map(o=>`<label class="option ${a===o.key?'selected':''}"><input type="radio" name="${q.id}" value="${o.key}" data-id="${q.id}" ${a===o.key?'checked':''}><span class="key">${esc(optionLabel(q,o))}</span><span>${esc(o.text)}</span></label>`).join('')+'</div>';
 const instructions=q.type==='tenure'?'按月估算，可填小数；不存在的工作经历填0。0值不参与平均；不足1个月可填小数。':q.type==='family'?'':q.instructions.filter(s=>!/最像我：|最不像我：|选择：[_＿]|最像我：[_＿]/.test(s)).join('\n');
 return `<article class="question ${state.focus===q.id?'focused':''}" id="card-${q.id}" data-question="${q.id}" tabindex="0"><div class="q-meta"><b>Q.${String(q.number).padStart(2,'0')}</b><span class="q-state"><span>${q.type==='family'?'信息填写':q.type==='double'?'最像 / 最不像':q.type==='scale'?('程度选择'):q.type==='tenure'?'经历填写':'单项选择'}</span>${answered?'<span class="done">✓ 已填写</span>':''}</span></div><h2 class="q-stem">${esc(q.stem)}</h2>${controls}${instructions?`<p class="instruction">${esc(instructions)}</p>`:''}</article>`;
}
function questionPage(){checkQuestionnaireVersion();setView('questions');const p=pages[state.position],g=data.groups[p.group];nav();el('main').innerHTML=`<div class="hero"><div class="eyebrow">QUESTIONNAIRE / PAGE ${state.position+1} OF ${pages.length}</div><h1>${esc(g.name)}</h1><p>${p.group===0?'工作经历按题目时间范围填写；家庭信息按当前情况选填。':p.group===2?'请根据过去一年通常的体验和习惯作答；五档题按实际发生频率选择。':'按题意回答工作中的选择；带频率选项的题目回顾过去一年内。'}</p><div class="hero-meta"><span class="subtle">已答 <b id="progressCount">${count()}</b> / ${data.total} 道测评题</span><div class="progressbar"><i id="progressFill" style="width:${count()/data.total*100}%"></i></div><span class="subtle">逐页保存进度</span></div></div><p class="privacy-note">确认后立即进入下一页，进度会在后台保存。显示“已保存”后才可安全关闭；已确认页面不可修改。完成最后一页后生成报告。</p>${p.group===0?'<div class="family-note">家庭与支持安排均可留空，只作信息记录，不计分，也不用于用人资格判断。</div>':''}${p.ids.map(id=>question(qMap[id])).join('')}<p id="saveStatus" class="privacy-note" role="status" aria-live="polite"></p><p class="error" id="submitError" role="alert"></p><div class="paginator"><span class="subtle">第 ${state.position+1} / ${pages.length} 页 · 已确认 ${state.committed} / ${pages.length} 页</span><button class="btn primary" data-action="next">${state.position===pages.length-1?'提交并生成报告 →':'确认本页 · 下一页 →'}</button></div>`;if(state.position<state.committed){el('main').querySelectorAll('input,select,textarea').forEach(input=>input.disabled=true);el('submitError').textContent='所有页面已确认，请点击提交完成报告。';}saveStatus();}
// Colors indicate score position, never whether a result is good or bad.
function scoreBandClass(label){switch(label){case '较低':return 'score-band-low';case '稍低':return 'score-band-slightly-low';case '平均':return 'score-band-average';case '稍高':return 'score-band-slightly-high';case '较高':return 'score-band-high';default:return 'score-band-average';}}
function metric(v,total=false){const band=scoreBandClass(v.label);return `<article class="${total?'total-card':'metric-card'}"><div class="eyebrow">${total?'综合指标':'分项指标'}</div><h3>${esc(v.name)}</h3>${v.modelNote?`<p class="privacy-note">${esc(v.modelNote)}</p>`:''}<div class="metric-main"><b class="${total?'big-score':'metric-number'}">${fmt(v.score)}${total?'<small>/ 100</small>':''}</b><span class="delta ${band}">${esc(v.label)}</span></div><div class="metric-bar"><span class="reference-band" style="left:${pct(v.lower)}%;width:${Math.max(0,pct(v.upper)-pct(v.lower))}%"></span><i class="${band}" style="width:${pct(v.score)}%"></i>${Number.isFinite(v.mean)?`<em style="left:${pct(v.mean)}%"></em>`:''}</div><div class="metric-foot"><span>参照中心 ${fmt(v.mean)}<br>参照区间 ${fmt(v.lower)}—${fmt(v.upper)}</span>${v.coverage?`<span>已完成 ${esc(v.coverage.answered)} / ${esc(v.coverage.total)}</span>`:''}</div>${v.definition?`<p class="metric-description">${esc(v.definition)}</p><p class="metric-description"><b>较高：</b>${esc(v.highMeaning)}<br><b>较低：</b>${esc(v.lowMeaning)}</p>`:''}${v.unavailableReason?`<p class="privacy-note">${esc(v.unavailableReason)}</p>`:''}${v.limitation?`<p class="privacy-note">${esc(v.limitation)}</p>`:''}${v.referenceNote&&!/模拟参照|模拟作答|实测人群常模/.test(v.referenceNote)?`<p class="privacy-note">${esc(v.referenceNote)}</p>`:''}</article>`;}
function conclusionCard(v,summary){const interpretation=(summary?.cards||[]).find(card=>card.code===v.code)?.interpretation;return `<article class="total-card" data-conclusion="${esc(v.code)}"><div class="eyebrow">综合指标</div><h3>${esc(v.name)}</h3><div class="metric-main"><b class="big-score">${fmt(v.score)}<small>/ 100</small></b><span class="delta ${scoreBandClass(v.label)}">${esc(v.label)}</span></div><div class="metric-foot"><span>参照中心 ${fmt(v.mean)}<br>参照区间 ${fmt(v.lower)}—${fmt(v.upper)}</span></div><p class="conclusion-interpretation">${esc(interpretation||v.unavailableReason||'本记录暂缺结论说明，请结合下方分项与使用限制阅读。')}</p></article>`;}
function radar(title,items,hint='各维度的含义与高低分说明见下方卡片。'){if(items.length<3)return '';const cx=260,cy=245,r=137,n=items.length,point=(i,v)=>[cx+Math.sin(2*Math.PI*i/n)*r*pct(v)/100,cy-Math.cos(2*Math.PI*i/n)*r*pct(v)/100],poly=vals=>vals.map((v,i)=>point(i,v).join(',')).join(' ');const grid=[20,40,60,80,100].map(v=>`<polygon points="${poly(items.map(()=>v))}" fill="none" stroke="#dbe1e7"/><text x="266" y="${cy-r*v/100+4}" font-size="12" fill="#697b8a">${v}</text>`).join('');const axes=items.map((v,i)=>{const [x,y]=point(i,100),a=2*Math.PI*i/n,lx=cx+Math.sin(a)*r*1.42,ly=cy-Math.cos(a)*r*1.42,lines=Array.from(v.name||'').reduce((out,ch,j)=>{if(j%5===0)out.push('');out[out.length-1]+=ch;return out;},[]);return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e3e8ed"/><text x="${lx}" y="${ly-(lines.length-1)*10}" text-anchor="middle" font-size="17" fill="#4b6070">${lines.map((line,j)=>`<tspan x="${lx}" dy="${j?20:0}">${esc(line)}</tspan>`).join('')}<title>${esc(v.name)}</title></text>`;}).join('');return `<article class="radar-card${items.length>7?' radar-card-wide':''}"><h3>${esc(title)}</h3><svg viewBox="0 0 520 490" role="img" aria-label="${esc(title)}，固定0到100分刻度">${grid}${axes}${items.every(v=>Number.isFinite(v.mean))?`<polygon points="${poly(items.map(v=>v.mean))}" fill="none" stroke="#78909f" stroke-width="2" stroke-dasharray="6 4"/>`:''}${items.every(v=>Number.isFinite(v.score))?`<polygon points="${poly(items.map(v=>v.score))}" fill="#d9663721" stroke="#d96637" stroke-width="2.5"/>`:''}${items.filter(v=>Number.isFinite(v.score)).map(v=>{const [x,y]=point(items.indexOf(v),v.score);return `<circle cx="${x}" cy="${y}" r="4" fill="#d96637"><title>${esc(v.name)} ${fmt(v.score)}</title></circle>`;}).join('')}</svg><div class="radar-legend"><span><i class="legend-line"></i>本次得分</span><span><i class="legend-line gray"></i>参照中心</span></div><p class="radar-hint">${esc(hint)}</p></article>`;}
function employmentFacts(answers){const tenure=answers?.tenure,months=tenure?.months;let detail='';if(Array.isArray(months)&&months.length===3){detail=months.map((value,i)=>`<p>${['最近一段','上一段','再上一段'][i]}：${value===null?'未填写':value==='无'?'无':esc(value)+'个月'+(value===0?'（无该段经历）':'')}</p>`).join('')+`<p>最近一段状态：${esc(tenure.status||'未填写')}</p>`;if(tenure.noExperience)detail='<p>没有正式工作经历</p>'+detail;}else if(tenure?.noExperience){detail='<p>没有正式工作经历</p>';}else{detail=(tenure?.recordedMonths?.length?`<p>已记录的在职月数：${tenure.recordedMonths.map(value=>esc(value)+'个月').join(' / ')}</p><p>原记录未保留各段对应关系。</p>`:'<p>在职月数：未填写 / 原记录未保留</p>')+`<p>最近一段状态：${esc(tenure?.status||(answers?.source==='completion'?'未填写':'原记录未保留'))}</p>`;}return `<div class="section-heading"><h2>工作经历</h2><span>原始作答</span></div><div class="fact-grid"><article class="fact-card"><h3>过去5年雇主经历</h3><p>${esc(answers?.employersText||'未填写 / 原记录不可用')}</p></article><article class="fact-card"><h3>最近三段工作经历</h3>${detail}</article></div>`;}
function showReport(saved){report=saved;setView('report');const r=saved.report,dims=r.dimensions||[],groups=[['职业稳定性',['ST1','ST2','WV_STABILITY','WV_GROWTH','WV_REWARD']],['职业性格',['PF1','PF2','PF3','PF4','PF5','PF6','PF7','SJ1','SJ2','SJ3']],['心理困扰倾向',['MH1','MH2','MH3','MH4','MH5','MH6']],['掩饰性与作答质量',['RV1','RV2','RV3']]],domainItems=codes=>codes.map(code=>dims.find(v=>v.code===code)).filter(Boolean),date=new Date(saved.createdAt).toLocaleString('zh-CN');el('main').innerHTML=`<div class="results-intro"><div class="hero"><div class="eyebrow">ASSESSMENT / COMPLETE</div><h1>测评结果</h1>${saved.owner?`<p>测评账户：${esc(saved.owner.name)} · ${esc(saved.owner.email)}</p><button class="btn" data-action="adminHistory">返回管理历史</button>`:''}<p>${esc(r.answered)} / ${esc(r.total)} 道测评题${r.displayVersion||r.releaseVersion?` · 报告 V${esc(r.displayVersion||r.releaseVersion)}`:''}<br>${esc(date)}</p></div><div class="result-actions"><button class="btn primary" data-action="downloadPDF">导出PDF</button><button class="btn" data-action="history">返回历史报告</button></div></div><section id="pdfFallback" class="pdf-fallback" aria-labelledby="pdfFallbackTitle" hidden><h2 id="pdfFallbackTitle">没有弹出PDF下载？</h2><p>微信内可点击右上角“…” → “在浏览器打开”，然后再次导出；也可生成下方下载链接，复制到 Safari / Chrome 等系统浏览器打开。</p><p>链接仅用于下载本报告，10分钟后失效。任何持有链接的人都可下载，请勿转发。</p><button id="copyPDFLink" type="button" class="btn" data-action="copyPDFLink">生成并复制下载链接</button><label class="field" for="pdfDownloadURL"><span>下载链接（可长按复制）</span><textarea id="pdfDownloadURL" rows="3" readonly spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="pdfLinkStatus" placeholder="点击上方按钮生成下载链接"></textarea></label><p id="pdfLinkStatus" role="status" aria-live="polite">如下载未开始，请使用此处的备用方式。</p></section>${r.rescoringNotice?`<p class="privacy-note" role="status">${esc(r.rescoringNotice)}</p>`:''}${r.pfReinterpretationNotice?`<p class="privacy-note">${esc(r.pfReinterpretationNotice)}</p>`:''}<p class="privacy-note">颜色仅区分得分档位，高低分的具体含义请结合各项说明。</p><div class="domain-totals conclusion-cards">${['ST','PF','MH'].map(code=>(r.totals||[]).find(v=>v.code===code)).filter(Boolean).map(v=>conclusionCard(v,r.reportSummary)).join('')}</div><section class="report-summary"><div class="section-heading"><h2>本次总体概述</h2></div><p class="summary-overview">${esc(r.reportSummary?.overview||'本记录暂缺总体概述，请结合各领域分项与使用限制阅读。')}</p></section>${groups.map(([title,codes],index)=>`<section class="report-domain"><div class="section-heading"><h2>${title}</h2></div>${index<3?`<div class="radars domain-radar">${radar(title,domainItems(codes))}</div>`:`<div class="domain-totals quality-total">${(r.totals||[]).filter(v=>v.code==='RV').map(v=>metric(v,true)).join('')}</div>`}${title==='职业稳定性'?`<p class="privacy-note">${esc(r.workValueNotice||r.workValueUnavailable||'本记录暂无法展示工作价值观分项。')}</p>${r.workValueDerivationNotice?`<p class="privacy-note">${esc(r.workValueDerivationNotice)}</p>`:''}`:''}<div class="metric-grid">${domainItems(codes).map(v=>metric(v)).join('')}</div></section>`).join('')}${employmentFacts(r.employmentAnswers)}<div class="section-heading"><h2>家庭与支持信息</h2><span>仅作信息记录</span></div><div class="fact-card family-report">${(r.family||[]).map(q=>`<div><b>${esc(q.stem)}</b><p>${familyText(q)}</p></div>`).join('')}</div><p class="report-note">测评供个人探索，不作诊断或资格判断。</p>${(r.interpretationNotes||[]).map(note=>`<p class="privacy-note">${esc(note)}</p>`).join('')}<div class="result-actions"><button class="btn primary" data-action="downloadPDF">导出PDF</button><button class="btn" data-action="history">全部历史报告</button></div>`;window.scrollTo({top:0});}
function familyText(q){const a=q.answer||{};return (familyFields[q.id]||[]).filter(([,key])=>String(a[key]||'').trim()).map(([label,key])=>`${esc(label)}：${esc(familyDisplay(a[key],q.id,key))}`).join('<br>')||'未填 / 无';}
async function history(){setView('history');el('main').innerHTML='<p class="loading">正在读取历史报告…</p>';const [body,draftResponse]=await Promise.all([api('/api/assessments'),api('/api/draft')]);savedDraft=draftResponse.draft;el('main').innerHTML=`<div class="hero"><div class="eyebrow">YOUR ASSESSMENTS</div><h1>历史报告</h1><p>已提交的测评会保存在您的账户中。</p></div>${body.assessments.length?body.assessments.map(a=>`<article class="history-row"><div><b>职业与心理健康测评</b><p>${esc(new Date(a.createdAt).toLocaleString('zh-CN'))}</p></div><button class="btn" data-action="report" data-id="${esc(a.id)}">查看报告</button></article>`).join(''):'<div class="fact-card">暂无已完成的测评。点击右上角“新测评”开始。</div>'}${savedDraft||state.version||Object.keys(state.answers).length||heldState?.userId===user?.id?'<button class="btn primary" data-action="resume">继续上次测评</button>':''}`;}
async function adminHistory(offset=0){setView('adminHistory');el('main').innerHTML='<p class="loading">正在读取测评历史…</p>';const body=await api('/api/admin/assessments?offset='+offset);el('main').innerHTML=`<div class="hero"><div class="eyebrow">ADMIN / ASSESSMENT HISTORY</div><h1>测评历史管理</h1><p>查看已完成测评的报告和逐题作答。管理员查看会记录访问日志。</p></div>${body.assessments.length?body.assessments.map(a=>`<article class="history-row"><div><b>${esc(a.user.name||a.user.email)}</b><p>${esc(a.user.email)}<br>V${esc(a.version)} · ${esc(new Date(a.createdAt).toLocaleString('zh-CN'))}</p></div><div class="result-actions"><button class="btn" data-action="adminReport" data-id="${esc(a.id)}">查看报告</button><button class="btn" data-action="adminAnswers" data-id="${esc(a.id)}">答题详情</button></div></article>`).join(''):'<div class="fact-card">暂无已完成的测评。</div>'}<div class="report-actions">${offset?`<button class="btn" data-action="adminHistory" data-offset="${Math.max(0,offset-50)}">上一页</button>`:''}${body.nextOffset!==null?`<button class="btn" data-action="adminHistory" data-offset="${body.nextOffset}">下一页</button>`:''}</div>`;}
function showAnswerDetails(saved){clearPrivateUI();setView('adminAnswers');el('main').innerHTML=`<div class="hero"><div class="eyebrow">答题详情 · 只读</div><h1>逐题作答</h1><p>${esc(saved.owner.name)} · ${esc(saved.owner.email)}<br>${esc(new Date(saved.createdAt).toLocaleString('zh-CN'))} · 问卷版本 ${esc(saved.questionnaireVersion)}</p><button class="btn" data-action="adminHistory">返回管理历史</button></div>${saved.questions.map(q=>`<article class="question"><div class="q-meta"><b>第 ${esc(q.number)} 题</b><span>${q.answered?'已填写':'无/未填写'}</span></div><h2 class="q-stem">${esc(q.stem)}</h2>${q.instructions?.length?`<p class="instruction">${q.instructions.map(esc).join('<br>')}</p>`:''}${q.options?.length?`<div class="privacy-note">${q.options.map(o=>`${esc(optionLabel(q,o))} · ${esc(o.text)} <b>${esc(({selected:'（已选）',most:'（最像我）',least:'（最不像我）',unselected:'（未选）'})[o.selection]||'')}</b>`).join('<br>')}</div>`:''}${q.fields?.length?`<div class="privacy-note">${q.fields.map(field=>`<p><b>${esc(field.label)}</b>：${esc(field.value)}${field.options.length?`<br>${field.options.map(option=>`${esc(option.text)} ${option.selected?'（已选）':'（未选）'}`).join(' · ')}`:''}</p>`).join('')}</div>`:''}<div class="family-note"><b>提交的回答</b><p style="white-space:pre-wrap">${esc(q.answerText)}</p></div></article>`).join('')}<button class="btn" data-action="adminHistory">返回管理历史</button>`;window.scrollTo({top:0});}
function fail(error){if(error.code==='QUOTA_EXHAUSTED'){if(view==='questions'&&el('submitError'))el('submitError').textContent=error.message+' 已填写内容已保留，可稍后重试。';else toast(error.message);if(user)refreshQuotaQuietly();return;}if(error.status===401){if(user&&(state.version||Object.keys(state.answers).length))heldState={userId:state.ownerId||user.id,state};user=null;state=fresh();data=null;auth();toast('登录已过期。请用同一账户重新登录，未保存内容仍保留在此页面，请勿关闭。');return;}const target=el('submitError')||el('authError');if(target)target.textContent=error.message;else el('main').innerHTML=`<p class="error" role="alert">${esc(error.message)}</p><button class="btn" data-action="history">重新加载</button>`;}
function draftPayload(position){checkQuestionnaireVersion();const ids=new Set(pages.slice(0,position).flatMap(p=>p.ids));return {version:state.version,answers:Object.fromEntries(Object.entries(state.answers).filter(([id])=>ids.has(id)).map(([id,a])=>[id,qMap[id].type==='tenure'?{...a,months:(a.months||[]).map(Number)}:a])),seconds:Object.fromEntries(Object.entries(state.seconds).filter(([id])=>ids.has(id))),position};}
function saveStatus(){const node=el('saveStatus');if(!node)return;node.innerHTML=state.saveError?`<span class="error">未保存，请保持此页面打开。</span> <button class="btn" data-action="retrySave">重试保存</button>`:state.queue.length?`保存中 · 已保存 ${state.confirmed} / ${state.committed} 页，请勿关闭页面`:`已保存 ${state.confirmed} 页`;}
function drain(st=state){if(st.saving)return st.saving;if(!st.queue.length)return Promise.resolve();st.saveError=null;st.saving=(async()=>{try{while(st.queue.length){if(st!==state)throw new Error('请使用原账户恢复未保存进度。');const payload=st.queue[0],controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);try{await api('/api/draft',{method:'PUT',body:JSON.stringify(payload),headers:{'X-Assessment-Owner':st.ownerId||''},signal:controller.signal});}catch(error){if(error.name==='AbortError')throw new Error('保存超时，请重试。');throw error;}finally{clearTimeout(timeout);}st.confirmed=payload.position;st.queue.shift();if(st===state)saveStatus();}}catch(error){st.saveError=error;throw error;}finally{st.saving=null;if(st===state)saveStatus();}})();saveStatus();return st.saving;}
function saveDraft(position){if(position<=state.committed)return;const payload=JSON.parse(JSON.stringify(draftPayload(position)));state.queue.push(payload);state.committed=position;for(const [id,value] of Object.entries(payload.seconds))state.seconds[id]=value;if(!state.saveError)drain().catch(()=>{});}
async function awaitSaved(){await drain();if(state.queue.length)throw state.saveError||new Error('进度尚未保存，请重试。');}
function requestConsent(notice){
 if(!notice||typeof notice.version!=='string'||typeof notice.text!=='string'||!notice.text.trim())throw new Error('指导语暂时无法加载，请稍后重试。');
 flush();consentOpen=true;
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog');dialog.className='consent-dialog';dialog.setAttribute('aria-labelledby','consentTitle');
  dialog.innerHTML=`<h2 id="consentTitle">测评指导语与知情同意</h2><div class="consent-text">${esc(notice.text)}</div><label class="consent-choice"><input type="checkbox" id="consentCheck"><span>我已阅读并理解以上指导语，同意参加本次测评及上述结果使用安排。</span></label><div class="consent-actions"><button type="button" class="btn" data-consent="cancel">取消</button><button type="button" class="btn primary" data-consent="accept" disabled>同意并开始</button></div>`;
  const checkbox=dialog.querySelector('#consentCheck'),accept=dialog.querySelector('[data-consent="accept"]');let finished=false;
  const finish=value=>{if(finished)return;finished=true;consentOpen=false;last=performance.now();if(dialog.open)dialog.close();dialog.remove();resolve(value);};
  checkbox.addEventListener('change',()=>{accept.disabled=!checkbox.checked;});
  accept.addEventListener('click',()=>{if(checkbox.checked)finish(true);});
  dialog.querySelector('[data-consent="cancel"]').addEventListener('click',()=>finish(false));
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));
  document.body.append(dialog);
  try{dialog.showModal();checkbox.focus();}catch(error){consentOpen=false;dialog.remove();reject(new Error('同意窗口暂时无法打开，请刷新后重试。'));}
 });
}
async function recordConsent(notice,ownerId){return api('/api/consent',{method:'POST',body:JSON.stringify({version:notice.version,accepted:true}),headers:{'X-Assessment-Owner':ownerId}});}
function attemptId(value){if(typeof value!=='string'||!value)throw new Error('测评记录编号暂时无法读取，请稍后重试。原进度已保留。');return value;}
async function start(){
 const owner=user;await requireQuota(owner);
 if(heldState&&heldState.userId!==user?.id&&!confirm('另一账户有未保存内容。开始新测评将丢弃那份内容，确认继续？'))return;
 if(state.queue.length)await awaitSaved();
 if((savedDraft||state.version||Object.keys(state.answers).length||heldState?.userId===user?.id)&&!confirm('开始新测评将删除上次尚未完成的测评。继续吗？'))return;
 checkAccount(owner);const ownerId=owner.id,consent=await api('/api/consent');checkAccount(owner);
 if(!await requestConsent(consent.notice))return;
 checkAccount(owner);await requireQuota(owner);const questionnaire=await loadQuestionnaire();checkAccount(owner);
 await api('/api/draft',{method:'DELETE',headers:{'X-Assessment-Owner':ownerId}});
 checkAccount(owner);const accepted=await recordConsent(consent.notice,ownerId);checkAccount(owner);const submissionId=attemptId(accepted.consent?.id);
 useQuestionnaire(questionnaire);state=fresh();state.ownerId=ownerId;state.version=data.version;state.submissionId=submissionId;state.seconds=Object.fromEntries(data.questions.filter(q=>q.type!=='family'&&q.type!=='tenure').map(q=>[q.id,0]));savedDraft=null;heldState=null;state.focus=pages[0].ids[0];questionPage();window.scrollTo({top:0});
}
async function resume(){
 if(heldState&&heldState.userId!==user?.id&&!confirm('另一账户有未保存内容。继续此账户测评将丢弃那份内容，确认继续？'))return;
 const owner=user;let resumed=heldState?.userId===user?.id?heldState.state:state;
 if(resumed.ownerId&&resumed.ownerId!==owner?.id)throw new Error('请使用原账户恢复未保存进度。');
 await requireQuota(owner);
 if(!resumed.version&&!Object.keys(resumed.answers).length){
  const response=await api('/api/draft');checkAccount(owner);const draft=response.draft;if(!draft)return history();
  resumed={...fresh(),ownerId:owner.id,version:draft.version,answers:draft.answers||{},seconds:draft.seconds||{},position:Number(draft.position)||0,committed:Number(draft.position)||0,confirmed:Number(draft.position)||0,submissionId:draft.submissionId||null};
 }
 if(resumed.ownerId!==user?.id)throw new Error('请使用原账户恢复未保存进度。');
 if(typeof resumed.version!=='string'||!resumed.version)throw new Error('已保存进度缺少问卷版本，暂时无法恢复。原进度已保留。');
 const ownerId=owner.id,consent=await api('/api/consent');checkAccount(owner);let accepted=consent;
 if(consent.required||!consent.consent){if(!await requestConsent(consent.notice))return;checkAccount(owner);await requireQuota(owner);accepted=await recordConsent(consent.notice,ownerId);checkAccount(owner);}
 const submissionId=attemptId(resumed.submissionId||accepted.consent?.id);
 const questionnaire=data?.version===resumed.version?data:await loadQuestionnaire(resumed.version);checkAccount(owner);
 useQuestionnaire(questionnaire);state=resumed;state.submissionId=submissionId;heldState=null;state.position=Math.min(pages.length-1,Math.max(0,state.position));
 state.seconds={...Object.fromEntries(data.questions.filter(q=>q.type!=='family'&&q.type!=='tenure').map(q=>[q.id,0])),...state.seconds};
 if(!state.focus)state.focus=pages[state.position].ids[0];questionPage();
}
async function next(){checkQuestionnaireVersion();const missing=pages[state.position].ids.filter(id=>qMap[id].type!=='family'&&!done(id));if(missing.length){el('submitError').textContent=`本页还有 ${missing.length} 道题未完成。请检查选择和工作经历月数。`;el('card-'+missing[0]).focus();el('card-'+missing[0]).scrollIntoView({behavior:'smooth',block:'center'});return;}flush();if(state.position<pages.length-1){saveDraft(state.position+1);state.position++;state.focus=pages[state.position].ids[0];questionPage();window.scrollTo({top:0});return;}const button=document.querySelector('[data-action="next"]');button.disabled=true;button.textContent='正在提交…';try{if(state.committed<pages.length)saveDraft(pages.length);el('main').querySelectorAll('input,select,textarea').forEach(input=>input.disabled=true);await awaitSaved();const saved=await post('/api/assessments',{version:state.version,answers:Object.fromEntries(Object.entries(state.answers).map(([id,a])=>[id,qMap[id].type==='tenure'?{...a,months:(a.months||[]).map(Number)}:a])),seconds:state.seconds,submissionId:state.submissionId},state.ownerId);state=fresh();savedDraft=null;showReport(saved);await refreshQuotaQuietly();}finally{if(button.isConnected){button.disabled=false;button.textContent='重试提交并生成报告 →';}}}
function mutate(target){const id=target.dataset.id;if(!id||busy||view!=='questions'||state.position<state.committed||!pages[state.position].ids.includes(id))return;flush();state.focus=id;const q=qMap[id];let a=state.answers[id],rerender=false;if(q.type==='family'){if(!(familyFields[id]||[]).some(f=>f[1]===target.dataset.field))return;a={...(a||{}),[target.dataset.field]:target.value.slice(0,1000)};}else if(q.type==='tenure'){a={none:false,months:['','',''],status:'',...(a||{})};if(target.dataset.field==='none'){a.none=target.checked;if(a.none){a.months=['0','0','0'];a.status='';}rerender=true;}else if(target.dataset.month!==undefined){a.months=[...a.months];a.months[Number(target.dataset.month)]=target.value.trim();}else a.status=target.value;}else if(q.type==='double'){a={...(a||{}),[target.dataset.slot]:target.value};const other=target.dataset.slot==='most'?'least':'most';if(a[other]===target.value&&target.value){a[other]='';toast('最像与最不像须选择不同选项。');}rerender=true;}else{a=target.value;rerender=true;}state.answers[id]=a;if(rerender)el('card-'+id).outerHTML=question(q);nav();el('progressCount').textContent=count();el('progressFill').style.width=count()/data.total*100+'%';}
document.addEventListener('input',event=>{if(event.target.matches('input:not([type=radio]):not([type=checkbox]),textarea')&&event.target.dataset.id)mutate(event.target);});
document.addEventListener('change',event=>{if(event.target.matches('select,input[type=radio],input[type=checkbox]')&&event.target.dataset.id)mutate(event.target);});
document.addEventListener('focusin',event=>{const card=event.target.closest('[data-question]');if(card&&view==='questions'){flush();state.focus=card.dataset.question;}});
document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button||busy)return;const action=button.dataset.action;if(action==='authMode'){register=button.dataset.mode?button.dataset.mode==='register':!register;auth();return;}if(action==='copyAccountId'){if(!user?.id)return;try{await navigator.clipboard.writeText(user.id);toast('账户编号已复制');}catch{toast('账户编号：'+user.id);const note=document.createElement('p');note.className='privacy-note';note.textContent='账户编号：'+user.id;el('main').prepend(note);}return;}if(action==='downloadPDF'){await downloadPDF();return;}if(action==='copyPDFLink'){await copyPDFLink();return;}cancelPDFDownload();cancelPDFLink();busy=true;try{if(action==='new')await start();if(action==='resume')await resume();if(action==='history'){await awaitSaved();await history();}if(action==='retrySave'){await awaitSaved();saveStatus();}if(action==='adminHistory'){await awaitSaved();await adminHistory(Number(button.dataset.offset)||0);}if(action==='adminAnswers'){await awaitSaved();showAnswerDetails(await api('/api/admin/assessments/'+encodeURIComponent(button.dataset.id)+'/answers'));}if(action==='adminReport'){await awaitSaved();showReport(await api('/api/admin/assessments/'+encodeURIComponent(button.dataset.id)));}if(action==='next')await next();if(action==='report'){await awaitSaved();showReport(await api('/api/assessments/'+encodeURIComponent(button.dataset.id)));}if(action==='logout'){await awaitSaved();if(Object.keys(state.answers).length&&!confirm('退出将丢失当前页尚未确认的内容；此前已确认的页面已保存。确认退出？'))return;await post('/api/auth/sign-out',{});user=null;data=null;state=fresh();auth();}}catch(error){fail(error);}finally{busy=false;}});
document.addEventListener('submit',async event=>{if(event.target.id!=='authForm')return;event.preventDefault();if(busy)return;busy=true;const form=event.target,button=form.querySelector('button[type=submit]'),fields=new FormData(form);button.disabled=true;el('authError').textContent='';try{await post('/api/auth/'+(register?'sign-up/email':'sign-in/email'),Object.fromEntries(fields));user=(await api('/api/me')).user;quota=null;account();clearPrivateUI();form.reset();state=fresh();if(heldState?.userId===user.id){try{await resume();drain().catch(()=>{});}catch(error){if(error.code==='QUOTA_EXHAUSTED')await history();throw error;}}else{await history();await refreshQuotaQuietly();if(heldState)toast('另一账户的未保存内容仍保留，请使用原账户登录恢复。');}}catch(error){fail(error);}finally{busy=false;if(button.isConnected)button.disabled=false;}});
setInterval(flush,1000);document.addEventListener('visibilitychange',flush);window.addEventListener('blur',flush);window.addEventListener('focus',()=>{last=performance.now();});window.addEventListener('beforeunload',event=>{if(Object.keys(state.answers).length||heldState){event.preventDefault();event.returnValue='';}});
(async()=>{try{user=(await api('/api/me')).user;await history();await refreshQuotaQuietly();}catch(error){if(error.status===401)auth();else fail(error);}})();
})();
