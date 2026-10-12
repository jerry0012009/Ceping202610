import {calculateReportSnapshot,requireVersion,scoringVersion} from './scoring.js';
import {presentReport} from './report-presentation.js';
import evidence from './private/private-answer-evidence.cjs';
// Persist current report metadata/copy and independent preferences, while keeping the
// original ST3 numeric row privately for compatibility. Every response uses presentReport.
export function createStoredReport(answers,seconds,version=scoringVersion){
 const {data,engine}=requireVersion(version);
 const snapshot=calculateReportSnapshot(answers,seconds,version),view=presentReport(snapshot);
 return {...view,dimensions:snapshot.dimensions.map(row=>row.code==='ST3'?row:view.dimensions.find(shown=>shown.code===row.code)),internalEvidence:evidence.buildInternalEvidence({data,engine,answers,seconds})};
}
