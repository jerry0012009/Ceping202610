import assert from 'node:assert/strict';

// Tests that exercise other APIs still accept the real, current server notice
// through HTTP. There is intentionally no server bypass or direct DB grant.
export async function acceptCurrentNotice(base,cookie,origin=base){
 const headers={cookie,origin,connection:'close'};
 const me=await fetch(base+'/api/me',{headers});assert.equal(me.status,200);const {user}=await me.json();
 const noticeResponse=await fetch(base+'/api/consent',{headers});assert.equal(noticeResponse.status,200);const {notice}=await noticeResponse.json();
 const response=await fetch(base+'/api/consent',{method:'POST',headers:{...headers,'content-type':'application/json','X-Assessment-Owner':user.id},body:JSON.stringify({version:notice.version,accepted:true})});
 const result=await response.json();assert.ok([200,201].includes(response.status),JSON.stringify(result));return result.consent;
}
