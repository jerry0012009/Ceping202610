/* Printable report is a view of the authorized response already in memory.
   It never fetches/stores answers, recalculates scores, or creates a public PDF URL. */
(function (global) {
  'use strict';
  const version = '2.11-report-3';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => Number.isFinite(value) ? value.toFixed(1) : '—';
  const pct = value => Math.max(0, Math.min(100, Number(value) || 0));
  const bands = {'较低':'low','稍低':'slightly-low','平均':'average','稍高':'slightly-high','较高':'high'};
  let root = null, generation = 0, pending = Promise.resolve(), current = null, originalTitle = null;
  const p = (text, cls = '') => text ? `<p class="${cls}">${esc(text)}</p>` : '';
  function badge(row) {
    return `<span class="rp-badge score-band-${Object.hasOwn(bands,row.label) ? bands[row.label] : 'average'}">${esc(row.label || '无参照')}</span>`;
  }
  function bar(row) {
    // SVG preserves thin reference marks and colors even when background printing is disabled.
    return `<svg class="rp-scorebar" role="img" aria-label="本次得分 ${fmt(row.score)}，参照中心 ${fmt(row.mean)}，参照区间 ${fmt(row.lower)}至${fmt(row.upper)}"><rect x="0" y="8pt" width="100%" height="5pt" fill="#edf2f6"/>${Number.isFinite(row.lower) && Number.isFinite(row.upper) ? `<rect x="${pct(row.lower)}%" y="6pt" width="${Math.max(0,pct(row.upper)-pct(row.lower))}%" height="9pt" fill="#c3d1dc"/>` : ''}${Number.isFinite(row.mean) ? `<line x1="${pct(row.mean)}%" x2="${pct(row.mean)}%" y1="2pt" y2="19pt" stroke="#657887" stroke-width="1pt"/>` : ''}${Number.isFinite(row.score) ? `<circle cx="${pct(row.score)}%" cy="10.5pt" r="3.2pt" fill="#28465f"/>` : ''}</svg>`;
  }
  function metric(row) {
    return `<article class="rp-metric" data-metric="${esc(row.code)}"><div class="rp-metric-title"><h3>${esc(row.name)}</h3><strong>${fmt(row.score)}</strong></div><div class="rp-metric-meta">${badge(row)}<span>参照中心 ${fmt(row.mean)} · 参照区间 ${fmt(row.lower)}–${fmt(row.upper)}</span></div>${bar(row)}${p(row.modelNote,'rp-muted rp-small')}${p(row.definition)}${row.highMeaning ? `<p><b>较高：</b>${esc(row.highMeaning)}</p>` : ''}${row.lowMeaning ? `<p><b>较低：</b>${esc(row.lowMeaning)}</p>` : ''}${p(row.unavailableReason,'rp-muted rp-small')}${p(row.limitation,'rp-muted rp-small')}${p(row.referenceNote,'rp-muted rp-small')}${row.coverage ? p(`已完成 ${row.coverage.answered} / ${row.coverage.total}`,'rp-muted rp-small') : ''}</article>`;
  }
  const pairs = rows => Array.from({length:Math.ceil(rows.length/2)},(_,i) => `<div class="rp-pair">${rows.slice(i*2,i*2+2).map(metric).join('')}</div>`);
  function radar(title, items) {
    if (items.length < 3) return `<div>${p(title,'rp-section-label')}${p('本记录缺少足够的分项，暂无法绘制轮廓。','rp-muted')}</div>`;
    const cx=126,cy=102,r=61,n=items.length;
    const point=(i,v,rad=r) => [cx+Math.sin(2*Math.PI*i/n)*rad*pct(v)/100,cy-Math.cos(2*Math.PI*i/n)*rad*pct(v)/100];
    const polygon=values => values.map((v,i) => point(i,v).join(',')).join(' ');
    const wrap={'自驱与成就追求':['自驱与成就','追求'],'留任与任务持续倾向':['留任与任务','持续倾向'],'情绪调节困难倾向':['情绪调节','困难倾向'],'注意集中困难倾向':['注意集中','困难倾向'],'紧张与压力反应':['紧张与','压力反应']};
    const grid=[20,40,60,80,100].map(value => `<polygon points="${polygon(items.map(()=>value))}" fill="none" stroke="#d9e1e6" stroke-width=".5"/><text x="${cx+3}" y="${cy-r*value/100+3}" font-size="6.5" fill="#657887">${value}</text>`).join('');
    const axes=items.map((row,i) => {const [x,y]=point(i,100),a=2*Math.PI*i/n,tx=cx+Math.sin(a)*99,ty=cy-Math.cos(a)*88,lines=wrap[row.name]||[row.name];return `<path d="M${cx} ${cy}L${x} ${y}" stroke="#d9e1e6" stroke-width=".5"/><text x="${tx}" y="${ty-(lines.length-1)*5}" text-anchor="middle" font-size="8.1" fill="#657887">${lines.map((line,j)=>`<tspan x="${tx}" dy="${j?10:0}">${esc(line)}</tspan>`).join('')}</text>`;}).join('');
    const reference=items.every(row=>Number.isFinite(row.mean)) ? `<polygon points="${polygon(items.map(row=>row.mean))}" fill="none" stroke="#627f97" stroke-width="1.1" stroke-dasharray="3 2"/>` : '';
    const scores=items.every(row=>Number.isFinite(row.score)) ? `<polygon points="${polygon(items.map(row=>row.score))}" fill="none" stroke="#28465f" stroke-width="1.5"/>` : '';
    const dots=items.map((row,i)=>{if(!Number.isFinite(row.score))return '';const [x,y]=point(i,row.score);return `<circle cx="${x}" cy="${y}" r="2.3" fill="#28465f"/>`;}).join('');
    return `<article class="rp-radar"><h3>${esc(title)}</h3><div class="rp-radar-grid"><svg viewBox="0 0 254 201" role="img" aria-label="${esc(title)}，固定0至100刻度">${grid}${axes}${reference}${scores}${dots}</svg><div class="rp-radar-table"><div class="rp-radar-table-head"><span>分项指标</span><span>得分</span><span>中心</span></div>${items.map(row=>`<div><span>${esc(row.name)}</span><b>${fmt(row.score)}</b><span>${fmt(row.mean)}</span></div>`).join('')}</div></div></article>`;
  }
  function recordRows(label, value) {
    // User-entered fields are at most 1,000 characters each. Small lossless chunks
    // allow long notes and unbroken text to continue without splitting/clipping a page.
    const chars=Array.from(String(value ?? '未填 / 无'));
    const chunks=Array.from({length:Math.max(1,Math.ceil(chars.length/220))},(_,i)=>chars.slice(i*220,i*220+220).join(''));
    return chunks.map((chunk,i)=>`<div class="rp-record-row"><div>${esc(label)}${i?'（续）':''}</div><div>${esc(chunk)}</div></div>`);
  }
  function employmentRows(answers) {
    const tenure=answers?.tenure, months=tenure?.months;
    const rows=recordRows('过去5年雇主经历',answers?.employersText || '未填写 / 原记录不可用');
    if(tenure?.noExperience) rows.push(...recordRows('工作经历','没有正式工作经历'));
    if(Array.isArray(months) && months.length===3) {
      months.forEach((value,i)=>rows.push(...recordRows(['最近一段','上一段','再上一段'][i],value===null?'未填写':value==='无'?'无':`${value}个月${value===0?'（无该段经历）':''}${i===0?' · '+(tenure.status||'未填写'):''}`)));
    } else if(!tenure?.noExperience) {
      rows.push(...recordRows('在职月数',tenure?.recordedMonths?.length ? `已记录：${tenure.recordedMonths.join(' / ')}个月；原记录未保留各段对应关系。` : '未填写 / 原记录未保留'));
      rows.push(...recordRows('最近一段状态',tenure?.status || (answers?.source==='completion'?'未填写':'原记录未保留')));
    }
    return rows.map(html=>html.replace('class="rp-record-row"','class="rp-record-row rp-employment-row"'));
  }
  function sections(saved, options={}) {
    const r=saved.report || {}, dims=r.dimensions || [], totals=r.totals || [];
    const byPrefix=prefix=>dims.filter(row=>row.code?.startsWith(prefix));
    const answerVersion=r.answerVersion || saved.version || r.version || '—', scoringVersion=r.scoringVersion || r.version || '—';
    const date=new Date(saved.createdAt), dateText=Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN').replaceAll('/','.') : '未记录';
    const sample=options.sample===true, owner=saved.owner || options.owner;
    const subtitle=sample?'基于虚拟作答生成，仅用于展示报告形式':'';
    const heading=(text,note='')=>`<div class="rp-subheading"><h3>${esc(text)}</h3>${p(note,'rp-muted rp-small')}</div>`;
    const coverIntro=`<div class="rp-cover-intro"><h2>建筑行业生产管理岗</h2><div class="rp-cover-meta"><span>作答完成 ${esc(r.answered)} / ${esc(r.total)}</span><span>答卷 V${esc(answerVersion)} · 计分 V${esc(scoringVersion)}</span><span>${esc(dateText)}</span></div>${owner?p(`测评账户：${owner.name || ''}${owner.email?' · '+owner.email:''}`,'rp-muted rp-small'):''}</div>`;
    const overview=totals.map(row=>`<article class="rp-overview" data-overview="${esc(row.code)}"><div><h3>${esc(row.name)}</h3><strong>${fmt(row.score)} / 100</strong>${badge(row)}</div>${bar(row)}${p(`参照中心 ${fmt(row.mean)} · 参照区间 ${fmt(row.lower)}–${fmt(row.upper)}`,'rp-muted')}${p(row.unavailableReason,'rp-muted rp-small')}</article>`);
    const family=[];
    for(const q of r.family||[]) {
      const label=String(q.stem||'家庭与支持信息').replace(/[_＿]+/g,'').trim().replace(/：$/,'');
      const fields=(options.familyFields?.[q.id]||[]).filter(([,key])=>String(q.answer?.[key]||'').trim());
      if(!fields.length) family.push(...recordRows(label,'未填 / 无'));
      else for(const [field,key] of fields) family.push(...recordRows(field,options.familyDisplay?options.familyDisplay(q.answer[key],q.id,key):q.answer[key]));
    }
    if(!family.length)family.push(...recordRows('家庭与支持信息','未填 / 无'));
    const infoHeader='<div class="rp-record-head"><span>信息项目</span><span>原始作答</span></div>';
    return [
      {title:`测评结果报告${sample?'（示例）':''}`,subtitle,kind:'cover',blocks:[coverIntro,heading('综合指标概览','圆点为本次得分，细线为参照中心，浅色带为参照区间。'),...overview,heading('阅读提示'),p('分数反映本次作答呈现的工作偏好与主观体验。颜色仅区分得分档位。请结合各项定义与高低分含义阅读，不作统一的优劣排序。'),p(r.referenceDescription || r.disclaimer,'rp-muted'),p(`职业性格匹配度采用“${r.pfRoleTitle || '建筑工地外派管理岗'}”的岗位视角。该分数不是匹配概率、资格判断或实际表现保证。`,'rp-muted'),p(r.rescoringNotice,'rp-muted'),p(r.pfReinterpretationNotice,'rp-muted'),'<div class="rp-contents"><b>报告内容</b><p>综合指标 <span data-page-link="totals"></span> · 维度轮廓 <span data-page-link="radars"></span> · 分项解读 <span data-page-range="details"></span> · 信息记录与使用说明 <span data-page-link="records"></span></p></div>']},
      {title:'综合指标说明',subtitle:'各项均采用 0–100 分刻度；高低分的具体含义不同。',kind:'totals',blocks:pairs(totals)},
      {title:'维度轮廓',subtitle:'实线为本次得分，虚线为参照中心。图形采用固定 0–100 刻度。',kind:'radars',blocks:[radar('职业性格',byPrefix('PF')),radar('工作投入与情境判断',dims.filter(row=>/^(ST|SJ|WV_)/.test(row.code))),radar('日常心理倾向',byPrefix('MH'))]},
      {title:'职业稳定性与工作价值观',kind:'details stability',blocks:[...pairs(byPrefix('ST')),heading('工作价值观',r.workValueNotice || r.workValueUnavailable),p(r.workValueDerivationNotice,'rp-muted'),...pairs(byPrefix('WV_'))]},
      {title:'职业性格',subtitle:'分项呈现工作方式偏好，应结合具体经历和实际任务理解。',kind:'details personality',blocks:pairs(byPrefix('PF').slice(0,4))},
      {title:'职业性格 续',subtitle:'高低仅描述相对倾向，不直接代表工作能力或胜任程度。',kind:'details personality',blocks:pairs(byPrefix('PF').slice(4))},
      {title:'情境判断与处理偏好',subtitle:'呈现对现场问题、人际分歧与规范要求的判断倾向。',kind:'details judgement',blocks:byPrefix('SJ').map(metric)},
      {title:'心理问题倾向',subtitle:'反映主观困扰线索，不用于疾病诊断或岗位资格判断。',kind:'details psychology',blocks:pairs(byPrefix('MH'))},
      {title:'作答参考',subtitle:'先理解作答过程，再结合具体经历使用其他结果。',kind:'details response',blocks:[...byPrefix('RV').map(metric),p(r.timingNotice,'rp-muted rp-small')]},
      {title:'信息记录与报告使用说明',kind:'records',blocks:[heading('工作经历'),infoHeader.replace('class="rp-record-head"','class="rp-record-head rp-employment-row"'),...employmentRows(r.employmentAnswers),heading('家庭与支持信息','仅作信息记录，不计分'),infoHeader,...family,heading('报告使用说明'),...(r.interpretationNotes || []).map(note=>p(note,'rp-muted rp-small'))]}
    ].map(section=>({...section,blocks:section.blocks.filter(Boolean)}));
  }
  function paginate(saved, options) {
    if(!root)return;
    root.replaceChildren();
    const r=saved.report, answerVersion=r.answerVersion||saved.version||r.version||'—', scoringVersion=r.scoringVersion||r.version||'—';
    const versions=answerVersion===scoringVersion?`V${scoringVersion}`:`答卷 V${answerVersion} · 计分 V${scoringVersion}`;
    const pages=[];
    const addPage=(section,continued=false)=>{
      const page=document.createElement('section');page.className='rp-page '+section.kind;
      page.innerHTML=`<header class="rp-header"><div class="rp-brand">渡仁心理</div><span>建筑行业生产管理岗</span></header><div class="rp-heading"><h1>${esc(section.title)}${continued?'（续）':''}</h1>${p(section.subtitle,'rp-subtitle')}</div><div class="rp-body ${section.subtitle?'has-subtitle':''}"></div><footer class="rp-footer"><span>测评结果报告${options.sample===true?'（示例）':''} · ${esc(versions)}</span><span class="rp-page-number"></span></footer>`;
      root.append(page);pages.push(page);return page.querySelector('.rp-body');
    };
    for(const section of sections(saved,options)) {
      let body=addPage(section);
      for(const html of section.blocks) {
        const block=document.createElement('div');block.className='rp-block';block.innerHTML=html;if(block.querySelector('.rp-subheading,.rp-record-head'))block.dataset.keepNext='true';body.append(block);
        if(block.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + .3 && body.children.length>1) {
          const carry=[];let previous=block.previousElementSibling;
          while(previous?.dataset.keepNext==='true'){carry.unshift(previous);previous=previous.previousElementSibling;}
          if(body.children.length>carry.length+1){
            block.remove();carry.forEach(node=>node.remove());body=addPage(section,true);
            carry.forEach(node=>body.append(node));
            if(section.kind==='records'&&block.querySelector('.rp-record-row')&&!carry.some(node=>node.querySelector('.rp-record-head'))){
              const header=document.createElement('div');header.className='rp-block';header.innerHTML='<div class="rp-record-head'+(block.querySelector('.rp-employment-row')?' rp-employment-row':'')+'"><span>信息项目</span><span>原始作答</span></div>';body.append(header);
            }
            body.append(block);
          }
        }
        // Never silently clip content. Current report cards/record chunks fit A4;
        // a future oversized block remains visible and is flagged for validation.
        if(block.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + .3) block.dataset.overflow='true';
      }
    }
    pages.forEach((page,i)=>{page.querySelector('.rp-page-number').textContent=`${String(i+1).padStart(2,'0')} / ${String(pages.length).padStart(2,'0')}`;});
    root.querySelectorAll('[data-page-link]').forEach(node=>{node.textContent=String(pages.findIndex(page=>page.classList.contains(node.dataset.pageLink))+1).padStart(2,'0');});
    root.querySelectorAll('[data-page-range]').forEach(node=>{const indices=pages.flatMap((page,i)=>page.classList.contains(node.dataset.pageRange)?[i+1]:[]);node.textContent=indices.length?`${String(indices[0]).padStart(2,'0')}–${String(indices.at(-1)).padStart(2,'0')}`:'—';});
    root.dataset.pages=String(pages.length);
  }
  function clear() {
    generation++;current=null;root?.remove();root=null;pending=Promise.resolve();
    document.body.classList.remove('report-print-available','report-print-ready');
    if(originalTitle!==null){document.title=originalTitle;originalTitle=null;}
  }
  function mount(saved,options={}) {
    clear();const token=generation;current={saved,options};
    root=document.createElement('div');root.id='assessment-print-root';root.setAttribute('aria-hidden','true');document.body.append(root);document.body.classList.add('report-print-available');
    paginate(saved,options);
    pending=loadFonts().then(()=>{if(generation===token){paginate(saved,options);validateLayout();document.body.classList.add('report-print-ready');}});
    pending.catch(()=>{}); // The export button reports a retryable error; no unhandled rejection.
  }
  function loadFonts() {
    return document.fonts?Promise.all([document.fonts.load('400 10px "Duren Report"'),document.fonts.load('700 10px "Duren Report"')]).then(loaded=>{if(loaded.some(list=>!list.length))throw new Error('报告字体未能加载，请联网后重试。');}):Promise.resolve();
  }
  function validateLayout() {
    if(!root || global.getComputedStyle(root).getPropertyValue('--report-template-version').trim()!==version)throw new Error('独立报告样式未加载或版本不一致，请刷新页面后重试。');
    if(root.querySelector('[data-overflow="true"]'))throw new Error('报告中有超长内容，暂时无法完整排版，请联系管理员。原始信息未改动。');
  }
  async function ready() {
    if(!current)throw new Error('请先打开需要导出的报告。');
    document.body.classList.remove('report-print-ready');
    const token=generation;await loadFonts();await pending.catch(()=>{});
    if(!current||generation!==token)throw new Error('报告已切换，请在当前报告中重新点击导出。');
    paginate(current.saved,current.options);
    validateLayout();document.body.classList.add('report-print-ready');
  }
  global.addEventListener('beforeprint',()=>{
    if(!current)return;
    try{validateLayout();if(document.fonts&&(!document.fonts.check('400 10px "Duren Report"')||!document.fonts.check('700 10px "Duren Report"')))throw new Error('报告字体尚未加载');paginate(current.saved,current.options);validateLayout();document.body.classList.add('report-print-ready');}catch{document.body.classList.remove('report-print-ready');return;}
    if(originalTitle===null)originalTitle=document.title;
    const owner=current.saved.owner||current.options.owner;
    const name=String(owner?.name||'').replace(/[\\/:*?"<>|\r\n]/g,'').slice(0,50);
    document.title=`渡仁_测评结果报告${name?'_'+name:''}`;
  });
  global.addEventListener('afterprint',()=>{if(originalTitle!==null){document.title=originalTitle;originalTitle=null;}});
  global.AssessmentPrint={version,mount,clear,ready,sections,metric,bar,radar,recordRows};
})(window);
