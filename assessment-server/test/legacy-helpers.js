// Frozen 2.9 regression suite: these helpers deliberately pin the original version.
import {requireVersion} from '../version-registry.js';
import {calculateReport as report,calculateReportSnapshot as snapshot,validateSubmission} from '../scoring.js';
import {createStoredReport as stored} from '../stored-report.js';
import {createWorkValuePreferences as preferences} from '../work-value-model.js';
const entry=requireVersion('2.9');
export const {engine,data,questionnaire,fingerprint,pages}=entry;
export {validateSubmission};
export const calculateReport=(a,s)=>report(a,s,'2.9');
export const calculateReportSnapshot=(a,s)=>snapshot(a,s,'2.9');
export const createStoredReport=(a,s)=>stored(a,s,'2.9');
export const createWorkValuePreferences=(r,a,source)=>preferences(r,a,source,'2.9');
export const workValueParts=entry.workValueModel.parts;
export const workValueArchive={version:entry.version,fingerprint:entry.fingerprint};
