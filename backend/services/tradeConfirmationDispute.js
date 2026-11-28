const crypto=require('crypto')
const mongoose=require('mongoose')
const Report=require('../models/Report')
const AuditLog=require('../models/AuditLog')
const Confirmation=require('../models/TradeConfirmation')
const {resolve,matches}=require('./tradeConfirmation')
const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b)
const fail=(status,message)=>Object.assign(new Error(message),{status})
const conflict=()=>fail(409,'Dispute identity or details conflict')
const unconfirmed=()=>fail(503,'Dispute submission audit unconfirmed; retry the same details')
const write={writeConcern:{w:1,j:true},maxTimeMS:10000,runValidators:true}
const idFor=(...parts)=>new mongoose.Types.ObjectId(crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0,24))
async function scope(kind,sourceId,offerId,actor){
  const trade=await resolve(kind,sourceId,offerId,actor)
  const id=idFor('trade-dispute-v1',trade._id,actor.id)
  return {trade,id,actor,context:{kind,sourceId:trade.identity.sourceId,offerId:trade.identity.offerId,role:actor.role}}
}
function checked(s,row){
  const c=row?.tradeDispute
  if(!row||!same(row._id,s.id)||row.targetType!=='trade_confirmation'||!same(row.targetId,s.trade._id)||
    !same(row.reporterId,s.actor.id)||row.reason!=='confirmation_dispute'||c?.kind!==s.context.kind||
    !same(c.sourceId,s.context.sourceId)||!same(c.offerId,s.context.offerId)||c.role!==s.actor.role||
    typeof row.details!=='string'||!['pending','investigating','resolved','dismissed'].includes(row.status))throw conflict()
  return row
}
function receipt(s,row){
  return {actorId:s.actor.id,role:s.actor.role,kind:s.context.kind,sourceId:String(s.context.sourceId),offerId:String(s.context.offerId),
    dispute:row?{_id:String(row._id),status:row.status}:null}
}
async function find(s){const row=await Report.findById(s.id).read('primary').lean();return row?checked(s,row):null}
async function ensureAudit(s,row){
  const id=idFor('trade-dispute-audit-v1',row._id)
  const event={action:'REPORT_SUBMITTED',targetType:'Report',targetId:row._id,performedBy:{id:s.actor.id,role:s.actor.role},
    details:{targetType:row.targetType,targetId:row.targetId,reason:row.reason},phase:'completed',createdAt:row.createdAt,completedAt:new Date()}
  try{await AuditLog.updateOne({_id:id},{$setOnInsert:event},{...write,upsert:true,setDefaultsOnInsert:false})}catch(error){
    if(!await AuditLog.exists({_id:id}).read('primary'))throw unconfirmed()
  }
  await verifyAudit(s,row)
}
async function verifyAudit(s,row){
  const id=idFor('trade-dispute-audit-v1',row._id)
  const a=await AuditLog.findById(id).read('primary').lean()
  if(!a)throw unconfirmed()
  if(a.action!=='REPORT_SUBMITTED'||a.targetType!=='Report'||!same(a.targetId,row._id)||!same(a.performedBy?.id,s.actor.id)||
    a.performedBy.role!==s.actor.role||a.phase!=='completed'||a.details?.targetType!==row.targetType||
    !same(a.details.targetId,row.targetId)||a.details.reason!==row.reason)throw conflict()
}
async function get(kind,sourceId,offerId,actor){
  const s=await scope(kind,sourceId,offerId,actor),row=await find(s)
  if(row)await verifyAudit(s,row)
  return receipt(s,row)
}
async function submit(kind,sourceId,offerId,actor,details){
  const s=await scope(kind,sourceId,offerId,actor)
  let row=await find(s),replayed=Boolean(row)
  if(!row){
    const c=await Confirmation.findById(s.trade._id).read('primary').lean()
    const own=actor.role+'ConfirmedAt',other=(actor.role==='buyer'?'supplier':'buyer')+'ConfirmedAt'
    if(!matches(c,s.trade.identity)||!(c[own] instanceof Date)||c[other])throw fail(409,'Dispute requires your own confirmation and an outstanding counterparty confirmation')
    const record={reporterId:actor.id,reporterName:actor.name,targetType:'trade_confirmation',targetId:s.trade._id,
      targetName:s.trade.title,reason:'confirmation_dispute',details,tradeDispute:s.context,status:'pending',createdAt:new Date()}
    try{
      const result=await Report.updateOne({_id:s.id},{$setOnInsert:record},{...write,upsert:true})
      replayed=!result.upsertedCount
    }catch(error){
      row=await find(s)
      if(!row)throw error
      replayed=true
    }
    row=await find(s)
  }
  checked(s,row)
  if(row.details!==details)throw conflict()
  await ensureAudit(s,row)
  return {...receipt(s,row),replayed}
}
async function requireSubmitted(row){
  if(row.targetType!=='trade_confirmation'||row.reason!=='confirmation_dispute'||!row.reporterId||!['buyer','supplier'].includes(row.tradeDispute?.role)||!same(row._id,idFor('trade-dispute-v1',row.targetId,row.reporterId)))throw conflict()
  await verifyAudit({actor:{id:row.reporterId,role:row.tradeDispute.role}},row)
}
module.exports={get,submit,requireSubmitted}
