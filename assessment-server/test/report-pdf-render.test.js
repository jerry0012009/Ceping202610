import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {calculateReport} from '../scoring.js';
import {generateReportPdf,pdfDisposition} from '../report-pdf.js';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/synthetic-assumed-v2.11-40.json',import.meta.url))).rows[0];
const available=tool=>spawnSync(tool,['-v']).status===0;
const hasText=available('pdftotext'),hasInfo=available('pdfinfo');
const extract=(tool,pdf,args=['-','-'])=>{const r=spawnSync(tool,args,{input:pdf,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr?.toString());return r.stdout.toString('utf8');};
const saved=()=>({id:'synthetic-render-test',version:'2.11',createdAt:'2026-10-14T00:00:00.000Z',owner:{name:'合成𠮷龘㐀',email:'fixture@example.test'},report:calculateReport(fixture.answers,fixture.seconds)});
const compact=s=>s.replace(/\s+/g,'');
const pdfPages=pdf=>extract('pdftotext',pdf,['-raw','-','-']).split('\f').filter(page=>page.trim());
const pageTitle=page=>page.split('\n').map(line=>line.trim()).filter(Boolean)[1];
const scoreOccurrences=(text,score)=>(text.match(new RegExp(`(?<![\\d.])${score.replace('.', '\\.')}(?![\\d.])`,'g'))||[]).length;

test('standard PDF is ten text/vector pages with merged summary and unchanged dimension prose',{timeout:30000},async t=>{
 const s=saved(),pdf=await generateReportPdf(s);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 if(hasInfo)assert.match(extract('pdfinfo',pdf,['-']),/Pages:\s+10\b/);else t.diagnostic('pdfinfo unavailable: page count not checked');
 if(hasText){
  const pages=pdfPages(pdf),text=compact(pages.join('\n')),first=pages[0];
  assert.equal(pages.length,10,'the cover and comprehensive explanations share one first page');
  assert.doesNotMatch(compact(first),/综合指标概览|实线为本次得分|虚线为参照中心/,'the first page no longer contains the total-score triangle or its legend');
  assert.deepEqual(pages.map(pageTitle),['测评结果报告','职业稳定性','职业稳定性','职业性格','职业性格','职业性格','心理困扰倾向','心理困扰倾向','掩饰性与作答质量','信息记录与报告使用说明']);
  assert.doesNotMatch(text,/综合指标说明/,'there is no separate comprehensive-explanations chapter');
  for(const title of pages.map(pageTitle))assert.doesNotMatch(title,/续/,'all standard page titles omit continuation labels');
  assert.ok(text.includes(s.owner.name),'supplementary Unicode is searchable and copied correctly');
  assert.doesNotMatch(text,/模拟参照|模拟作答|实测人群常模|真实人群常模验证/,'report-visible source disclosure removed; metadata remains truthful');
  for(const row of s.report.totals.filter(row=>['ST','PF','MH'].includes(row.code))){
   assert.ok(compact(first).includes(compact(row.name)),row.code+' summary remains on the cover');
   assert.equal(scoreOccurrences(first,row.score.toFixed(1)),1,row.code+' total score appears exactly once on the first page');
  }
  assert.deepEqual(s.report.reportSummary.cards.map(card=>card.code),['ST','PF','MH']);
  for(const card of s.report.reportSummary.cards)assert.ok(compact(first).includes(compact(card.interpretation)),card.code+' uses the backend conclusion verbatim');
  assert.ok(compact(first).includes(compact(s.report.reportSummary.overview)),'the full backend overall summary appears on the first page');
  const rv=s.report.totals.find(row=>row.code==='RV');
  assert.equal(scoreOccurrences(first,rv.score.toFixed(1)),0,'RV is excluded from the three-score overview');
  assert.equal(scoreOccurrences(pages[8],rv.score.toFixed(1)),1,'RV remains the fourth report domain');
  for(const chapter of ['职业稳定性','职业性格','心理困扰倾向','掩饰性与作答质量','信息记录与报告使用说明'])assert.ok(text.includes(chapter),chapter);
  // Overall summaries may be concise; individual dimension prose must remain complete.
  for(const row of s.report.dimensions){
   for(const key of ['name','definition','highMeaning','lowMeaning','unavailableReason','limitation','referenceNote'])if(row[key])assert.ok(text.includes(compact(row[key])),row.code+'.'+key);
   assert.ok(text.includes(row.score.toFixed(1)),row.code+' unchanged score');
  }
  for(const note of s.report.interpretationNotes)assert.ok(text.includes(compact(note)));
 }else t.diagnostic('pdftotext unavailable: semantic text checks not run');
 if(available('pdfimages')){
  const list=extract('pdfimages',pdf,['-list','-']);
  assert.equal(list.trim().split('\n').length,2,'no raster screenshots or page images');
 }
});

test('long synthetic family fields continue losslessly and escape XML markup',{timeout:30000},async t=>{
 const s=saved(),long='开头𠮷<&>支持说明'+('仅为合成长文本。'.repeat(100))+'最后结束龘';
 const q=s.report.family.find(q=>q.id==='INFO018');q.answer={children:'无',arrangement:long};
 const pdf=await generateReportPdf(s);
 if(hasText){
  const pages=pdfPages(pdf),text=compact(pages.join('\n'));
  assert.ok(text.includes(compact(long)));assert.ok(text.includes('不适用'));assert.ok(text.includes('报告使用说明'));
  for(const title of pages.map(pageTitle))assert.doesNotMatch(title,/续/,'automatic overflow pages also omit continuation labels');
 }
 else t.diagnostic('pdftotext unavailable: long-text extraction not run');
 if(hasInfo){const pages=Number(extract('pdfinfo',pdf,['-']).match(/Pages:\s+(\d+)/)[1]);assert.ok(pages>10&&pages<20);}
});

test('PDF filename tolerates malformed UTF-16 without header injection',()=>{
 const h=pdfDisposition({...saved(),owner:{name:'\ud800坏名\r\n/\\'}});
 assert.doesNotMatch(h,/[\r\n]/);assert.match(h,/filename\*=UTF-8''/);
});
