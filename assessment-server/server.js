import express from 'express';
import {createQuotaStore,quotaError} from './quota.js';
import {CONSENT_NOTICE,createConsentStore} from './consent.js';
import {answerDetails} from './answer-details.js';
import {createStoredReport,readStoredReport} from './stored-report.js';
import {presentReport} from './report-presentation.js';
import {generateReportPdf,pdfDisposition,PDF_REVISION} from './report-pdf.js';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {betterAuth} from 'better-auth';
import {toNodeHandler,fromNodeHeaders} from 'better-auth/node';
import {getMigrations} from 'better-auth/db/migration';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {questionnaire,validateSubmission,calculateReport,fingerprint,pages,requireVersion} from './scoring.js';
const root=path.dirname(fileURLToPath(import.meta.url));
export async function createApplication(env=process.env){
 const production=env.NODE_ENV==='production';
 const authRateLimit=Number(env.AUTH_RATE_LIMIT||120);if(!Number.isInteger(authRateLimit)||authRateLimit<20||authRateLimit>1000)throw new Error('AUTH_RATE_LIMIT 必须为20—1000的整数');
 const origin=env.APP_ORIGIN||'http://localhost:3000';
 const url=new URL(origin);
 if(url.origin!==origin||(production&&url.protocol!=='https:')||!['http:','https:'].includes(url.protocol))throw new Error('APP_ORIGIN 必须是完整同源地址；生产环境必须为 HTTPS');
 const adminUserId=typeof env.ADMIN_USER_ID==='string'?env.ADMIN_USER_ID.trim():'';
 const secret=env.AUTH_SECRET;
 if(!secret||secret.length<32||new Set(secret).size<12||/change|example|replace/i.test(secret))throw new Error('请生成随机 AUTH_SECRET（至少32字符）');
 process.umask(0o077);
 const dir=path.resolve(root,env.DATA_DIR||'data');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(process.platform!=='win32'&&(fs.statSync(dir).mode&0o077)){if(dir===path.join(root,'data'))fs.chmodSync(dir,0o700);else throw new Error('DATA_DIR 必须是当前服务独占的0700私有目录');}
 const db=new DatabaseSync(path.join(dir,'assessment.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const auth=betterAuth({appName:'个人测评',baseURL:origin,secret,database:db,trustedOrigins:[origin],
 emailAndPassword:{enabled:true,minPasswordLength:6,maxPasswordLength:128,requireEmailVerification:false},
 session:{expiresIn:60*60*24*7,updateAge:60*60*24,cookieCache:{enabled:false}},
 rateLimit:{enabled:true,window:60,max:authRateLimit},
 advanced:{useSecureCookies:production||url.protocol==='https:',defaultCookieAttributes:{httpOnly:true,sameSite:'lax'},ipAddress:{ipAddressHeaders:['x-assessment-client-ip']}},
 logger:{disabled:true}});
 const migrations=await getMigrations(auth.options);await migrations.runMigrations();
 db.exec(`CREATE TABLE IF NOT EXISTS assessments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), submission_id TEXT NOT NULL, version TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT NOT NULL, answers_json TEXT NOT NULL, seconds_json TEXT NOT NULL, report_json TEXT NOT NULL, UNIQUE(user_id,submission_id)); CREATE INDEX IF NOT EXISTS assessments_owner_date ON assessments(user_id,created_at DESC);`);
 db.exec('CREATE TABLE IF NOT EXISTS drafts (user_id TEXT PRIMARY KEY REFERENCES user(id), version TEXT NOT NULL, position INTEGER NOT NULL, answers_json TEXT NOT NULL, seconds_json TEXT NOT NULL, updated_at TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, report_id TEXT, created_at TEXT NOT NULL)');
 const consents=createConsentStore(db);
 const quota=createQuotaStore(db);
 const app=express();app.disable('x-powered-by');
 // Accept proxy addresses only from loopback. The deployment proxy must overwrite forwarding headers.
 app.set('trust proxy',env.TRUST_PROXY==='loopback'?'loopback':false);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],formAction:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:production?[]:null}},strictTransportSecurity:production?undefined:false}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');req.headers['x-assessment-client-ip']=req.ip;if(env.TRUST_PROXY!=='loopback')delete req.headers['x-forwarded-for'];delete req.headers['x-real-ip'];if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'请求来源不允许'});next();});
 app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'请求过于频繁，请稍后重试'}}));
 app.use('/api/auth',rateLimit({windowMs:60000,limit:authRateLimit,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'登录操作过于频繁，请稍后重试'}}));
 // Better Auth must receive the unconsumed request body, before express.json().
 app.all('/api/auth/*splat',toNodeHandler(auth));
 app.use('/api',express.json({limit:'64kb',strict:true}));
 app.use('/api',async(req,res,next)=>{try{const session=await auth.api.getSession({headers:fromNodeHeaders(req.headers)});if(!session)return res.status(401).json({error:'请先登录'});req.user=session.user;next();}catch{res.status(401).json({error:'会话无效，请重新登录'});}});
 app.use('/api',(req,res,next)=>{
  const guarded=(req.path==='/draft'&&['PUT','DELETE'].includes(req.method))||(req.path==='/assessments'&&req.method==='POST')||(req.path==='/consent'&&req.method==='POST');
  if(!guarded)return next();const owner=req.get('X-Assessment-Owner');
  if(!owner)return res.status(409).json({error:'页面已更新，请先保留未保存内容，再刷新后继续。'});
  if(owner!==req.user.id)return res.status(401).json({error:'登录账户已切换，请使用原账户重新登录后继续。'});
  next();
 });
 app.get('/api/me',(req,res)=>res.json({user:{id:req.user.id,name:req.user.name,email:req.user.email,isAdmin:!!adminUserId&&req.user.id===adminUserId}}));
 app.get('/api/quota',(req,res)=>{if(req.get('X-Assessment-Owner')&&req.get('X-Assessment-Owner')!==req.user.id)return res.status(401).json({error:'登录账户已切换，请重新登录后继续。'});res.json(quota.status(!!adminUserId&&req.user.id===adminUserId));});
 app.get('/api/consent',(req,res)=>res.json(consents.status(req.user.id)));
 app.post('/api/consent',(req,res)=>{
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['version','accepted'].includes(key))||body.accepted!==true||typeof body.version!=='string')return res.status(400).json({error:'请阅读完整指导语，并明确勾选同意。'});
  if(body.version!==CONSENT_NOTICE.version)return res.status(409).json({error:'指导语已更新，请重新阅读并同意。',code:'CONSENT_VERSION_CHANGED'});
  const result=consents.accept(req.user.id);res.status(result.created?201:200).json({consent:result.consent,required:false});
 });
 const requireConsent=(req,res)=>{
  const consent=consents.current(req.user.id);
  if(!consent)res.status(403).json({error:'请先阅读并同意测评指导语，再开始或继续作答。',code:'CONSENT_REQUIRED'});
  return consent;
 };
 app.get('/api/questionnaire',(req,res)=>{const allowance=quota.current();if(allowance.remaining===0)return res.status(403).json(quotaError(allowance.mode));try{res.json(requireVersion(req.query.version||undefined).questionnaire);}catch(error){res.status(422).json({error:error.message});}});
 const canonical=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]))):v;
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 app.get('/api/draft',(req,res)=>{const row=db.prepare('SELECT * FROM drafts WHERE user_id=?').get(req.user.id);res.json({draft:row?{submissionId:consents.current(req.user.id)?.id||null,version:row.version,position:row.position,answers:JSON.parse(row.answers_json),seconds:JSON.parse(row.seconds_json),updatedAt:row.updated_at}:null});});
 app.delete('/api/draft',(req,res)=>{
  db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM drafts WHERE user_id=?').run(req.user.id);consents.reset(req.user.id);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  res.json({ok:true});
 });
 app.put('/api/draft',(req,res)=>{
  if(!requireConsent(req,res))return;
  const b=req.body;
  let bank;try{bank=requireVersion(b?.version);}catch(e){return res.status(400).json({error:e.message});}
  const {pages,questionnaire}=bank;
  if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['version','position','answers','seconds'].includes(k))||!Number.isInteger(b.position)||b.position<1||b.position>pages.length)return res.status(400).json({error:'草稿结构不正确'});
  try{validateSubmission({version:b.version,answers:b.answers,seconds:b.seconds,submissionId:randomUUID()},true);}catch(e){return res.status(400).json({error:e.message});}
  const old=db.prepare('SELECT * FROM drafts WHERE user_id=?').get(req.user.id),prior=old?{version:old.version,position:old.position,answers:JSON.parse(old.answers_json),seconds:JSON.parse(old.seconds_json)}:null;
  if(prior&&prior.version!==b.version)return res.status(409).json({error:'草稿版本已固定，请继续原版本或明确开始新测评'});
  if(prior&&equal(prior,b))return res.json({ok:true,position:b.position});
  if((prior?.position||0)+1!==b.position)return res.status(409).json({error:'请按顺序保存；已提交页面已锁定'});
  const ids=pages.slice(0,b.position).flat();
  if(Object.keys(b.answers).some(id=>!ids.includes(id))||Object.keys(b.seconds).some(id=>!ids.includes(id)))return res.status(400).json({error:'不可提前提交后续题目'});
  for(const id of ids)if(questionnaire.questions.find(q=>q.id===id).type!=='family'&&!Object.hasOwn(b.answers,id))return res.status(400).json({error:'请完成本页题目'});
  if(prior)for(const key of ['answers','seconds'])for(const id of pages.slice(0,prior.position).flat())if(!equal(prior[key][id],b[key][id]))return res.status(409).json({error:'已提交页面已锁定'});
  db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,position=excluded.position,answers_json=excluded.answers_json,seconds_json=excluded.seconds_json,updated_at=excluded.updated_at').run(req.user.id,b.version,b.position,JSON.stringify(b.answers),JSON.stringify(b.seconds),new Date().toISOString());res.json({ok:true,position:b.position});
 });
 app.get('/api/assessments',(req,res)=>{
  const rows=db.prepare('SELECT id,version,created_at AS createdAt FROM assessments WHERE user_id=? ORDER BY created_at DESC,id DESC').all(req.user.id);res.json({assessments:rows});
 });
 const serialize=row=>({id:row.id,version:row.version,createdAt:row.created_at,report:readStoredReport(row)});
 app.get('/api/assessments/:id',(req,res)=>{const row=db.prepare('SELECT * FROM assessments WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!row)return res.status(404).json({error:'记录不存在'});res.json(serialize(row));});
 // Export only the same server-recalculated presentation used by history views.
 const sendPdf=async(req,res,row,owner,onSuccess)=>{
  if(!row)return res.status(404).json({error:'记录不存在'});
  if(req.get('X-Assessment-Owner')&&req.get('X-Assessment-Owner')!==req.user.id)return res.status(401).json({error:'登录账户已切换，请重新登录后继续。'});
  const saved={...serialize(row),owner};
  const controller=new AbortController();
  const closed=()=>{if(!res.writableEnded)controller.abort();};
  res.once('close',closed);
  try{
   const pdf=await generateReportPdf(saved,{signal:controller.signal});
   if(controller.signal.aborted)return;
   onSuccess?.();
   res.set({'Content-Type':'application/pdf','Content-Disposition':pdfDisposition(saved),'Cache-Control':'no-store','X-Report-Export-Version':PDF_REVISION}).send(pdf);
  }finally{res.removeListener('close',closed);}
 };
 app.get('/api/assessments/:id/pdf',async(req,res)=>{
  const row=db.prepare('SELECT * FROM assessments WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  await sendPdf(req,res,row,{name:req.user.name,email:req.user.email});
 });
 const audit=(adminId,action,assessmentId=null)=>db.prepare('INSERT INTO admin_audit VALUES (?,?,?,?,?)').run(randomUUID(),adminId,action,assessmentId,new Date().toISOString());
 app.use('/api/admin',(req,res,next)=>{if(!adminUserId||req.user.id!==adminUserId)return res.status(403).json({error:'无权查看此页面'});next();});
 app.get('/api/admin/assessments',(req,res)=>{
  const offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return res.status(400).json({error:'分页参数不正确'});
  const rows=db.prepare('SELECT a.id,a.version,a.created_at AS createdAt,u.id AS ownerId,u.name AS ownerName,u.email AS ownerEmail FROM assessments a JOIN user u ON u.id=a.user_id ORDER BY a.created_at DESC,a.id DESC LIMIT 51 OFFSET ?').all(offset);
  audit(req.user.id,'list');res.json({assessments:rows.slice(0,50).map(({ownerId,ownerName,ownerEmail,...row})=>({...row,user:{id:ownerId,name:ownerName,email:ownerEmail}})),nextOffset:rows.length>50?offset+50:null});
 });
 app.get('/api/admin/assessments/:id',(req,res)=>{
  const row=db.prepare('SELECT a.*,u.id AS ownerId,u.name AS ownerName,u.email AS ownerEmail FROM assessments a JOIN user u ON u.id=a.user_id WHERE a.id=?').get(req.params.id);
  if(!row)return res.status(404).json({error:'记录不存在'});
  audit(req.user.id,'view',row.id);res.json({...serialize(row),owner:{id:row.ownerId,name:row.ownerName,email:row.ownerEmail}});
 });
 app.get('/api/admin/assessments/:id/pdf',async(req,res)=>{
  const row=db.prepare('SELECT a.*,u.name AS ownerName,u.email AS ownerEmail FROM assessments a JOIN user u ON u.id=a.user_id WHERE a.id=?').get(req.params.id);
  await sendPdf(req,res,row,row?{name:row.ownerName,email:row.ownerEmail}:null,()=>audit(req.user.id,'export-pdf',row.id));
 });
 app.get('/api/admin/assessments/:id/answers',(req,res)=>{
  const row=db.prepare('SELECT a.*,u.id AS ownerId,u.name AS ownerName,u.email AS ownerEmail FROM assessments a JOIN user u ON u.id=a.user_id WHERE a.id=?').get(req.params.id);
  if(!row)return res.status(404).json({error:'记录不存在'});
  let details;try{details=answerDetails(row.version,JSON.parse(row.answers_json),row.fingerprint);}catch(error){if(error.status===422)return res.status(422).json({error:error.message});throw error;}
  audit(req.user.id,'answers',row.id);res.json({id:row.id,version:row.version,createdAt:row.created_at,owner:{id:row.ownerId,name:row.ownerName,email:row.ownerEmail},...details});
 });
 app.post('/api/assessments',(req,res)=>{
  let b;try{b=validateSubmission(req.body);}catch(e){return res.status(400).json({error:e.message});}
  // Deterministic key ordering makes retried equivalent JSON idempotent.
  const hash=createHash('sha256').update(JSON.stringify(canonical(b))).digest('hex');
  // Serialize across processes: the idempotency read, eligibility checks, score,
  // debit, saved report and consent consumption are one atomic write transaction.
  db.exec('BEGIN IMMEDIATE');
  try{
   const existing=db.prepare('SELECT * FROM assessments WHERE user_id=? AND submission_id=?').get(req.user.id,b.submissionId);
   if(existing){db.exec('COMMIT');if(existing.request_hash!==hash)return res.status(409).json({error:'相同提交标识对应不同答案，请重新提交'});return res.json(serialize(existing));}
   const allowance=quota.current();
   if(allowance.remaining===0){db.exec('ROLLBACK');return res.status(403).json(quotaError(allowance.mode));}
   const consent=consents.current(req.user.id);
   if(!consent){db.exec('ROLLBACK');return res.status(403).json({error:'请先阅读并同意测评指导语，再开始或继续作答。',code:'CONSENT_REQUIRED'});}
   const {pages,fingerprint}=requireVersion(b.version);
   const draft=db.prepare('SELECT * FROM drafts WHERE user_id=?').get(req.user.id);
   if(draft&&draft.version!==b.version){db.exec('ROLLBACK');return res.status(409).json({error:'提交版本与草稿版本不一致'});}
   if(draft&&(!equal(JSON.parse(draft.answers_json),b.answers)||!equal(JSON.parse(draft.seconds_json),b.seconds)||draft.position!==pages.length)){db.exec('ROLLBACK');return res.status(409).json({error:'请先按顺序完成并保存所有页面'});}
   const id=randomUUID(),createdAt=new Date().toISOString(),report=createStoredReport(b.answers,b.seconds,undefined,b.version);
   if(!quota.consume())throw new Error('Allowance changed during transaction');
   db.prepare('INSERT INTO assessments VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,req.user.id,b.submissionId,b.version,fingerprint,createdAt,hash,JSON.stringify(b.answers),JSON.stringify(b.seconds),JSON.stringify(report));
   db.prepare('DELETE FROM drafts WHERE user_id=?').run(req.user.id);consents.consume(req.user.id,id,consent.id);
   db.exec('COMMIT');
   res.status(201).json({id,version:b.version,createdAt,report:presentReport(report)});
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}

 });
 app.use('/api',(req,res)=>res.status(404).json({error:'接口不存在'}));
 // Never serve the project root, private/, data/, tests, or node_modules.
 app.use(express.static(path.join(root,'public'),{dotfiles:'deny',index:'index.html',fallthrough:true}));
 app.use((req,res)=>res.status(404).send('Not found'));
 app.use((err,req,res,next)=>{res.status(err.type==='entity.too.large'?413:err instanceof SyntaxError?400:err.status||500).json({error:err.status?err.message:'请求无法处理'});});
 return {app,db,auth};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {app,db}=await createApplication();const port=Number(process.env.PORT||3000);const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Assessment server listening on port ${port}`));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
