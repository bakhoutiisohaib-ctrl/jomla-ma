const mongoose = require('mongoose')
const { createHash } = require('crypto')
const RFQ = require('../models/QuoteRequest')
const Offer = require('../models/QuoteOffer')
const Thread = require('../models/MessageThread')
const Sourcing = require('../models/SourcingRequest')
const Supplier = require('../models/Supplier')
const Confirmation = require('../models/TradeConfirmation')
const { agreementHash } = require('./commercialAgreement')
const { checkedReceipt } = require('./sourcingDecision')
const same = (a,b) => a != null && b != null && String(a) === String(b)
const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const fail = (status,message) => Object.assign(new Error(message),{status})
const invalid = () => fail(409,'لا يوجد اتفاق مقبول ومثبت لهذه المعاملة')
const write = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000, runValidators: true }
const ownKey = actor => actor.role === 'buyer' ? 'buyerId' : 'supplierId'
const identityKeys = ['kind','sourceId','offerId','decisionId','buyerId','supplierId','decisionHash']
const matches = (row,identity) => row && identityKeys.every(k=>same(row[k],identity[k])) &&
  (identity.productId ? same(row.productId,identity.productId) : !row.productId)
function key(kind,sourceId,offerId) {
  return new mongoose.Types.ObjectId(createHash('sha256').update([kind,sourceId,offerId].join(':')).digest('hex').slice(0,24))
}
async function resolve(kind,sourceId,offerId,actor,{historical=false}={}) {
  if (!['rfq','sourcing'].includes(kind) || !validId(sourceId) || !validId(offerId)) throw fail(400,'مرجع المعاملة غير صحيح')
  const scope = { _id: sourceId, [ownKey(actor)]: actor.id }
  let identity, title
  if (kind === 'rfq') {
    const r = await RFQ.findOne(scope).lean()
    if (!r) throw fail(404,'المعاملة غير متاحة')
    const d = r.decision, a = d?.agreement
    if (r.status !== 'accepted' || d?.version !== 1 || d.phase !== 'completed' || d.action !== 'accept' ||
      !same(d.offerId,offerId) || !same(r.currentOfferId,offerId) || d.actor?.role !== 'buyer' || !same(d.actor.id,r.buyerId) ||
      a?.version !== 1 || !same(a.rfqId,r._id) || !same(a.offerId,offerId) || !same(a.buyer?.id,r.buyerId) ||
      !same(a.supplier?.id,r.supplierId) || !same(a.product?.id,r.productId) || agreementHash(a) !== d.agreementHash) throw invalid()
    if (!await Offer.exists({_id:offerId,rfqId:r._id,supplierId:r.supplierId,status:'accepted',decisionId:d.id}) ||
        !await Thread.exists({rfqId:r._id,status:'closed',decisionId:d.id})) throw invalid()
    identity={kind,sourceId:r._id,offerId:d.offerId,decisionId:d.id,buyerId:r.buyerId,supplierId:r.supplierId,productId:r.productId,decisionHash:d.agreementHash}
    title=a.product.name
  } else {
    const s=await Sourcing.findOne(actor.role==='buyer'?scope:{_id:sourceId,'quotes.supplierId':actor.id}).lean()
    if(!s) throw fail(404,'المعاملة غير متاحة')
    const q=s.quotes?.find(q=>same(q._id,offerId) && (actor.role==='buyer'||same(q.supplierId,actor.id)))
    if(!q) throw fail(404,'المعاملة غير متاحة')
    if(s.operation || q.status!=='accepted' || q.decisionReceipt?.action!=='accept')throw invalid()
    checkedReceipt(s,q)
    identity={kind,sourceId:s._id,offerId:q._id,decisionId:q.decisionReceipt.id,buyerId:s.buyerId,supplierId:q.supplierId,decisionHash:q.decisionReceipt.hash}
    title=q.agreement.snapshot.request.productName
  }
  if(same(identity.buyerId,identity.supplierId))throw invalid()
  const active=historical?[]:await Promise.all(['buyer','supplier'].map(role=>Supplier.exists({_id:identity[role+'Id'],role,isActive:{$ne:false}})))
  if(active.some(x=>!x))throw fail(409,'أحد طرفي المعاملة غير متاح')
  return { identity, title, _id:key(kind,sourceId,offerId) }
}
function dto(trade,row,actor) {
  if(row&&!matches(row,trade.identity))throw invalid()
  const buyerConfirmed=Boolean(row?.buyerConfirmedAt),supplierConfirmed=Boolean(row?.supplierConfirmedAt)
  return {kind:trade.identity.kind,sourceId:String(trade.identity.sourceId),offerId:String(trade.identity.offerId),title:trade.title,
    supplierId:String(trade.identity.supplierId),buyerConfirmed,supplierConfirmed,
    ownConfirmed:actor.role==='buyer'?buyerConfirmed:supplierConfirmed,completed:buyerConfirmed&&supplierConfirmed}
}
async function confirm(kind,sourceId,offerId,actor) {
  const trade=await resolve(kind,sourceId,offerId,actor),field=actor.role+'ConfirmedAt'
  const filter={_id:trade._id,...trade.identity,...(!trade.identity.productId?{productId:{$exists:false}}:{})}
  try {
    await Confirmation.updateOne(filter,{$setOnInsert:{...trade.identity},$min:{[field]:new Date()}},{...write,upsert:true,setDefaultsOnInsert:false})
  } catch(error) {
    if(error.code===11000) await Confirmation.updateOne(filter,{$min:{[field]:new Date()}},write)
    else {
      const saved=await Confirmation.findById(trade._id).read('primary').lean()
      if(!matches(saved,trade.identity)||!saved[field])throw error
    }
  }
  const saved=await Confirmation.findById(trade._id).read('primary').lean()
  if(!matches(saved,trade.identity)||!saved[field])throw invalid()
  return dto(trade,saved,actor)
}
async function list(actor,kind,page,limit) {
  if(!['rfq','sourcing'].includes(kind))throw fail(400,'نوع المعاملة غير صحيح')
  const filter=kind==='rfq'?{[ownKey(actor)]:actor.id,status:'accepted','decision.phase':'completed','decision.version':1,'decision.action':'accept'}:
    {status:'fulfilled',operation:{$exists:false},...(actor.role==='buyer'?{buyerId:actor.id}:{quotes:{$elemMatch:{supplierId:actor.id,status:'accepted','decisionReceipt.action':'accept'}}})}
  const Model=kind==='rfq'?RFQ:Sourcing
  const rows=await Model.find(filter).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit+1).lean()
  const data=[]
  let unavailable=0
  for(const r of rows.slice(0,limit)){
    const offerId=kind==='rfq'?r.decision?.offerId:r.quotes?.find(q=>q.status==='accepted'&&(actor.role==='buyer'||same(q.supplierId,actor.id)))?._id
    try{
      const t=await resolve(kind,String(r._id),String(offerId),actor)
      data.push(dto(t,await Confirmation.findById(t._id).lean(),actor))
    }catch(error){if(![404,409].includes(error.status))throw error;unavailable++}
  }
  return {actorId:actor.id,role:actor.role,kind,page,data,unavailable,hasNext:rows.length>limit}
}
async function eligible(buyerId,supplierId,productId) {
  // Dates alone are not proof of a valid, scoped accepted agreement. Reuse the
  // same receipt checks as confirmation; never repair or delete historical rows here.
  const candidates=Confirmation.find({buyerId,supplierId,buyerConfirmedAt:{$type:'date'},supplierConfirmedAt:{$type:'date'},...(productId?{productId}:{})})
    .read('primary').maxTimeMS(10000).lean().cursor()
  for await (const row of candidates) {
    if(!['rfq','sourcing'].includes(row.kind)||!validId(String(row.sourceId))||!validId(String(row.offerId))||
      !same(row.buyerId,buyerId)||!same(row.supplierId,supplierId)||!same(row._id,key(row.kind,String(row.sourceId),String(row.offerId)))||
      (productId&&!same(row.productId,productId)))continue
    let trade
    try {
      trade=await resolve(row.kind,String(row.sourceId),String(row.offerId),{role:'buyer',id:String(buyerId)})
    } catch(error) {
      if([404,409].includes(error.status))continue
      throw error
    }
    if(matches(row,trade.identity))return {_id:row._id}
  }
  return null
}
async function historicalEvidence(review){
  const {buyerId,supplierId,productId,tradeConfirmationId,date}=review
  if(![buyerId,supplierId,tradeConfirmationId].every(v=>v instanceof mongoose.Types.ObjectId)||
    (productId!=null&&!(productId instanceof mongoose.Types.ObjectId))||!(date instanceof Date)||!Number.isFinite(date.getTime()))return false
  const row=await Confirmation.findOne({_id:tradeConfirmationId,buyerId,supplierId,buyerConfirmedAt:{$type:'date',$lte:date},supplierConfirmedAt:{$type:'date',$lte:date},...(productId?{productId}:{})}).read('primary').maxTimeMS(8000).lean()
  if(!row||!['rfq','sourcing'].includes(row.kind)||!validId(String(row.sourceId))||!validId(String(row.offerId))||!same(row._id,key(row.kind,String(row.sourceId),String(row.offerId))))return false
  try{
    const trade=await resolve(row.kind,String(row.sourceId),String(row.offerId),{role:'buyer',id:String(buyerId)},{historical:true})
    return matches(row,trade.identity)
  }catch(error){if([404,409].includes(error.status))return false;throw error}
}
module.exports={confirm,list,eligible,resolve,matches,historicalEvidence}
