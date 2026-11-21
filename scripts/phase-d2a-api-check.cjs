// Independent checks against the loopback synthetic fixture; no original DB/env.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const base = 'http://127.0.0.1:5062/api', stage = process.argv[2];
assert(['draft','published'].includes(stage));
async function request(route, token='', body) {
  const response = await fetch(base+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return {status:response.status,data,cache:response.headers.get('cache-control')};
}
async function login(email) { const r=await request('/suppliers/login','',{email,password:'D2A-LocalOnly123!'});assert.equal(r.status,200);return r.data.token; }
(async()=>{
  const owner=await login('supplier@d2a.test'), other=await login('supplier2@d2a.test'), buyer=await login('buyer@d2a.test');
  const own=await request('/products/mine?limit=100',owner);assert.equal(own.status,200);
  const matches=own.data.data.filter(p=>p.name==='منتج مورد D2A — اختبار فقط');assert.equal(matches.length,1);
  const p=matches[0], profile=(await request('/suppliers/me/profile',owner)).data;
  assert.equal(p.isDraft,stage==='draft');assert.equal(p.images.length,1);assert.equal(p.price,30);assert.equal(p.moq,12);assert.equal(p.unit,'صندوق');assert.equal(p.currency,'MAD');assert.equal(p.priceTiers.length,2);
  assert.notEqual(profile.isVerified,true);assert.notEqual(profile.verificationStatus,'verified');
  const media=[];
  for(const ref of [p.imageUrl,...p.images]) {
    const route='/media/'+path.basename(ref);
    const statuses={owner:(await request(route,owner)).status,other:(await request(route,other)).status,buyer:(await request(route,buyer)).status,visitor:(await request(route)).status};
    assert.equal(statuses.owner,200);
    if(stage==='draft') {assert([401,403,404].includes(statuses.other));assert([401,403,404].includes(statuses.buyer));assert.equal(statuses.visitor,401);}
    else for(const code of Object.values(statuses)) assert.equal(code,200);
    media.push({ref,statuses});
  }
  const publicProduct=await request('/products/'+p._id);assert.equal(publicProduct.status,stage==='draft'?404:200);
  const privateDraft=own.data.data.find(p=>p.name==='D2A_PRIVATE_DRAFT');
  assert.equal((await request('/products/'+privateDraft._id)).status,404);
  assert.equal((await request('/media/'+path.basename(privateDraft.imageUrl))).status,401);
  const result={stage,synthetic:true,originalDatabaseUsed:false,readOnlyExceptSyntheticLogin:true,uniqueProduct:true,productId:p._id,product:p,optionalVerificationNotRequired:{isVerified:profile.isVerified,verificationStatus:profile.verificationStatus},media,publicProductStatus:publicProduct.status,baselineDraftStillPrivate:true};
  fs.writeFileSync(path.resolve(__dirname,'../reports/phase-d2a-evidence/api-'+stage+'.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({stage,passed:true,images:media.length,publicProductStatus:publicProduct.status}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
