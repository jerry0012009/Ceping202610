// Global installation allowance. Never derive it from historical assessments or env.
export const QUOTA_EXHAUSTED='QUOTA_EXHAUSTED';
export function createQuotaStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS assessment_quota (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL CHECK(mode IN ('trial','paid')),
  remaining INTEGER NOT NULL CHECK(typeof(remaining)='integer' AND remaining>=0 AND remaining<=9007199254740991)
 ); INSERT OR IGNORE INTO assessment_quota(id,mode,remaining) VALUES(1,'trial',10);`);
 const current=()=>db.prepare('SELECT mode,remaining FROM assessment_quota WHERE id=1').get();
 return {current,
  status(isAdmin=false){const row=current();return {mode:row.mode,canStart:row.remaining>0,...(row.mode==='trial'||isAdmin?{remaining:row.remaining}:{})};},
  consume(){return db.prepare('UPDATE assessment_quota SET remaining=remaining-1 WHERE id=1 AND remaining>0').run().changes===1;}
 };
}
export function quotaError(mode){return {error:mode==='trial'?'试用次数已用完，请联系管理员。':'测评次数已用完，请联系管理员。',code:QUOTA_EXHAUSTED};}
