const mongoose=require('mongoose')
const Supplier=require('../models/Supplier')
const Store=require('../models/Store')
const Audit=require('../models/AuditLog')
const WRITE={writeConcern:{w:1,j:true},maxTimeMS:10000,runValidators:true}
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const fail=(status,message)=>Object.assign(Error(message),{status})
const retry=()=>fail(503,'لم يتأكد استكمال التوثيق؛ أعد تحميل الحالة الحالية')
const conflict=()=>fail(409,'تغير ملف التوثيق؛ أعد تحميل الحالة الحالية')
const missing=()=>fail(404,'المورد غير موجود أو معطل')
const activePhases=['reserved','applied','cancelled']
const pending=r=>r&&activePhases.includes(r.phase)
const load=id=>Supplier.findOne({_id:id,role:'supplier'}).select('+verificationOperation').read('primary').maxTimeMS(5000)
const fence=rev=>rev===0?{$in:[0,null]}:rev
const approved=s=>s?.isVerified===true&&s.verificationStatus==='verified'
const revision=s=>s.verificationRevision??0
const stamp=s=>2*revision(s)+(['verified','rejected'].includes(s.verificationStatus)?1:0)
const actorData=a=>({id:a.id||a._id,name:a.name,email:a.email,role:a.role})
const inputFields=['iceNumber','tradeRegistry','verificationDoc']
const validRevision=r=>Number.isSafeInteger(r)&&r>=0&&r<Number.MAX_SAFE_INTEGER/2-2
function identity(s,r){
 return {_id:s._id,role:'supplier','verificationOperation.id':r.id,'verificationOperation.phase':r.phase}
}
function validate(s,r){
 if(!r||!mongoose.isValidObjectId(r.id)||!mongoose.isValidObjectId(r.actor?.id)||
 !validRevision(r.baseRevision)||!['submit','approve','reject'].includes(r.kind)||
 !['unverified','pending','verified','rejected'].includes(r.previousStatus)||
 !['reserved','applied','cancelled','completed','failed'].includes(r.phase)||
 (r.kind==='submit'?(r.actor.role!=='supplier'||!same(r.actor.id,s._id)||r.previousStatus==='pending'||!r.input||inputFields.some(k=>typeof r.input[k]!=='string'||r.input[k].length>(k==='verificationDoc'?2048:100))||(!r.input.iceNumber&&!r.input.tradeRegistry)):
 (r.actor.role!=='admin'||r.previousStatus!=='pending'||typeof r.reason!=='string'||r.reason.length>2000))||
 !(r.createdAt instanceof Date)||!Number.isFinite(r.createdAt.getTime()))throw retry()
 const nextRevision=r.baseRevision+(r.kind==='submit'?1:0)
 const nextStatus=r.kind==='submit'?'pending':r.kind==='approve'?'verified':'rejected'
 if(['reserved','cancelled','failed'].includes(r.phase)&&(revision(s)!==r.baseRevision||s.verificationStatus!==r.previousStatus))throw retry()
 if(['applied','completed'].includes(r.phase)&&(revision(s)!==nextRevision||s.verificationStatus!==nextStatus||s.isVerified!==(r.kind==='approve')||
 (r.kind==='submit'&&inputFields.some(k=>(s[k]||'')!==r.input[k]))||(r.kind==='reject'&&s.rejectionReason!==r.reason)))throw retry()
 return {nextRevision,nextStatus}
}
function eventFor(s,r){
 const {nextRevision,nextStatus}=validate(s,r)
 return {_id:r.id,action:r.kind==='submit'?'SUPPLIER_VERIFICATION_SUBMITTED':r.kind==='approve'?'SUPPLIER_VERIFIED':'SUPPLIER_REJECTED',
 targetType:'Supplier',targetId:s._id,performedBy:r.actor,createdAt:r.createdAt,
 details:{previousStatus:r.previousStatus,verificationRevision:nextRevision,newStatus:nextStatus,iceNumber:r.kind==='submit'?r.input.iceNumber:s.iceNumber,tradeRegistry:r.kind==='submit'?r.input.tradeRegistry:s.tradeRegistry,...(r.kind!=='submit'?{rejectionReason:r.kind==='reject'?r.reason:null}:{})}}
}
const auditFilter=e=>({_id:e._id,action:e.action,targetType:'Supplier',targetId:e.targetId,'performedBy.id':e.performedBy.id,'details.verificationRevision':e.details.verificationRevision,'details.newStatus':e.details.newStatus})
async function ensureIntent(e){
 const filter=auditFilter(e)
 try{await Audit.updateOne(filter,{$setOnInsert:{...e,phase:'pending'}},{...WRITE,upsert:true})}
 catch(err){if(!await Audit.exists(filter).read('primary'))throw err}
 const row=await Audit.findOne(filter).lean().read('primary').maxTimeMS(5000)
 if(!row||row.details.previousStatus!==e.details.previousStatus||row.details.iceNumber!==e.details.iceNumber||row.details.tradeRegistry!==e.details.tradeRegistry||row.details.rejectionReason!==e.details.rejectionReason)throw retry()
 return row
}
async function project(s,storeId){
 const mark=stamp(s)
 if(!Number.isSafeInteger(mark)||mark<0)throw retry()
 // The monotonic projection fence prevents a delayed old worker undoing a newer badge.
 const filter={supplierId:s._id,...(storeId?{_id:storeId}:{}),$or:[{verificationProjection:{$exists:false}},{verificationProjection:{$lte:mark}}]}
 await Store.updateMany(filter,{$set:{isVerified:approved(s),verificationProjection:mark}},WRITE)
}
async function advance(id,operationId){
 for(let i=0;i<8;i++){
  const s=await load(id),r=s?.verificationOperation
  if(!s||!same(r?.id,operationId))throw conflict()
  const {nextRevision,nextStatus}=validate(s,r),e=eventFor(s,r)
  if(r.phase==='completed')return {supplier:s,auditId:r.id}
  if(r.phase==='failed')throw missing()
  const audit=await ensureIntent(e)
  if(r.phase==='reserved'){
   if(audit.phase!=='pending')throw retry()
   const filter={...identity(s,r),verificationStatus:r.previousStatus,verificationRevision:fence(r.baseRevision)}
   const set={verificationStatus:nextStatus,verificationRevision:nextRevision,isVerified:r.kind==='approve',rejectionReason:r.kind==='reject'?r.reason:'',
     'verificationOperation.phase':'applied'}
   if(r.kind==='submit')Object.assign(set,r.input)
   if(r.kind==='approve')set.verifiedAt=r.createdAt
   await Supplier.updateOne({...filter,isActive:{$ne:false}},{$set:set,...(r.kind==='approve'?{}:{$unset:{verifiedAt:1}})},WRITE)
   // Cancellation only wins if the same reserved intent still exists.
   await Supplier.updateOne({...filter,isActive:false},{$set:{'verificationOperation.phase':'cancelled'}},WRITE)
   continue
  }
  const cancelled=r.phase==='cancelled',phase=cancelled?'failed':'completed'
  if(audit.phase!=='pending'&&audit.phase!==phase)throw retry()
  if(!cancelled)await project(s)
  if(audit.phase==='pending')await Audit.updateOne({...auditFilter(e),phase:'pending'},{$set:{phase,completedAt:new Date(),...(cancelled?{failure:'Supplier inactive before verification mutation'}:{})}},WRITE)
  if(!await Audit.exists({...auditFilter(e),phase}).read('primary'))throw retry()
  await Supplier.updateOne(identity(s,r),{$set:{'verificationOperation.phase':phase},$unset:{'verificationOperation.nextAttemptAt':1}},WRITE)
 }
 throw retry()
}
function matches(r,op){
 return r?.kind===op.kind&&r.baseRevision===op.baseRevision&&same(r.actor?.id,op.actor.id)&&
 (op.kind==='submit'?inputFields.every(k=>r.input?.[k]===op.input[k]):r.reason===op.reason)
}
async function execute(s,op){
 let current=await load(s._id)
 if(!current||current.isActive===false)throw missing()
 let r=current.verificationOperation
 if(pending(r)){
  if(!matches(r,op))throw conflict()
 }else{
  if(revision(current)!==op.baseRevision||current.verificationStatus!==op.previousStatus)throw conflict()
  const next={...op,id:new mongoose.Types.ObjectId(),phase:'reserved',createdAt:new Date(),attempts:0,nextAttemptAt:new Date()}
  const filter={_id:s._id,role:'supplier',isActive:{$ne:false},verificationStatus:op.previousStatus,verificationRevision:fence(op.baseRevision),'verificationOperation.phase':{$nin:activePhases}}
  let writeFailed=false
  try{await Supplier.updateOne(filter,{$set:{verificationOperation:next}},WRITE)}
  catch{writeFailed=true /* The reservation may have committed. Resolve via the primary. */}
  current=await load(s._id);r=current?.verificationOperation
  if(!matches(r,op)||!same(r?.id,next.id)){
   if(!pending(r)||!matches(r,op)){if(writeFailed&&current&&revision(current)===op.baseRevision&&current.verificationStatus===op.previousStatus&&!pending(r))throw retry();throw conflict()}
  }
 }
 try{return await advance(s._id,r.id)}
 catch(e){if(e.status===404||e.status===409)throw e;throw retry()}
}
async function submit(s,actor,input,expected){
 const fresh=await load(s._id)
 if(!fresh||fresh.isActive===false)throw missing()
 const r=fresh.verificationOperation,rev=revision(fresh),equal=inputFields.every(k=>input[k]===(fresh[k]||''))
 if(!validRevision(expected)||!validRevision(rev))throw conflict()
 if(pending(r)){
  if(r.kind!=='submit'||!same(r.actor.id,actor.id)||![r.baseRevision,r.baseRevision+1].includes(expected)||!inputFields.every(k=>input[k]===r.input[k]))throw conflict()
  try{return {...await advance(fresh._id,r.id),replayed:true}}catch(e){if(e.status===404||e.status===409)throw e;throw retry()}
 }
 if(equal&&['pending','verified'].includes(fresh.verificationStatus)&&(expected===rev||expected===rev-1))return {supplier:fresh,replayed:true}
 if(expected!==rev||fresh.verificationStatus==='pending')throw conflict()
 return execute(fresh,{kind:'submit',actor:actorData(actor),baseRevision:rev,previousStatus:fresh.verificationStatus,input})
}
async function decide(s,actor,action,expected,reason){
 if(!validRevision(expected))throw conflict()
 const fresh=await load(s._id)
 if(!fresh||fresh.isActive===false)throw missing()
 const r=fresh.verificationOperation
 const op={kind:action,actor:actorData(actor),baseRevision:expected,previousStatus:'pending',reason:action==='approve'?'':(reason?.trim()||'الوثائق لا تستوفي شروط التوثيق')}
 if(pending(r)){
  if(!matches(r,op))throw conflict()
  try{return await advance(fresh._id,r.id)}catch(e){if(e.status===404||e.status===409)throw e;throw retry()}
 }
 if(fresh.verificationStatus!=='pending'||revision(fresh)!==expected)throw conflict()
 return execute(fresh,op)
}
async function recoverPendingVerifications({limit=25,now=new Date(),onError}={}){
 const rows=await Supplier.find({role:'supplier','verificationOperation.phase':{$in:activePhases},'verificationOperation.attempts':{$lt:10},'verificationOperation.nextAttemptAt':{$lte:now}}).select('+verificationOperation').sort({'verificationOperation.nextAttemptAt':1,_id:1}).limit(Math.min(100,Math.max(1,limit))).lean().maxTimeMS(5000)
 const result={processed:rows.length,completed:0,pending:0}
 for(const s of rows){const r=s.verificationOperation
  try{await advance(s._id,r.id);result.completed++}
  catch{
   const fresh=await load(s._id)
   if(same(fresh?.verificationOperation?.id,r.id)&&pending(fresh.verificationOperation)){
    const next=new Date(now.getTime()+Math.min(60000,1000*2**Math.min(r.attempts||0,6)))
    await Supplier.updateOne({_id:s._id,'verificationOperation.id':r.id,'verificationOperation.phase':{$in:activePhases}},{$inc:{'verificationOperation.attempts':1},$set:{'verificationOperation.nextAttemptAt':next}},WRITE)
    result.pending++;onError?.({code:'VERIFICATION_RECOVERY_PENDING'})
   }else result.completed++
  }
 }
 return result
}
function createVerificationRecovery({pollMs=5000,onError}={}){
 let stopped=false,started=false,timer,running
 const runOnce=()=>stopped?Promise.resolve({processed:0,completed:0,pending:0}):(running||=recoverPendingVerifications({onError}).finally(()=>{running=null}))
 async function tick(){try{await runOnce()}catch{onError?.({code:'VERIFICATION_RECOVERY_UNAVAILABLE'})}if(!stopped){timer=setTimeout(tick,pollMs);timer.unref?.()}}
 return {runOnce,start(){if(!started&&!stopped){started=true;tick()}return this},async stop({graceMs=15000}={}){stopped=true;clearTimeout(timer);let timeout;try{await Promise.race([running||Promise.resolve(),new Promise(resolve=>{timeout=setTimeout(resolve,graceMs)})])}finally{clearTimeout(timeout)}}}
}
function safeSupplier(s){const out=s.toObject();delete out.verificationOperation;return out}
function storeDto(s,owner){const out=s.toObject?s.toObject():{...s};delete out.verificationProjection;return {...out,isVerified:approved(owner)}}
async function syncStore(s){
 // The store was already created. Do not turn a projection outage into an ambiguous creation failure.
 let owner
 try{owner=await load(s.supplierId);if(owner&&(s.verificationProjection!==stamp(owner)||s.isVerified!==approved(owner)))await project(owner,s._id);return {store:storeDto(s,owner)}}
 catch{return {store:storeDto(s,owner),verificationProjectionPending:true}}
}
module.exports={submit,decide,createVerificationRecovery,recoverPendingVerifications,safeSupplier,syncStore,storeDto,approved,stamp}
