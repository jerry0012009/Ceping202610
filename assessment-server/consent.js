import {randomUUID} from 'node:crypto';

// Single authoritative notice: browser text and immutable acceptance snapshots
// are both supplied by the server. This version is unrelated to scoring versions.
export const CONSENT_NOTICE=Object.freeze({
 version:'notice-v2.12-1',
 text:'尊敬的女士/先生：\n非常感谢您填写这份问卷。本测试旨在帮助您了解自身心理情况，评估并改善您的工作环境，更好地帮助您缓解工作和生活带来的各种压力。\n本调查共分为三个部分：第一部分为工作经历与家庭信息，了解您的相关背景；第二部分为工作中的选择，了解您的工作偏好与工作风格；第三部分为日常反应与体验，了解您的心理感受与日常状态。答案无对错之分，请按各题要求的时间范围与实际情况作答。\n测验结束后，我们将向您提供反馈报告和建议，帮助您更好地了解自己；同时，我们会将您的测验结果分享给相关职能部门，用于分析并改善您的工作环境。\n衷心感谢您的支持与合作！'
});

export function createConsentStore(db){
 // Additive migration only. Never fabricate consent for historical reports or
 // drafts, and preserve their established column layouts and INSERT semantics.
 db.exec(`
  CREATE TABLE IF NOT EXISTS consent_records (
   id TEXT PRIMARY KEY,
   user_id TEXT NOT NULL REFERENCES user(id),
   notice_version TEXT NOT NULL,
   notice_text TEXT NOT NULL,
   accepted_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS consent_records_owner_date ON consent_records(user_id,accepted_at);
  CREATE TABLE IF NOT EXISTS active_consents (
   user_id TEXT PRIMARY KEY REFERENCES user(id),
   consent_id TEXT NOT NULL UNIQUE REFERENCES consent_records(id)
  );
  CREATE TABLE IF NOT EXISTS assessment_consents (
   assessment_id TEXT PRIMARY KEY REFERENCES assessments(id),
   consent_id TEXT NOT NULL UNIQUE REFERENCES consent_records(id)
  );
 `);
 const current=userId=>{
  const record=db.prepare('SELECT c.id,c.notice_version AS version,c.accepted_at AS acceptedAt FROM active_consents a JOIN consent_records c ON c.id=a.consent_id WHERE a.user_id=? AND c.user_id=? AND c.notice_version=?').get(userId,userId,CONSENT_NOTICE.version);
  return record?{...record}:null;
 };
 return {
  current,
  status(userId){const consent=current(userId);return {notice:{...CONSENT_NOTICE},consent,required:!consent};},
  accept(userId){
   // Network retries for the same unfinished attempt reuse the same evidence.
   const prior=current(userId);if(prior)return {created:false,consent:prior};
   const consent={id:randomUUID(),version:CONSENT_NOTICE.version,acceptedAt:new Date().toISOString()};
   db.exec('BEGIN IMMEDIATE');
   try{
    db.prepare('INSERT INTO consent_records (id,user_id,notice_version,notice_text,accepted_at) VALUES (?,?,?,?,?)').run(consent.id,userId,consent.version,CONSENT_NOTICE.text,consent.acceptedAt);
    db.prepare('INSERT INTO active_consents (user_id,consent_id) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET consent_id=excluded.consent_id').run(userId,consent.id);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return {created:true,consent};
  },
  reset(userId){db.prepare('DELETE FROM active_consents WHERE user_id=?').run(userId);},
  // Called inside the submission transaction: one acceptance can authorize one
  // completed attempt, and linkage cannot survive a failed submission.
  consume(userId,assessmentId,consentId){
   const consent=current(userId);
   if(!consent||consent.id!==consentId)throw Object.assign(new Error('请先阅读并同意测评指导语。'),{status:403});
   db.prepare('INSERT INTO assessment_consents (assessment_id,consent_id) VALUES (?,?)').run(assessmentId,consentId);
   db.prepare('DELETE FROM active_consents WHERE user_id=? AND consent_id=?').run(userId,consentId);
  }
 };
}
