const mongoose=require('mongoose')
const RFQ=require('../models/QuoteRequest')
const Offer=require('../models/QuoteOffer')
const Supplier=require('../models/Supplier')
const Store=require('../models/Store')
const DAY=86400000
const POLICY=Object.freeze({days:30,hours:24,minimumBuyers:3,minimumPercent:80,maxSuppliers:1000,maxRequests:10000,batchSize:64,budgetMs:8000})
const unavailable=()=>Object.assign(Error('Supplier response filter temporarily unavailable'),{status:503})
const oid=v=>v instanceof mongoose.Types.ObjectId
const same=(a,b)=>oid(a)&&oid(b)&&String(a)===String(b)
const date=v=>v instanceof Date&&Number.isFinite(v.getTime())
let active=0
// Stamp only the first completed commercial action in the existing terminal CAS.
function firstResponse(rfq,j,kind,refId,at){
 return rfq.responseMetricVersion===1&&j.previousStatus==='pending'&&!j.previousOfferId&&rfq.firstCommercialResponse===undefined
  ? {firstCommercialResponse:{kind,refId,at}} : {}
}
async function fastSupplierIds(scope={}){
 if(active>=2)throw unavailable()
 active++
 const now=Date.now(),deadline=now+POLICY.budgetMs,earliest=new Date(now-POLICY.days*DAY),latest=new Date(now-DAY)
 const check=()=>{if(Date.now()>deadline)throw unavailable()}
 try{
  const stores=await Store.aggregate([{$match:{isActive:true,reviewStatus:'approved',adminSuspended:{$ne:true},...(scope.supplierId?{supplierId:new mongoose.Types.ObjectId(scope.supplierId)}:{})}},{$group:{_id:'$supplierId'}},{$limit:POLICY.maxSuppliers+1}]).read('primary').option({maxTimeMS:5000})
  check();if(stores.length>POLICY.maxSuppliers)throw unavailable()
  const owners=await Supplier.find({role:'supplier',isActive:{$ne:false},_id:{$in:stores.map(s=>s._id)},...(scope.businessType?{businessTypes:scope.businessType}:{})}).select('_id').read('primary').maxTimeMS(5000).lean()
  check();if(!owners.length)return []
  const cursor=RFQ.find({supplierId:{$in:owners.map(o=>o._id)},responseMetricVersion:1,'creation.version':1,'creation.phase':'completed','creation.completedAt':{$gte:earliest,$lte:latest}})
   .select('supplierId buyerId createdAt status +responseMetricVersion +creation +firstCommercialResponse +supplierRejection')
   .sort({'creation.completedAt':1,_id:1}).limit(POLICY.maxRequests+1).read('primary').maxTimeMS(5000).lean().cursor()
  const totals=new Map(),buyers=new Set()
  let batch=[],seen=0
  async function consume(){
   check()
   const refs=batch.filter(r=>r.firstCommercialResponse?.kind==='offer'&&oid(r.firstCommercialResponse.refId)).map(r=>r.firstCommercialResponse.refId)
   const offers=refs.length?await Offer.find({_id:{$in:refs}}).select('rfqId supplierId status createdAt +submission').read('primary').maxTimeMS(5000).lean():[]
   check()
   const map=new Map(offers.map(o=>[String(o._id),o]))
   for(const r of batch){
    if(!oid(r.supplierId)||!oid(r.buyerId)||same(r.supplierId,r.buyerId)||!date(r.createdAt)||!date(r.creation?.completedAt)||r.createdAt>r.creation.completedAt||r.responseMetricVersion!==1||r.creation.version!==1||r.creation.phase!=='completed')continue
    const id=String(r.supplierId),key=id+':'+r.buyerId
    if(buyers.has(key))continue
    buyers.add(key)
    const t=totals.get(id)||{count:0,fast:0};t.count++;totals.set(id,t)
    const p=r.firstCommercialResponse,start=r.creation.completedAt
    if(!p||!oid(p.refId)||!date(p.at)||p.at<start||p.at>now||p.at-start>DAY)continue
    if(p.kind==='offer'){
     const o=map.get(String(p.refId))
     if(o&&same(o.rfqId,r._id)&&same(o.supplierId,r.supplierId)&&o.submission?.version===1&&o.submission.phase==='completed'&&['active','accepted','rejected','expired','superseded'].includes(o.status)&&date(o.createdAt)&&o.createdAt>=start&&o.createdAt<=p.at)t.fast++
    }else if(p.kind==='refusal'){
     const j=r.supplierRejection
     if(r.status==='rejected'&&j?.kind==='supplier_rejection'&&j.version===1&&j.phase==='completed'&&j.previousStatus==='pending'&&!j.previousOfferId&&same(j.id,p.refId)&&same(j.rfqId,r._id)&&same(j.supplierId,r.supplierId)&&same(j.buyerId,r.buyerId)&&same(j.actor?.ownerId,r.supplierId)&&date(j.completedAt)&&+j.completedAt===+p.at)t.fast++
    }
   }
   batch=[]
  }
  for await(const r of cursor){check();if(++seen>POLICY.maxRequests)throw unavailable();batch.push(r);if(batch.length===POLICY.batchSize)await consume()}
  if(batch.length)await consume()
  return owners.filter(o=>{const t=totals.get(String(o._id));return t&&t.count>=POLICY.minimumBuyers&&100*t.fast>=POLICY.minimumPercent*t.count}).map(o=>o._id)
 }catch(e){if(e.status===503)throw e;throw unavailable()}finally{active--}
}
module.exports={firstResponse,fastSupplierIds,POLICY}
