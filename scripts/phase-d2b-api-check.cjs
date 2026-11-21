// Synthetic loopback fixture only. Never reads application .env or MongoDB.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const evidence=path.resolve(__dirname,'../reports/phase-d2b-evidence');
const runtime=JSON.parse(fs.readFileSync(path.join(evidence,'browser-after/preview-runtime.json')));
assert.equal(runtime.isolated,true);assert.equal(runtime.originalDatabaseUsed,false);assert.equal(runtime.port,5064);
const base='http://127.0.0.1:5064/api';
async function call(url,token,method='GET',body){const r=await fetch(base+url,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
async function login(email){const r=await call('/suppliers/login',null,'POST',{email,password:'D2B-LocalOnly123!'});assert.equal(r.status,200);assert(r.data.token);return r.data.token;}
async function main(){
 const buyer=await login('buyer@d2b.test'),other=await login('buyer2@d2b.test'),supplier=await login('supplier@d2b.test');
 const result={synthetic:true,originalDatabaseUsed:false,cases:{}};
 for(const key of ['accept','reject','recover','accepted']){
  const c=runtime.cases[key],r=await call('/rfq/'+c.id+'/thread',buyer);assert.equal(r.status,200);
  const q=r.data.rfq,action=key==='reject'?'reject':'accept';assert.equal(q.status,key==='reject'?'rejected':'accepted');assert.equal(q.decision.phase,'completed');
  if(action==='accept'){assert.equal(q.decision.agreement.product.name,c.name);assert.equal(q.decision.agreement.unit,'صندوق / carton');assert.equal(q.decision.agreement.currency,'MAD');assert.equal(q.decision.agreement.quantity,20);assert.equal(q.decision.agreement.totalPrice,380);}
  const before=JSON.stringify(q.decision.agreement);
  const retry=await call('/rfq/'+c.id+'/action',buyer,'PUT',{action,offerId:c.offerId});assert.equal(retry.status,200);assert.equal(JSON.stringify(retry.data.rfq.decision.agreement),before);
  const conflict=await call('/rfq/'+c.id+'/action',buyer,'PUT',{action:action==='accept'?'reject':'accept',offerId:c.offerId});assert.equal(conflict.status,409);
  const foreign=await call('/rfq/'+c.id+'/thread',other);assert.equal(foreign.status,403);
  const closed=await call('/rfq/'+c.id+'/messages',buyer,'POST',{content:'must be refused'});assert.equal(closed.status,409);
  result.cases[key]={status:q.status,phase:q.decision.phase,retry:retry.status,conflict:conflict.status,foreign:foreign.status,closedMessage:closed.status,frozenAgreementUnchanged:true};
 }
 const denied=await call('/rfq/'+runtime.cases.foreign.id,buyer);assert.equal(denied.status,403);result.foreignNotificationTarget=denied.status;
 const unauthenticated=await call('/rfq/'+runtime.cases.accept.id+'/thread');assert.equal(unauthenticated.status,401);result.guestThread=unauthenticated.status;
 const created=await call('/rfq',buyer,'POST',{productId:runtime.productId,quantity:20,buyerPhone:'+212600000001',buyerCity:'الرباط',notes:'D2B superseded probe'});assert.equal(created.status,201);
 const id=created.data.rfq._id;
 const first=await call('/rfq/'+id+'/respond',supplier,'PUT',{unitPrice:30,deliveryDays:3,paymentTerms:'test only'});assert.equal(first.status,200);
 const second=await call('/rfq/'+id+'/respond',supplier,'PUT',{unitPrice:29,deliveryDays:4,paymentTerms:'new test only'});assert.equal(second.status,200);
 const stale=await call('/rfq/'+id+'/action',buyer,'PUT',{action:'accept',offerId:first.data.offer._id});assert.equal(stale.status,409);
 const current=await call('/rfq/'+id+'/thread',buyer);assert.equal(current.data.rfq.status,'responded');assert.equal(current.data.rfq.currentOfferId,second.data.offer._id);
 result.superseded={status:stale.status,requestStillResponded:true,currentOfferPreserved:true};
 fs.writeFileSync(path.join(evidence,'api-verification.json'),JSON.stringify(result,null,2));console.log('D2B independent HTTP verification passed');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
