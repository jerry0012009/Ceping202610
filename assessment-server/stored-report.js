import {calculateReportSnapshot,requireVersion,scoringVersion} from './scoring.js';
import {presentReport} from './report-presentation.js';
import evidence from './private/private-answer-evidence.cjs';
// Keep a completion snapshot and private evidence without exposing it in responses.
// Historical reads always derive the current report from the immutable answer row.
export function createStoredReport(answers,seconds,version=scoringVersion,answerVersion=version){
 const {data,engine}=requireVersion(version===scoringVersion&&answerVersion!==version?'2.10':version);
 const snapshot=calculateReportSnapshot(answers,seconds,version,answerVersion),view=presentReport(snapshot);
 return {...view,dimensions:snapshot.dimensions.map(row=>row.code==='ST3'?row:view.dimensions.find(shown=>shown.code===row.code)),internalEvidence:evidence.buildInternalEvidence({data,engine,answers,seconds})};
}

export function readStoredReport(row){
 const source=requireVersion(row.version,row.fingerprint);
 let answers,seconds;try{answers=JSON.parse(row.answers_json);seconds=JSON.parse(row.seconds_json);}catch{throw Object.assign(new Error('原始答卷或计时无法读取，暂不能按当前规则重算；原始记录未改写。'),{status:422});}
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 if(!object(answers)||!object(seconds)||source.data.questions.some(q=>q.type!=='family'&&!source.engine.complete(q,answers[q.id]))||source.data.questions.some(q=>q.cost>0&&(!Number.isFinite(seconds[q.id])||seconds[q.id]<0||seconds[q.id]>86400)))throw Object.assign(new Error('原始答卷或计时不完整，暂不能按当前规则重算；原始记录未改写。'),{status:422});
 return presentReport(calculateReportSnapshot(answers,seconds,scoringVersion,row.version));
}
