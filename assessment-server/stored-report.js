import {calculateReport,data,engine} from './scoring.js';
import evidence from './private/private-answer-evidence.cjs';
// Only persist this snapshot. Every owner/admin response must pass through presentReport.
export function createStoredReport(answers,seconds){return {...calculateReport(answers,seconds),internalEvidence:evidence.buildInternalEvidence({data,engine,answers,seconds})};}
