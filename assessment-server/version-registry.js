import currentData from './private/questionnaire-v2.10.json' with {type:'json'};
import currentEngine from './private/engine-v2.10.cjs';
import legacyData from './private/archive/v2.9/questionnaire.json' with {type:'json'};
import legacyEngine from './private/archive/v2.9/engine.cjs';
import currentPF from './private/pf-role-model.json' with {type:'json'};
import legacyPF from './private/archive/v2.9/pf-role-model.json' with {type:'json'};
import currentValues from './private/work-value-model.json' with {type:'json'};
import legacyValues from './private/archive/v2.9/work-value-model.json' with {type:'json'};
import currentPresentation from './private/report-presentation.json' with {type:'json'};
import legacyPresentation from './private/archive/v2.9/report-presentation.json' with {type:'json'};
import fingerprints from './private/version-fingerprints.json' with {type:'json'};
export const currentVersion='2.10';
const build=(data,engineModule,pfModel,workValueModel,presentation)=>({version:data.version,data,engine:engineModule.create(data),fingerprint:fingerprints[data.version],pfModel,workValueModel,presentation,
 questionnaire:{version:data.version,total:data.total,familyTotal:data.familyTotal,names:data.names,groups:data.groups,questions:data.questions.map(({id,number,stem,text,options,instructions,type})=>({id,number,stem,text,options:options.map(({key,text})=>({key,text})),instructions,type}))},
 pages:data.groups.flatMap(g=>Array.from({length:Math.ceil(g.ids.length/6)},(_,i)=>g.ids.slice(i*6,(i+1)*6)))});
const versions={'2.9':build(legacyData,legacyEngine,legacyPF,legacyValues,legacyPresentation),'2.10':build(currentData,currentEngine,currentPF,currentValues,currentPresentation)};
export function getVersion(version=currentVersion,fingerprint){const entry=typeof version==='string'&&Object.hasOwn(versions,version)?versions[version]:null;return entry&&(fingerprint===undefined||fingerprint===entry.fingerprint)?entry:null;}
export function requireVersion(version=currentVersion,fingerprint){const entry=getVersion(version,fingerprint);if(!entry)throw Object.assign(new Error('此记录的原始问卷版本或校验标识不可用，未使用其他版本替代。'),{status:422});return entry;}
