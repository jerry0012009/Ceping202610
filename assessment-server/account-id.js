// Server operator only. Reads the local database; never prints passwords or sessions.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const email=process.argv[2];
if(!email){console.error('用法：npm run account-id -- 注册时填写的邮箱');process.exit(1);}
const root=path.dirname(fileURLToPath(import.meta.url));
const db=new DatabaseSync(path.join(path.resolve(root,process.env.DATA_DIR||'data'),'assessment.sqlite'),{readOnly:true});
const row=db.prepare('SELECT id,name,email FROM user WHERE email=?').get(email.trim().toLowerCase());
if(!row){console.error('未找到对应账号');process.exitCode=1;}else console.log(JSON.stringify(row,null,2));
db.close();
