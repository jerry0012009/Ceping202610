// Presentation only: deterministic wording over authorized report values.
// Never recalculates scores, makes diagnoses or infers hiring eligibility.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const valid=row=>finite(row?.score)&&['较高','稍高','平均','稍低','较低'].includes(row?.label);
const high=label=>label==='较高'||label==='稍高';
const low=label=>label==='较低'||label==='稍低';
const copy={
 ST:{high:'本次较偏向延续现有职业和任务；长期投入的条件与安排仍需进一步沟通。',middle:'本次持续投入意愿处于当前参照的中间范围，可结合具体工作条件了解。',low:'本次对转向或新机会保留较多空间；可先沟通发展意愿和交接安排。'},
 PF:{high:'本次工作方式较接近当前岗位组合强调的责任落实、协作和有序推进；实际表现仍需核实。',middle:'本次工作方式处于当前岗位组合参照的中间范围，具体特点需结合分项和实际经历理解。',low:'本次工作侧重点与当前岗位组合要求存在一定差异；可结合分项了解需要的安排与支持。'},
 MH:{high:'本次较多反映主观困扰，宜了解近期负担与支持需求；不据此作疾病或资格判断。',middle:'本次主观困扰处于当前参照的中间范围，仍需结合近期体验及支持需求理解。',low:'本次较少提及相关困扰；不能据此推断精力、抗压能力或工作表现更好。'}
};
export function createReportSummary(report){
 const totals=new Map((report.totals||[]).map(row=>[row.code,row]));
 const dimensions=report.dimensions||[];
 const cards=['ST','PF','MH'].map(code=>{
  const row=totals.get(code);
  return {code,interpretation:!valid(row)?'本指标暂无法完整重算，需补充或核对原始作答后再作解释。':copy[code][high(row.label)?'high':low(row.label)?'low':'middle']};
 });
 const features=[];
 for(const pattern of [/^(ST[12]|WV_)/,/^(PF[1-7]|SJ[1-3])$/,/^MH[1-6]$/]){
  const candidates=dimensions.filter(row=>pattern.test(row.code)&&finite(row.score)&&finite(row.mean)&&(high(row.label)||low(row.label)));
  candidates.sort((a,b)=>Math.abs(b.score-b.mean)-Math.abs(a.score-a.mean)||a.code.localeCompare(b.code));
  if(candidates[0])features.push(`${candidates[0].name}${candidates[0].label}`);
 }
 const parts=[];
 if(cards.some(card=>!valid(totals.get(card.code))))parts.push('部分综合指标暂缺完整结果，以下仅概述可用分项，需补充或核对原始作答。');
 const hasDimensions=dimensions.some(row=>valid(row)&&finite(row.mean));
 parts.push(!hasDimensions?'分项数据不足，需补充或核对原始作答后再解读特点。':features.length?`相对各自参照，本次较突出的分项线索为：${features.join('、')}。可围绕这些方面结合具体经历进一步了解。`:'本次可用分项未显示明确的高低档位差异，可结合具体经历与当前工作条件进一步了解。');
 const rv=totals.get('RV'),rv1=dimensions.find(row=>row.code==='RV1'),process=dimensions.filter(row=>['RV2','RV3'].includes(row.code));
 if(!valid(rv)||!valid(rv1)||process.length!==2||process.some(row=>!valid(row)))parts.push('作答质量信息不完整，需补充核对后谨慎使用其他结果。');
 else if(low(rv.label)||process.some(row=>finite(row.score)&&low(row.label)))parts.push('作答质量或部分作答过程线索相对偏低，宜先核对题意理解和答题过程，再解释其他结果。');
 else if(finite(rv1?.score)&&high(rv1.label))parts.push('自我描述偏理想化的线索较突出，宜结合具体经历核实；作答质量分高不等于内容必然真实。');
 else parts.push('作答质量未见明显偏低线索，但仍需结合具体经历核实，不能视为真实性保证。');
 parts.push('以上为本次作答的相对倾向，不是能力证明、临床诊断或用人资格结论。');
 return {cards,overview:parts.join('')};
}
