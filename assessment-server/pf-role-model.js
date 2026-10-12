import {requireVersion,currentVersion} from './version-registry.js';
const model=requireVersion().pfModel;
export const pfModelId=model.id,pfReferenceId=model.referenceId,pfRoleTitle=model.roleTitle;
export const pfReference=model.reference;
export function rolePFTotal(result,version=currentVersion){const model=requireVersion(version).pfModel;const sum=values=>Object.keys(model.weights).every(code=>Number.isFinite(values[code]))?Object.entries(model.weights).reduce((sum,[code,weight])=>sum+values[code]*weight,0):null;return {raw:sum(result.raw),reference:sum(result.reference)};}
