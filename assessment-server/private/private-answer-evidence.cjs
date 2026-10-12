'use strict';
// SERVER ONLY. Never include this module, its output, or private question mappings in browser bundles.
const sum = xs => xs.reduce((a, b) => a + b, 0);
const EPSILON = 1e-9;
const ST3_PART_WEIGHTS = {'稳定保障': .4, '学习成长': .35, '报酬回报': .25};
function buildInternalEvidence({data, engine, answers = {}, seconds = {}, result}) {
  const rankingMode = 'above-equal-option';
  result = result || engine.calculate(answers, seconds);
  const byId = Object.fromEntries(data.questions.map(q => [q.id, q]));
  const question = id => {
    const q = byId[id], answer = answers[id];
    const selections = q.type === 'double'
      ? [{key: answer.most, role: 'most', label: '最像我'}, {key: answer.least, role: 'least', label: '最不像我'}]
      : [{key: answer, role: 'selected', label: '已选择'}];
    return {id, number: q.number, type: q.type, stem: q.stem,
      instructions: [...(q.instructions || [])],
      options: q.options.map(o => ({key: o.key, text: o.text, selected: selections.some(s => s.key === o.key),
        roles: selections.filter(s => s.key === o.key).map(s => s.role)})), selections};
  };
  const rank = (raw, uplift) => uplift;
  const choose = candidates => {
    const chosen = [], ids = new Set();
    candidates.filter(x => Number.isFinite(x.rankingValue) && x.rankingValue > EPSILON)
      .sort((a,b) => b.rankingValue-a.rankingValue || a.questions[0].number-b.questions[0].number)
      .forEach(x => {const fresh = x.questions.filter(q => !ids.has(q.id));
        if (!fresh.length || x.questions.some(q => ids.has(q.id)) || ids.size + fresh.length > 3) return;
        chosen.push(x); fresh.forEach(q => ids.add(q.id));});
    return chosen;
  };
  const dimensions = {};
  for (const code of engine.numericCodes) {
    const trace = result.trace[code], rawScore = result.raw[code];
    const kind = code === 'RV2' ? 'pair' : code === 'RV3' ? 'timing' : 'answer';
    const dimension = dimensions[code] = {kind, rawScore, evidence: []};
    if (!Number.isFinite(rawScore) || !trace) continue;
    if (code === 'RV2') {
      const done = trace.pairs.filter(p => p.done), denominator = done.length;
      dimension.baseline = 'Uniform independent valid options in both questions; actual answered-pair denominator.';
      dimension.evidence = choose(done.map(p => {
        const [qa,qb] = p.ids.map(id => byId[id]);
        const possible = qa.options.flatMap(a => qb.options.map(b => engine.pairScore(p,a.key,b.key)));
        const baselineContribution = sum(possible)/possible.length/denominator;
        const rawContribution = p.score/denominator;
        const uplift = rawContribution-baselineContribution;
        return {kind, questions: p.ids.map(question), rawContribution, baselineContribution, uplift,
          pairScore: p.score, rankingValue: rank(rawContribution,uplift), attribution: 'Mechanical contribution of the complete pair, not either answer alone.'};
      }));
      continue;
    }
    if (code === 'RV3') {
      dimension.baseline = 'Allocate the actual capped RV3 score in proportion to elapsed seconds; comparison allocation is the same score in proportion to existing engine costs.';
      dimension.evidence = choose(data.questions.filter(q => q.cost > 0 && engine.complete(q, answers[q.id]) && q.options.length).map(q => {
        const elapsedSeconds = Math.max(0, Number(seconds[q.id]) || 0);
        const uncappedRawContribution = 100*elapsedSeconds/trace.baseline;
        const rawContribution = trace.elapsed > 0 ? rawScore*elapsedSeconds/trace.elapsed : 0;
        const baselineContribution = rawScore*q.cost/trace.baseline;
        const uplift = rawContribution-baselineContribution;
        return {kind, questions: [question(q.id)], elapsedSeconds, baselineSeconds: q.cost,
          rawContribution, baselineContribution, uncappedRawContribution, uplift,
          rankingValue: uplift,
          attribution: 'Mechanical allocation of observed elapsed time, not answer-content causality or proof of care. Above cost-share baseline only.'};
      }));
      continue;
    }
    dimension.baseline = 'Uniform valid option per scored slot, weighted using the actual answered-record denominator; double slots combined by question. ST3 retains its nested part weights.';
    const groups = new Map();
    const addRecords = (records, mappingKey, isValue, outerWeight) => {
      const denominator = sum(records.map(r => r.weight));
      if (!(denominator > 0)) return;
      for (const r of records) {
        const q = byId[r.id];
        if (!q || !engine.complete(q,answers[q.id])) continue;
        const mapping = (isValue ? q.values : q.scores)[mappingKey];
        const baselineRecord = engine.records(q, mapping, undefined, true).find(b => b.slot === r.slot);
        if (!baselineRecord) continue;
        const factor = outerWeight*r.weight/denominator;
        if (!groups.has(q.id)) groups.set(q.id, {kind, questions: [question(q.id)], rawContribution: 0, baselineContribution: 0, components: []});
        const g = groups.get(q.id), rawContribution = r.value*factor, baselineContribution = baselineRecord.value*factor;
        g.rawContribution += rawContribution; g.baselineContribution += baselineContribution;
        g.components.push({part: isValue ? mappingKey : code, slot: r.slot, value: r.value,
          normalizedWeight: factor, rawContribution, baselineContribution});
      }
    };
    if (code === 'ST3') Object.entries(ST3_PART_WEIGHTS).forEach(([part,weight]) => addRecords(trace.parts[part].records,part,true,weight));
    else addRecords(trace.records || [],code,false,1);
    dimension.evidence = choose([...groups.values()].map(g => ({...g, uplift: g.rawContribution-g.baselineContribution,
      rankingValue: rank(g.rawContribution,g.rawContribution-g.baselineContribution)})));
  }
  return {schemaVersion: 1, questionnaireVersion: data.version, sourceVersion: data.sourceVersion,
    rankingMode, scoreBasis: 'raw-before-calibration', maxDistinctQuestionsPerDimension: 3,
    dimensions};
}
// Apply to every public report payload, for owners AND administrators. Also strips nested snapshots.
function stripInternalEvidence(value) {
  if (Array.isArray(value)) return value.map(stripInternalEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'internalEvidence')
    .map(([key, child]) => [key, stripInternalEvidence(child)]));
}
module.exports = {buildInternalEvidence, stripInternalEvidence};
