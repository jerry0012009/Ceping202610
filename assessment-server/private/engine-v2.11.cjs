(function(root){
'use strict';
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const sum=a=>a.reduce((s,v)=>s+v,0);
const average=recs=>recs.length?sum(recs.map(r=>r.value*r.weight))/sum(recs.map(r=>r.weight)):null;
const clamp=v=>Math.max(0,Math.min(100,v));
function create(data){
 const byId=Object.fromEntries(data.questions.map(q=>[q.id,q]));
 const numericCodes=Object.keys(data.names).filter(c=>!['SJ4','SJ5'].includes(c));
 const weighted=(scores,weights)=>Object.keys(weights).every(c=>Number.isFinite(scores[c]))?Object.keys(weights).reduce((s,c)=>s+scores[c]*weights[c],0):null;
 const validKey=(q,v)=>typeof v==='string'&&q.options.some(o=>o.key===v);
 function complete(q,a){
  if(q.type==='family')return !!a&&Object.values(a).some(v=>typeof v==='string'&&v.trim().length);
  if(q.type==='tenure'){
   if(!a)return false;if(a.none===true)return true;
   if(!Array.isArray(a.months)||a.months.length!==3||!a.months.every(x=>x==='无'||(typeof x!=='boolean'&&x!==null&&String(x).trim()!==''&&Number.isFinite(Number(x))&&Number(x)>=0)))return false;
   const months=a.months.map(x=>x==='无'?0:Number(x));
   return months.every(x=>x===0)||(months[0]>0&&['仍在职','已离职'].includes(a.status));
  }
  if(q.type==='double')return !!a&&validKey(q,a.most)&&validKey(q,a.least)&&a.most!==a.least;
  return validKey(q,a);
 }
 function records(q,mapping,answer,expected=false){
  if(!mapping)return [];
  if(Array.isArray(mapping)){
   if(expected)return [{value:mean(mapping),slot:'单选'}];
   if(!validKey(q,answer))return [];
   return [{value:mapping[q.options.findIndex(o=>o.key===answer)],slot:'单选'}];
  }
  return ['most','least'].flatMap(slot=>{
   const arr=mapping[slot];if(!arr)return [];
   if(expected)return [{value:mean(arr),slot:slot==='most'?'最像':'最不像'}];
   if(!answer||!validKey(q,answer[slot])||(slot==='least'&&answer.most===answer.least))return [];
   return [{value:arr[q.options.findIndex(o=>o.key===answer[slot])],slot:slot==='most'?'最像':'最不像'}];
  });
 }
 const facts=answers=>{
  const a=answers.QB001,idx=byId.QB001.options.findIndex(o=>o.key===a),n=answers.QB002;
  let tenure=null,months=[];
  if(complete(byId.QB002,n)){
   if(n.none)tenure=50;
   else{months=n.months.filter(x=>x!=='无').map(Number).filter(m=>m>0);tenure=months.length?100*sum(months.map(m=>Math.min(m,36)))/(36*months.length):50;}
  }
  return {employers:{raw:idx<0?null:[50,100,75,50,20,0][idx],answer:a??null},tenure:{raw:tenure,months,noExperience:complete(byId.QB002,n)&&(!!n?.none||months.length===0)}};
 };
 const pairScore=(p,a,b)=>{if(p.kind==='same-scale'||p.kind==='reverse-scale'){const diff=Math.abs(Number(a)-(p.kind==='reverse-scale'?6-Number(b):Number(b)));return diff===0?100:diff===1?50:0;}return (p.kind==='opposite'?a!==b:p.map[a]===b)?100:0;};
 const consistent=(p,a,b)=>pairScore(p,a,b)===100;
 function calculate(answers={},seconds={},expected=false,completionBank=byId){
  const trace={},raw={},reference={},coverage={};
  const collect=(code,isValue=false)=>data.questions.flatMap(q=>{
   if(['QB001','QB002'].includes(q.id))return [];
   return records(q,(isValue?q.values:q.scores)[code],answers[q.id],expected).map(r=>({...r,weight:(isValue?q.valueWeights:q.weights)[code],id:q.id,pool:q.pool,judgment:q.judgment}));
  });
  function pooled(recs){
   const l=recs.filter(r=>r.pool==='L'),f=recs.filter(r=>r.pool==='F'),lm=average(l),fm=average(f);
   return {value:average(recs),lCount:l.length,fCount:f.length,lWeight:sum(l.map(r=>r.weight)),fWeight:sum(f.map(r=>r.weight)),lMean:lm,fMean:fm};
  }
  for(const c of numericCodes){
   const items=(data.coverage[c]??[]).filter(id=>c!=='ST2'||!['QB001','QB002'].includes(id));
   coverage[c]={answered:expected?items.length:items.filter(id=>complete(byId[id],answers[id])).length,total:items.length,records:0};raw[c]=null;reference[c]=null;
  }
  const rv1=collect('RV1');raw.RV1=average(rv1);reference.RV1=raw.RV1;trace.RV1={records:rv1};
  const pairStates=data.pairs.map(p=>{const done=expected||p.ids.every(id=>complete(byId[id],answers[id]));const possible=byId[p.ids[0]].options.flatMap(a=>byId[p.ids[1]].options.map(b=>pairScore(p,a.key,b.key)));return {...p,done,score:expected?mean(possible):done?pairScore(p,...p.ids.map(id=>answers[id])):null};});
  raw.RV2=mean(pairStates.filter(p=>p.done).map(p=>p.score));reference.RV2=raw.RV2;coverage.RV2={answered:pairStates.filter(p=>p.done).length,total:data.pairs.length,records:pairStates.filter(p=>p.done).length};trace.RV2={pairs:pairStates};
  // Original answer-bank completion preserves recorded timing for removed historical options.
  const timed=data.questions.filter(q=>q.cost>0&&(expected||complete(completionBank[q.id]||q,answers[q.id])));
  const baseline=sum(timed.map(q=>q.cost));
  const elapsed=expected?data.t0:sum(timed.map(q=>Math.max(0,Number(seconds[q.id])||0)));
  raw.RV3=baseline?clamp(100*elapsed/baseline):null;reference.RV3=raw.RV3;coverage.RV3={answered:timed.length,total:data.timedTotal,records:timed.length};trace.RV3={elapsed,baseline,fullBaseline:data.t0};
  const e=raw.RV1===null?null:Math.max(0,raw.RV1-60);
  const q=raw.RV1===null||raw.RV2===null||raw.RV3===null?null:.4*(100-raw.RV1)+.4*raw.RV2+.2*raw.RV3;
  for(const c of ['ST1','ST2',...Array.from({length:7},(_,i)=>'PF'+(i+1))]){
   const recs=collect(c),p=pooled(recs);raw[c]=p.value;reference[c]=p.value===null||e===null?null:Math.max(0,p.value-data.coeff[c]*e);coverage[c].records=recs.length;trace[c]={records:recs,...p,coefficient:data.coeff[c]};
  }
  const valueParts={};
  for(const label of ['稳定保障','学习成长','报酬回报']){
   const recs=collect(label,true),p=label==='报酬回报'?{value:average(recs),lCount:recs.length,fCount:0,lWeight:sum(recs.map(r=>r.weight)),fWeight:0}:pooled(recs);valueParts[label]={...p,records:recs};
  }
  raw.ST3=Object.values(valueParts).every(p=>p.value!==null) ? (.4*valueParts.稳定保障.value+.35*valueParts.学习成长.value+.25*valueParts.报酬回报.value) : null;
  reference.ST3=raw.ST3===null||e===null?null:Math.max(0,raw.ST3-.25*e);trace.ST3={parts:valueParts,coefficient:.25};coverage.ST3.records=sum(Object.values(valueParts).map(p=>p.records.length));
  for(const c of ['SJ1','SJ2','SJ3']){
   const recs=collect(c),j=recs.filter(r=>r.judgment),p=recs.filter(r=>!r.judgment),js=sum(j.map(r=>r.value*r.weight)),ps=sum(p.map(r=>r.value*r.weight)),jw=sum(j.map(r=>r.weight)),pw=sum(p.map(r=>r.weight)),w=jw+pw;
   raw[c]=w?(js+ps)/w:null;reference[c]=!w?null:!p.length?raw[c]:e===null?null:(js+Math.max(0,ps-.15*e*pw))/w;
   coverage[c].records=recs.length;trace[c]={records:recs,judgmentCount:j.length,preferenceCount:p.length,judgmentWeight:jw,preferenceWeight:pw,judgmentSum:js,preferenceSum:ps,coefficient:.15};
  }
  for(const c of ['MH1','MH2','MH3','MH4','MH5','MH6']){
   const recs=collect(c);raw[c]=average(recs);reference[c]=raw[c]===null||q===null?null:q/100*raw[c]+(1-q/100)*50;coverage[c].records=recs.length;trace[c]={records:recs,q,anchor:50};
  }
  coverage.RV1.records=rv1.length;
  const weights={ST:{ST1:.25,ST2:.5,ST3:.25},PF:{PF1:.2,PF2:.2,PF3:.15,PF4:.1,PF5:.1,PF6:.15,PF7:.1},MH:{MH1:.2,MH2:.25,MH3:.1,MH4:.15,MH5:.1,MH6:.2},RV:{RV1:-.3,RV2:.5,RV3:.2}};
  const totals={};for(const [k,w]of Object.entries(weights)){const r=weighted(raw,w),adj=weighted(reference,w);totals[k]={raw:r===null?null:r+(k==='RV'?30:0),reference:adj===null?null:adj+(k==='RV'?30:0)};}
  const salary=data.questions.filter(q=>q.scores.SJ4).map(q=>({id:q.id,number:q.number,answer:answers[q.id]??null,records:records(q,q.scores.SJ4,answers[q.id],expected)}));
  return {raw,reference,coverage,trace,e,q,honesty:raw.RV1===null?null:100-raw.RV1,totals,valueParts,facts:facts(answers),salary,answered:expected?data.total:data.questions.filter(q=>q.type!=='family'&&complete(completionBank[q.id]||q,answers[q.id])).length,total:data.total};
 }
 function defaults(){const p=calculate({}, {},true),norm=(m)=>({mean:m,lower:Math.max(0,m-7.5),upper:Math.min(100,m+7.5)}),legacy=Object.fromEntries([...numericCodes.map(c=>[c,norm(p.reference[c])]),...['ST','PF','MH'].map(c=>[c,norm(p.totals[c].reference)])]);return Object.fromEntries(Object.keys(legacy).map(c=>[c,{...(data.referenceProfile?.values?.[c]||legacy[c])}]));}
 function contributions(id,answer){const q=byId[id],add=(c,rs,w)=>[c,rs.map(r=>({...r,weight:w,weighted:r.value*w}))];return {...Object.fromEntries(Object.entries(q.scores).map(([c,m])=>add(c,records(q,m,answer),q.weights[c]))),...Object.fromEntries(Object.entries(q.values).map(([c,m])=>add('ST3·'+c,records(q,m,answer),q.valueWeights[c])))};}
 return {calculate,complete,records,contributions,defaults,byId,numericCodes,consistent,pairScore,average};
}
const api={create,mean};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.Assessment=api;
})(typeof globalThis!=='undefined'?globalThis:this);
