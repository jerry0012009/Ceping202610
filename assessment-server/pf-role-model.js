import model from './private/pf-role-model.json' with {type:'json'};
export const pfModelId=model.id,pfReferenceId=model.referenceId,pfRoleTitle=model.roleTitle;
export const pfReference=model.reference;
export function rolePFTotal(result){const sum=values=>Object.keys(model.weights).every(code=>Number.isFinite(values[code]))?Object.entries(model.weights).reduce((sum,[code,weight])=>sum+values[code]*weight,0):null;return {raw:sum(result.raw),reference:sum(result.reference)};}
