const mongoose = require('mongoose')
const { createHash } = require('crypto')
const Conversation = require('../models/DirectConversation')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const { publicCatalogFilter } = require('../utils/catalog')
const fail = (status, message) => Object.assign(Error(message), { status })
const validId = v => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v)
const oid = v => v instanceof mongoose.Types.ObjectId
const unavailable = () => fail(503, 'Conversation temporarily unavailable')
const notFound = () => fail(404, 'Conversation unavailable')
const threadId = (buyer, supplier, product) => createHash('sha256').update(['direct-conversation-v1', buyer, supplier, product].join(':')).digest('hex').slice(0,24)
const own = actor => actor.role === 'buyer' ? 'buyerId' : 'supplierId'
const scope = actor => ({ [own(actor)]: actor.id })
const validName = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 160
const validDate = d => d instanceof Date && Number.isFinite(d.getTime())
const validClientId = s => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s)

function parse(body, initial=false) {
  const allowed = initial ? ['productId','clientId','content'] : ['clientId','content']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!allowed.includes(k)) ||
      !validClientId(body.clientId) || typeof body.content !== 'string' ||
      !body.content.trim() || body.content.trim().length > 2000 ||
      (initial && !validId(body.productId))) throw fail(400,'Invalid conversation message')
  return { clientId: body.clientId, content: body.content.trim(), ...(initial?{productId:body.productId}:{}) }
}
function identity(row, actor) {
  return row && [row._id,row.buyerId,row.supplierId,row.productId].every(oid) &&
    String(row.buyerId)!==String(row.supplierId) && String(row[own(actor)])===actor.id &&
    String(row._id)===threadId(row.buyerId,row.supplierId,row.productId) &&
    [row.productName,row.buyerName,row.supplierName].every(validName) && validDate(row.lastMessageAt)
}
function summary(row, actor) {
  if(!identity(row,actor))throw unavailable()
  return { _id:String(row._id),productId:String(row.productId),productName:row.productName,
    counterpartName:actor.role==='buyer'?row.supplierName:row.buyerName,lastMessageAt:row.lastMessageAt }
}
function messages(row) {
  if(!Array.isArray(row.messages)||row.messages.length<1||row.messages.length>200)throw unavailable()
  const keys=new Set()
  return row.messages.map(m=>{
    const key=m.role+':'+m.clientId
    if(!['buyer','supplier'].includes(m.role)||!validClientId(m.clientId)||typeof m.content!=='string'||!m.content.trim()||m.content.length>2000||!validDate(m.sentAt)||keys.has(key))throw unavailable()
    keys.add(key)
    return {clientId:m.clientId,role:m.role,content:m.content,sentAt:m.sentAt}
  })
}
const load = (id, actor) => Conversation.findOne({_id:id,...scope(actor)}).read('primary').maxTimeMS(5000).lean()
async function visibleProduct(productId,supplierId) {
  const filter=await publicCatalogFilter(supplierId?{supplierId}:{})
  return Product.findOne({$and:[filter,{_id:productId}]}).select('name supplierId').read('primary').maxTimeMS(5000).lean()
}
async function canSend(row) {
  const [product,buyer]=await Promise.all([visibleProduct(row.productId,row.supplierId),
    Supplier.exists({_id:row.buyerId,role:'buyer',isActive:{$ne:false}}).read('primary').maxTimeMS(5000)])
  return !!(product&&buyer)
}
const envelope = actor => ({actorId:actor.id,role:actor.role})
async function detail(id,actor) {
  if(!validId(id))throw notFound()
  const row=await load(id,actor)
  if(!identity(row,actor))throw notFound()
  const data=messages(row)
  return {...envelope(actor),conversation:summary(row,actor),messages:data,canSend:data.length<200&&await canSend(row)}
}
async function list(actor,query) {
  if(Object.keys(query).some(k=>!['page'].includes(k)) || (query.page!==undefined && (typeof query.page!=='string'||!/^\d{1,4}$/.test(query.page)||Number(query.page)<1||Number(query.page)>1000)))throw fail(400,'Invalid conversation page')
  const page=Number(query.page||1),limit=20
  const rows=await Conversation.find(scope(actor)).select('-messages').sort({lastMessageAt:-1,_id:-1}).skip((page-1)*limit).limit(limit+1).read('primary').maxTimeMS(5000).lean()
  return {...envelope(actor),page,data:rows.slice(0,limit).map(r=>summary(r,actor)),hasNext:rows.length>limit}
}
function replay(row,actor,input) {
  const m=messages(row).find(m=>m.role===actor.role&&m.clientId===input.clientId)
  if(!m)return null
  if(m.content!==input.content)throw fail(409,'Message key already used with different content')
  return m
}
function receipt(row,actor,message,replayed) {
  return {...envelope(actor),conversation:summary(row,actor),message,replayed}
}
async function append(id,actor,input) {
  let row=await load(id,actor)
  if(!identity(row,actor))throw notFound()
  const prior=replay(row,actor,input)
  if(prior)return receipt(row,actor,prior,true)
  if(!await canSend(row))throw fail(409,'Conversation is read-only')
  const message={clientId:input.clientId,content:input.content,role:actor.role,sentAt:new Date()}
  let result
  try{
    result=await Conversation.updateOne({_id:id,...scope(actor),buyerId:row.buyerId,supplierId:row.supplierId,productId:row.productId,
      'messages.199':{$exists:false},messages:{$not:{$elemMatch:{role:actor.role,clientId:input.clientId}}}},
      {$push:{messages:message},$max:{lastMessageAt:message.sentAt}},{writeConcern:{w:1,j:true},runValidators:true})
  }catch{throw unavailable()}
  row=await load(id,actor)
  if(!identity(row,actor))throw unavailable()
  const saved=replay(row,actor,input)
  if(saved)return receipt(row,actor,saved,!result.modifiedCount)
  if(messages(row).length>=200)throw fail(409,'Conversation message limit reached')
  throw unavailable()
}
async function start(actor,input) {
  const candidate=await Product.findById(input.productId).select('supplierId').read('primary').maxTimeMS(5000).lean()
  if(!candidate||!oid(candidate.supplierId))throw notFound()
  const id=threadId(actor.id,candidate.supplierId,candidate._id)
  const existing=await load(id,actor)
  if(existing)return append(id,actor,input)
  const product=await visibleProduct(input.productId,candidate.supplierId)
  if(!product)throw notFound()
  const supplier=await Supplier.findOne({_id:product.supplierId,role:'supplier',isActive:{$ne:false}}).select('name').read('primary').maxTimeMS(5000).lean()
  if(!supplier||String(supplier._id)===actor.id||![actor.name,supplier.name,product.name].every(validName))throw notFound()
  const now=new Date(),message={clientId:input.clientId,role:'buyer',content:input.content,sentAt:now}
  try{
    await new Conversation({_id:id,buyerId:actor.id,supplierId:supplier._id,productId:product._id,productName:product.name,
      buyerName:actor.name,supplierName:supplier.name,messages:[message],createdAt:now,lastMessageAt:now}).save({w:1,j:true})
  }catch(e){if(e.code!==11000)throw unavailable();return append(id,actor,input)}
  const saved=await load(id,actor)
  if(!identity(saved,actor))throw unavailable()
  const stored=replay(saved,actor,input)
  if(!stored)throw unavailable()
  return receipt(saved,actor,stored,false)
}
module.exports={parse,detail,list,start,append,validId}
