import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createPdfLinks,PDF_LINK_TTL} from '../pdf-links.js';

// Synthetic identifiers and a per-run secret; no account or report data is embedded.
const secret=randomBytes(32).toString('hex');
const claims=()=>({reportId:randomUUID(),ownerId:'synthetic-owner',issuerId:'synthetic-owner',admin:false});
function rejectIssueOrToken(links,claim){
 let grant;
 try{grant=links.issue(claim);}catch{return;}
 assert.equal(links.verify(grant?.token),null,'invalid claims cannot produce a usable download grant');
}

test('PDF links bind only report/owner/issuer identifiers and expire exactly after ten minutes',()=>{
 let now=1800000000000;
 const links=createPdfLinks(secret,()=>now),input=claims(),issuedAt=now;
 assert.equal(PDF_LINK_TTL,10*60*1000);
 const issued=links.issue(input);
 assert.equal(typeof issued.token,'string');assert.ok(issued.token.length>32);
 assert.equal(issued.expiresAt,issuedAt+PDF_LINK_TTL);
 assert.deepEqual(links.verify(issued.token),{v:1,...input,issuedAt,expiresAt:issuedAt+PDF_LINK_TTL});
 now=issued.expiresAt-1;
 assert.ok(links.verify(issued.token),'last millisecond before expiry remains valid');
 now=issued.expiresAt;
 assert.equal(links.verify(issued.token),null,'expiry boundary is exclusive');
 now+=1;
 assert.equal(links.verify(issued.token),null);
});

test('PDF links are tied to the signing secret and reject tampering and malformed inputs',()=>{
 const now=1800000000000,links=createPdfLinks(secret,()=>now);
 const {token}=links.issue(claims());
 assert.equal(createPdfLinks(randomBytes(32).toString('hex'),()=>now).verify(token),null);
 // Mutate interior characters, rather than a base64 padding bit in the last character.
 for(const position of [0,Math.floor(token.length/3),Math.floor(2*token.length/3)]){
  const altered=token.slice(0,position)+(token[position]==='A'?'B':'A')+token.slice(position+1);
  assert.equal(links.verify(altered),null,'altering signed token bytes fails closed');
 }
 for(const invalid of [undefined,null,false,1,{},[],Buffer.from(token),'','.',token+'.extra',token.slice(1),' '+token,token+'\n','x'.repeat(100000)]){
  assert.equal(links.verify(invalid),null,'malformed token fails closed without throwing');
 }
 assert.ok(links.verify(token),'failed verification does not consume a valid token');
});

test('only an owner may issue a non-admin link; admin links retain both identities',()=>{
 const now=1800000000000,links=createPdfLinks(secret,()=>now),input=claims();
 rejectIssueOrToken(links,{...input,issuerId:'synthetic-other'});
 const admin={...input,issuerId:'synthetic-admin',admin:true};
 const issued=links.issue(admin);
 assert.deepEqual(links.verify(issued.token),{v:1,...admin,issuedAt:now,expiresAt:now+PDF_LINK_TTL});
 assert.deepEqual(createPdfLinks(secret,()=>now).verify(issued.token),links.verify(issued.token),'verification survives a process restart with the same secret');
});

test('PDF link claims reject invalid identifiers',()=>{
 const links=createPdfLinks(secret,()=>1800000000000),input=claims();
 for(const key of ['reportId','ownerId','issuerId']){
  for(const value of ['',null,undefined,42,{},[],'x'.repeat(201)])rejectIssueOrToken(links,{...input,[key]:value});
 }
});

test('PDF link verification rejects a future issue time and does not extend a reused grant',()=>{
 let now=1800000000000;
 const links=createPdfLinks(secret,()=>now),issued=links.issue(claims());
 now-=1;
 assert.equal(links.verify(issued.token),null,'a not-yet-issued grant is invalid');
 now+=1;
 const first=links.verify(issued.token);
 now+=PDF_LINK_TTL/2;
 assert.deepEqual(links.verify(issued.token),first,'download retries do not refresh token expiry');
 now=issued.expiresAt;
 assert.equal(links.verify(issued.token),null);
});

test('even correctly signed tokens reject invalid versions, privilege bindings, and lifetime claims',()=>{
 const now=1800000000000,links=createPdfLinks(secret,()=>now);
 const valid={v:1,...claims(),issuedAt:now,expiresAt:now+PDF_LINK_TTL};
 const sign=claim=>{
  const payload=Buffer.from(JSON.stringify(claim)).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update('assessment-pdf-download-v1\0'+payload).digest('base64url');
 };
 assert.deepEqual(links.verify(sign(valid)),valid,'test fixture follows the documented token signing domain');
 const invalid=[
  {...valid,v:2},{...valid,v:'1'},
  ...['true','false',1,0,null,{},[]].map(admin=>({...valid,admin})),
  {...valid,issuerId:'synthetic-other'},{...valid,reportId:''},
  {...valid,issuedAt:now+1},{...valid,issuedAt:now+0.5},
  {...valid,expiresAt:now},{...valid,expiresAt:now-1},
  {...valid,expiresAt:now+PDF_LINK_TTL+1},{...valid,expiresAt:now+PDF_LINK_TTL-1},{...valid,expiresAt:now+PDF_LINK_TTL-0.5},
  {...valid,issuedAt:String(now)},{...valid,expiresAt:String(now+PDF_LINK_TTL)},
  {...valid,issuedAt:null},{...valid,expiresAt:null},null,[],{}
 ];
 for(const claim of invalid)assert.equal(links.verify(sign(claim)),null);
});
