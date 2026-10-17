import {createHmac,timingSafeEqual} from 'node:crypto';
export const PDF_LINK_TTL=10*60*1000;
export function createPdfLinks(secret,now=Date.now){
 const sign=value=>createHmac('sha256',secret).update('assessment-pdf-download-v1\0'+value).digest('base64url');
 return {
  issue({reportId,ownerId,issuerId,admin}){
   const issuedAt=now(),expiresAt=issuedAt+PDF_LINK_TTL;
   const payload=Buffer.from(JSON.stringify({v:1,reportId,ownerId,issuerId,admin:admin===true,issuedAt,expiresAt})).toString('base64url');
   return {token:payload+'.'+sign(payload),expiresAt};
  },
  verify(token){
   if(typeof token!=='string'||token.length>2048||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))return null;
   const [payload,signature]=token.split('.');
   const expected=sign(payload);
   if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
   try{
    const value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')),time=now();
    if(value.v!==1||typeof value.admin!=='boolean'||!['reportId','ownerId','issuerId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=200)||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt-value.issuedAt!==PDF_LINK_TTL||value.issuedAt>time||value.expiresAt<=time||(!value.admin&&value.issuerId!==value.ownerId))return null;
    return value;
   }catch{return null;}
  }
 };
}
