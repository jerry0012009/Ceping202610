// Presentation only. These rules select and explain existing authorized report
// values; they never calculate or alter assessment scores, weights or bands.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const labels=['较低','稍低','平均','稍高','较高'];
const valid=row=>finite(row?.score)&&labels.includes(row?.label);
const high=label=>label==='较高'||label==='稍高';
const low=label=>label==='较低'||label==='稍低';
export const TOTAL_EXPLANATIONS={
 ST:{
  较高:'本次回答明显偏向持续投入当前职业、单位与任务，延续同类工作和长期项目衔接的意愿较突出。',
  稍高:'本次较偏向延续当前职业和任务，对长期投入持相对积极的态度，同时仍会权衡具体工作条件。',
  平均:'本次回答兼顾延续当前工作与考虑其他选择；哪些条件支持长期投入，需要结合具体工作安排理解。',
  稍低:'本次对新任务或其他机会保留较多空间，继续投入的意愿可能更受发展机会和具体工作条件影响。',
  较低:'本次更倾向为职业或工作变化保留选择，宜先了解发展意愿及交接安排，不直接等同于缺乏责任感。'
 },
 PF:{
  较高:'本次工作偏好明显接近岗位组合重视的责任落实、协作和有序推进，可据分项识别较突出的工作特点。',
  稍高:'本次工作方式较接近当前岗位组合要求，部分特点有助于理解现场协调习惯；具体表现仍取决于任务情境。',
  平均:'本次工作方式与当前岗位组合要求有部分契合；具体强项和需要支持的环节，要结合分项差异理解。',
  稍低:'本次部分工作偏好与当前岗位组合要求存在差异，可从分项找出需要更明确安排或支持的环节。',
  较低:'本次工作侧重点与当前岗位组合要求差异较多，宜具体讨论任务分工和支持条件；不表示没有工作能力。'
 },
 MH:{
  较高:'本次较集中地反映担忧、低落、紧张或恢复困难等困扰，应优先了解对日常状态的影响及支持需求。',
  稍高:'本次主观困扰相对较多，可能在休息恢复、情绪调整或注意方面感到更费力，可先了解近期负担。',
  平均:'本次在情绪、精力或注意等方面反映一定主观负担，可结合分项找出最影响近期状态的环节。',
  稍低:'本次较少提及相关困扰，主观负担相对较轻；仍需留意具体情境和近期状态的变化。',
  较低:'本次很少提及这些困扰，仅说明问卷中较少呈现相关体验，不能据此推断精力或抗压能力更强。'
 }
};
export const DIMENSION_EXPLANATIONS={
 ST1:{high:'较愿持续积累当前职业经验',low:'为其他职业方向保留选择，不等于工作不负责'},
 ST2:{high:'较愿延续熟悉单位与任务',low:'更愿尝试新任务或单位，可沟通交接安排'},
 WV_STABILITY:{high:'较看重稳定保障和可预期的安排',low:'相对更看重稳定保障以外的工作条件'},
 WV_GROWTH:{high:'较看重学习和发展机会',low:'相对更看重其他工作条件，不等于缺乏进取心'},
 WV_REWARD:{high:'较看重收入回报与兑现条件',low:'不把报酬提升放在首位，不代表可接受欠薪'},
 PF1:{high:'重视要求落实、记录复核与收尾交接',low:'较少优先关注记录和收尾，可用清单明确要求'},
 PF2:{high:'愿意听取意见并协调任务分歧',low:'偏向独立推进或直接表达，可明确协作接口'},
 PF3:{high:'压力下较倾向保持节奏和恢复状态',low:'情绪较易受压力牵动，可了解触发情境与支持'},
 PF4:{high:'较愿主动表达、交流和建立联系',low:'沟通更谨慎，可约定主动反馈节点'},
 PF5:{high:'较愿换角度探索不同做法',low:'偏好熟悉可靠的办法，变更时可给出清晰过渡安排'},
 PF6:{high:'较愿主动设目标、改进并推动任务',low:'对额外目标投入较少，可明确任务意义与阶段目标'},
 PF7:{high:'倾向预排步骤、资源与交接节点',low:'偏向边做边调整，多任务时可补充分工与节点'},
 SJ1:{high:'倾向先厘清原因并比较解决办法',low:'更倾向直接行动，可补充核实与备选方案'},
 SJ2:{high:'较注意兼顾对方需要和合作关系',low:'更直接表达立场，可多澄清需求与边界'},
 SJ3:{high:'较重视规则核验及责任留痕',low:'更着眼眼前进度，涉及责任时可补齐检查与确认'},
 MH1:{high:'较多担忧或反复预想不利情况',low:'较少报告担忧，不表示不会出现焦虑体验'},
 MH2:{high:'较多反映低落或消极体验',low:'较少提及低落，不等于工作动力一定充足'},
 MH3:{high:'较多反映疲倦或休息恢复方面的困扰',low:'较少反映疲倦困扰，不等于体力充足'},
 MH4:{high:'情绪恢复和调整相对费力',low:'较少报告情绪调节困难，不代表不需支持'},
 MH5:{high:'较多反映注意分散或集中困难',low:'较少提及集中困难，不等于所有任务都能专注'},
 MH6:{high:'较易感到紧绷和压力负担',low:'较少报告紧张压力，不证明抗压能力更强'},
 RV1:{high:'自我描述较理想化，需结合具体事例理解',low:'较少理想化描述，不等于内容更真实'},
 RV2:{high:'相近内容的回答较协调，但不是真实性证明',low:'相近回答存在差异，宜先核对题意与情境'},
 RV3:{high:'作答节奏较符合当前参考，但不保证理解充分',low:'作答节奏需核对分心、题意理解或计时问题'}
};
const domains=[['ST1','ST2','WV_STABILITY','WV_GROWTH','WV_REWARD'],['PF1','PF2','PF3','PF4','PF5','PF6','PF7','SJ1','SJ2','SJ3'],['MH1','MH2','MH3','MH4','MH5','MH6']];
function candidate(row,domain){
 if(!valid(row)||!finite(row.mean)||!finite(row.lower)||!finite(row.upper)||!(row.lower<row.mean&&row.mean<row.upper)||!DIMENSION_EXPLANATIONS[row.code]||!high(row.label)&&!low(row.label))return null;
 const direction=high(row.label)?'high':'low';
 // Standardize by the matching half of THIS metric's reference interval.
 // Used solely to choose prose emphasis, not as a new assessment score.
 const width=row.score>=row.mean?row.upper-row.mean:row.mean-row.lower;
 return {code:row.code,name:row.name,label:row.label,domain,direction,wording:DIMENSION_EXPLANATIONS[row.code][direction],deviation:Math.abs(row.score-row.mean)/width};
}
const order=(a,b)=>b.deviation-a.deviation||a.code.localeCompare(b.code);
export function selectReportFeatures(report){
 const rows=report.dimensions||[];
 const groups=domains.map((codes,domain)=>rows.filter(row=>codes.includes(row.code)).map(row=>candidate(row,domain)).filter(Boolean).sort(order));
 const selected=groups.map(group=>group[0]||null);
 // When work domains offer both directions, avoid reporting only one side.
 const work=selected.slice(0,2).filter(Boolean);
 if(work.length===2&&work[0].direction===work[1].direction){
  const alternatives=groups.slice(0,2).flatMap(group=>group.filter(row=>row.direction!==work[0].direction)).sort(order);
  if(alternatives[0])selected[alternatives[0].domain]=alternatives[0];
 }
 return selected.filter(Boolean);
}
function qualityText(report,totals){
 const dims=report.dimensions||[],rv=totals.get('RV'),rv1=dims.find(v=>v.code==='RV1'),rv2=dims.find(v=>v.code==='RV2'),rv3=dims.find(v=>v.code==='RV3'),mh=totals.get('MH');
 if(!valid(rv2)||!valid(rv3))return {limited:true,text:'回答一致性或作答认真程度信息不完整，当前解释把握有限，宜先补充核对。'};
 if(low(rv2.label)&&low(rv3.label))return {limited:true,text:'前后回答协调性与作答节奏均需核对，当前解释把握有限；宜先了解题意理解和答题过程。'};
 if(low(rv2.label))return {limited:true,text:'相近内容的回答存在差异，当前解释把握有限；宜先澄清题意与具体情境，不据此认定不诚实。'};
 if(low(rv3.label))return {limited:true,text:'作答节奏出现需核对的线索，可能涉及分心、题意理解或计时问题，当前解释把握有限。'};
 if(!valid(rv)||!valid(rv1))return {limited:true,text:'作答质量综合信息不完整，当前解释把握有限，应补充核对后再使用结果。'};
 if(valid(mh)&&low(mh.label)&&high(rv1.label))return {limited:low(rv.label),text:(low(rv.label)?'当前解释把握有限；':'')+'本次较少呈现困扰，同时自我描述偏理想化，需结合近期实际体验了解；这不证明存在隐瞒。'};
 if(high(rv1.label))return {limited:low(rv.label),text:(low(rv.label)?'当前解释把握有限；':'')+'自我描述较理想化，宜多了解具体事例；这不等于不诚实，作答质量高也不保证内容真实。'};
 if(low(rv.label))return {limited:true,text:'整体有较多影响解释的作答线索，宜先核对答题过程；不据此判断人品或工作态度。'};
 return {limited:false,text:'本次回答协调性与作答节奏未见突出疑点，可作沟通线索，但不能视为真实性保证。'};
}
export function createReportSummary(report){
 const totals=new Map((report.totals||[]).map(row=>[row.code,row]));
 const dims=report.dimensions||[];
 const cards=['ST','PF','MH'].map(code=>({code,interpretation:valid(totals.get(code))?TOTAL_EXPLANATIONS[code][totals.get(code).label]:'本指标暂无法完整重算，需补充或核对原始作答后再作解释。'}));
 let features=selectReportFeatures(report);
 const missing=cards.some(card=>!valid(totals.get(card.code)));
 const mixed=domains.some((codes,i)=>totals.get(['ST','PF','MH'][i])?.label==='平均'&&dims.some(row=>codes.includes(row.code)&&valid(row)&&high(row.label))&&dims.some(row=>codes.includes(row.code)&&valid(row)&&low(row.label)));
 const opposite=features.some(feature=>{const total=totals.get(['ST','PF','MH'][feature.domain]);return valid(total)&&(high(total.label)&&feature.direction==='low'||low(total.label)&&feature.direction==='high');});
 const intro=missing?'部分综合指标暂缺完整结果，以下仅解读可用分项。':mixed?'综合分包含不同方向的分项，不能只用“平均”概括。':opposite?'综合分与个别分项方向不同，宜分开理解。':'分项帮助说明本次工作方式与主观体验的具体特点。';
 const quality=qualityText(report,totals);
 const closing='建议结合近期具体事例、工作条件与支持需求理解，不作诊断或岗位资格判断。';
 const featureText=()=>features.length?features.map(v=>`${v.name}${v.label}，${v.wording}`).join('；')+'。':dims.some(row=>valid(row)&&finite(row.mean))?'可用分项未呈现明显高低差异，仍可结合具体任务了解工作偏好与近期状态。':'分项数据不足，需补充或核对原始作答后再解读特点。';
 const assemble=()=>quality.limited?[quality.text,intro,featureText(),closing]:[intro,featureText(),quality.text,closing];
 let overview=assemble().join('');
 // Never clip a sentence or shrink type to fit: prefer two complete features.
 if(overview.length>260&&features.length>2){features=features.slice(0,2);overview=assemble().join('');}
 if(overview.length<180&&!missing&&features.length)overview+='高低各有具体含义，不用于简单的优劣排序；沟通时可先从最影响当前任务的事项入手。';
 return {cards,overview};
}
