'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const privateDir = process.env.ASSESSMENT_PRIVATE_DIR || path.resolve(__dirname,'../private');
const data = require(path.join(privateDir,'questionnaire-v2.9.json'));
const engine = require(path.join(privateDir,'engine-v2.9.cjs')).create(data);
const {buildInternalEvidence,stripInternalEvidence} = require('../private/private-answer-evidence.cjs');
const build = (answers, seconds={}) => buildInternalEvidence({data,engine,answers,seconds});
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
function possible(q) {return q.type==='double' ? q.options.flatMap(a=>q.options.filter(b=>b.key!==a.key).map(b=>({most:a.key,least:b.key}))) : q.options.map(o=>o.key);}
function extremize(code, high=true) {
 const answers={};
 for(const q of data.questions.filter(q=>q.scores[code] && !['QB001','QB002'].includes(q.id))) {
   answers[q.id]=possible(q).sort((a,b)=> {
     const val=a=>engine.records(q,q.scores[code],a).reduce((s,r)=>s+r.value,0);
     return (high?-1:1)*(val(a)-val(b));
   })[0];
 }
 return answers;
}
test('five positive candidates select at most three distinct questions and exclude low items',()=>{
 const a=extremize('PF1'); const records=engine.calculate(a).trace.PF1.records;
 assert.ok(new Set(records.map(r=>r.id)).size>=5);
 const e=build(a).dimensions.PF1.evidence; assert.equal(e.length,3);
 assert.equal(new Set(e.flatMap(x=>x.questions.map(q=>q.id))).size,3);
 assert.ok(e.every(x=>x.uplift>0)); assert.ok(e.every((x,i)=>!i || e[i-1].uplift>=x.uplift));
 const denominator=records.reduce((s,r)=>s+r.weight,0);
 e.forEach(x=>near(x.rawContribution,records.filter(r=>r.id===x.questions[0].id).reduce((s,r)=>s+r.value*r.weight/denominator,0)));
});
test('all low answers yield no high-score clues despite some nonzero raw points',()=>{
 for(const code of ['PF1','ST1','RV1','MH1']) assert.deepEqual(build(extremize(code,false)).dimensions[code].evidence,[]);
});
test('reverse scoring uses private mapped values rather than option order',()=>{
 const q=data.questions.find(q=>Array.isArray(q.scores.MH1) && q.scores.MH1[0]>q.scores.MH1.at(-1)); assert.ok(q);
 const best=q.scores.MH1.indexOf(Math.max(...q.scores.MH1));
 const e=build({[q.id]:q.options[best].key}).dimensions.MH1.evidence;
 assert.equal(e[0].questions[0].selections[0].key,q.options[best].key);near(e[0].rawContribution,Math.max(...q.scores.MH1));
});
test('double choice groups both slots and retains every selected/unselected option',()=>{
 const q=data.questions.find(q=>q.type==='double' && q.scores.PF1);
 const a=extremize('PF1'); const e=build({[q.id]:a[q.id]}).dimensions.PF1.evidence;
 assert.equal(e.length,1);assert.equal(e[0].components.length,2);
 const shown=e[0].questions[0]; assert.equal(shown.options.length,q.options.length);
 assert.equal(shown.options.filter(o=>o.selected).length,2);
 assert.deepEqual(shown.selections.map(s=>s.role),['most','least']);
 assert.deepEqual(shown.options.map(o=>o.text),q.options.map(o=>o.text));
});
test('missing and invalid double answers never manufacture evidence; exactly 22 numeric dimensions',()=>{
 const empty=build({}); assert.equal(Object.keys(empty.dimensions).length,22);
 assert.equal(empty.dimensions.SJ4,undefined);assert.equal(empty.dimensions.SJ5,undefined);
 assert.ok(Object.values(empty.dimensions).every(d=>d.evidence.length===0));
 const q=data.questions.find(q=>q.type==='double' && q.scores.PF1);
 assert.deepEqual(build({[q.id]:{most:q.options[0].key}}).dimensions.PF1.evidence,[]);
 assert.deepEqual(build({[q.id]:{most:'A',least:'A'}}).dimensions.PF1.evidence,[]);
});
test('ST3 contribution uses exact nested part denominator and outer weight',()=>{
 const a={};for(const q of data.questions.filter(q=>Object.keys(q.values).length)) a[q.id]=possible(q)[0];
 const r=engine.calculate(a), e=build(a).dimensions.ST3.evidence;
 assert.ok(e.length>0);
 for(const item of e) for(const c of item.components){
   const p=r.trace.ST3.parts[c.part], weight={'稳定保障':.4,'学习成长':.35,'报酬回报':.25}[c.part];
   const rec=p.records.find(x=>x.id===item.questions[0].id && x.slot===c.slot);
   near(c.normalizedWeight,weight*rec.weight/p.records.reduce((s,r)=>s+r.weight,0));
 }
});
test('RV2 evidence contains a full pair under three-question budget',()=>{
 const a={};for(const p of data.pairs){const [qa,qb]=p.ids.map(id=>engine.byId[id]); let found;
   for(const x of qa.options) for(const y of qb.options) if(engine.pairScore(p,x.key,y.key)===100) found=[x.key,y.key];
   [a[p.ids[0]],a[p.ids[1]]]=found;
 }
 const e=build(a).dimensions.RV2.evidence;assert.equal(e.length,1);assert.equal(e[0].questions.length,2);
 assert.equal(e[0].kind,'pair');near(e[0].rawContribution,25);assert.ok(e[0].uplift>0);
});
test('RV3 capped score is proportionally allocated; cost-proportional timing yields no excess',()=>{
 const qs=data.questions.filter(q=>q.cost>0 && q.options.length && q.type!=='double').slice(0,3);
 const a=Object.fromEntries(qs.map(q=>[q.id,q.options[0].key]));
 const proportional=Object.fromEntries(qs.map(q=>[q.id,q.cost*2]));
 assert.equal(build(a,proportional).dimensions.RV3.rawScore,100);
 assert.deepEqual(build(a,proportional).dimensions.RV3.evidence,[]);
 const secs={...proportional,[qs[0].id]:qs[0].cost*10};const e=build(a,secs).dimensions.RV3.evidence;
 assert.equal(e.length,1);assert.equal(e[0].kind,'timing');
 const elapsed=Object.values(secs).reduce((s,x)=>s+x,0),cost=qs.reduce((s,q)=>s+q.cost,0);
 near(e[0].rawContribution,100*secs[qs[0].id]/elapsed);
 near(e[0].baselineContribution,100*qs[0].cost/cost);
 near(qs.reduce((s,q)=>s+100*secs[q.id]/elapsed,0),100);
 near(qs.reduce((s,q)=>s+100*secs[q.id]/elapsed-100*q.cost/cost,0),0);
});
test('strip internal evidence recursively without mutating stored snapshot',()=>{
 const x={internalEvidence:{secret:true},nested:[{internalEvidence:{secret:true},safe:1}]};
 assert.deepEqual(stripInternalEvidence(x),{nested:[{safe:1}]});assert.ok(x.internalEvidence.secret);
});
