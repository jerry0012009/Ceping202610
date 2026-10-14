#!/usr/bin/env node
// Server-side operator maintenance only. No HTTP write endpoint or new identity.
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const usage='用法：npm run quota -- [--status | [--mode trial|paid] [--set N | --add N]]';
let db;
try{
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!['--status','--mode','--set','--add'].includes(key)||Object.hasOwn(options,key))throw new Error(usage);
  if(key==='--status')options[key]=true;
  else{const value=args[++i];if(value===undefined||value.startsWith('--'))throw new Error(usage);options[key]=value;}
 }
 if(options['--status']&&args.length!==1)throw new Error(usage);
 if(options['--set']!==undefined&&options['--add']!==undefined)throw new Error('--set 与 --add 不能同时使用');
 if(options['--mode']!==undefined&&!['trial','paid'].includes(options['--mode']))throw new Error('模式仅支持 trial 或 paid');
 for(const key of ['--set','--add'])if(options[key]!==undefined){if(!/^(0|[1-9]\d*)$/.test(options[key])||!Number.isSafeInteger(Number(options[key])))throw new Error('次数必须是非负安全整数');options[key]=Number(options[key]);}
 const filename=path.resolve(root,process.env.DATA_DIR||'data','assessment.sqlite');
 if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())throw new Error('数据库不存在，请检查 DATA_DIR；不会创建新库。');
 db=new DatabaseSync(filename);db.exec('PRAGMA busy_timeout=5000;');
 if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assessment_quota'").get())throw new Error('额度表不存在，请先启动 V2.14 服务完成增量初始化。');
 const mutation=options['--mode']!==undefined||options['--set']!==undefined||options['--add']!==undefined;
 if(mutation)db.exec('BEGIN IMMEDIATE');
 const current=db.prepare('SELECT mode,remaining FROM assessment_quota WHERE id=1').get();
 if(!current)throw new Error('额度记录缺失，请检查数据库。');
 const mode=options['--mode']??current.mode,remaining=options['--set']??(current.remaining+(options['--add']??0));
 if(!Number.isSafeInteger(remaining)||remaining<0)throw new Error('累计次数超出安全整数范围');
 if(mutation){db.prepare('UPDATE assessment_quota SET mode=?,remaining=? WHERE id=1').run(mode,remaining);db.exec('COMMIT');}
 console.log(JSON.stringify({database:filename,mode,remaining}));
}catch(error){if(db?.isTransaction)db.exec('ROLLBACK');console.error(error.message);process.exitCode=1;}finally{db?.close();}
