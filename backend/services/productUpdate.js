const crypto = require('crypto')
const Product = require('../models/Product')
const { publicProduct, canonical, productInput } = require('./productCreation')

const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
const stale = () => fail(409,'PRODUCT_EDIT_STALE','تغير المنتج منذ فتحه؛ راجع النسخة الحالية قبل التعديل')
const conflict = () => fail(409,'PRODUCT_EDIT_CONFLICT','معرف محاولة التعديل مرتبط ببيانات أخرى')
const retry = () => fail(503,'PRODUCT_EDIT_RETRY','لم يتأكد تحديث المنتج؛ استكمل نفس المحاولة')
const keyPattern = /^[A-Za-z0-9_-]{16,128}$/
const revisionPattern = /^(0|[1-9][0-9]{0,14})$/
const ownerFilter = req => ({ _id: req.params.id, supplierId: req.supplier.ownerId || req.supplier.id })
const load = req => Product.findOne(ownerFilter(req)).select('+updateReceipt').read('primary').maxTimeMS(5000)
const notFound = () => fail(404,'PRODUCT_EDIT_MISSING','المنتج غير موجود')
const fields = ['name','category','taxonomyPath','pricingMode','price','currency','country','moq','unit','priceTiers','availability','availabilityConfirmed','inStock','city','description','images','imageUrl','isDraft','storeId','organizationId','supplierPhone','hasImageRights','imageRights','approvedBy','approvedAt']
function identity(req,required=false){
  const key=req.get('Idempotency-Key'), raw=req.get('X-Product-Revision')
  if(key===undefined&&raw===undefined&&!required)return null
  if(!keyPattern.test(key||'')||!revisionPattern.test(raw||'')||!Number.isSafeInteger(Number(raw)))throw fail(400,'PRODUCT_EDIT_KEY','معرف محاولة التعديل أو رقم المراجعة غير صالح')
  return {key,baseRevision:Number(raw),actorId:req.supplier.id,organizationId:req.supplier.organizationId||null}
}
function revision(product){
  const value=product.editRevision
  if(!Number.isSafeInteger(value)||value<0||value>=999999999999999)throw retry()
  return value
}
function matches(receipt,a){
  return receipt?.key===a.key&&receipt.baseRevision===a.baseRevision&&String(receipt.actorId)===String(a.actorId)&&String(receipt.organizationId||'')===String(a.organizationId||'')
}
function verifyReplay(product,a){
  const receipt=product.updateReceipt
  if(!matches(receipt,a)){
    if(receipt?.key===a.key&&receipt.baseRevision===a.baseRevision)throw conflict()
    return false
  }
  if(receipt.hash!==a.hash||receipt.version!==1||revision(product)!==a.baseRevision+1)throw conflict()
  return true
}
function revisionFence(base){
  return base===0?{$or:[{editRevision:0},{editRevision:{$exists:false}}]}:{editRevision:base}
}
function exactValue(doc,field){
  const v=doc.get(field)
  return v===undefined?{$exists:false}:v
}
async function updateProductOnce(req,prepareProduct){
  const a=identity(req)
  if(a)a.hash=crypto.createHash('sha256').update(JSON.stringify(canonical({actorId:a.actorId,organizationId:a.organizationId,baseRevision:a.baseRevision,input:productInput(req.body)}))).digest('hex')
  let product=await load(req)
  if(!product)throw notFound()
  if(a&&verifyReplay(product,a))return {product,receipt:product.updateReceipt,replayed:true}
  const base=revision(product)
  if(a&&a.baseRevision!==base)throw stale()
  // Moderation can change independently of merchant edits; fence its exact
  // observed state, and never write moderation or tracking counters.
  const filter={...ownerFilter(req),...revisionFence(base),moderationStatus:exactValue(product,'moderationStatus'),moderatedAt:exactValue(product,'moderatedAt')}
  // Mongoose defaults are applied on hydration of old rows.
  if(product.$isDefault('moderationStatus'))filter.moderationStatus={$in:['visible',null]}
  await prepareProduct(product,req)
  const raw=product.toObject({transform:false,depopulate:true}),$set={editRevision:base+1,updatedAt:new Date()},$unset={}
  for(const field of fields){
    if(raw[field]===undefined)$unset[field]=1
    else $set[field]=raw[field]
  }
  if(a)$set.updateReceipt={...a,version:1}
  else $unset.updateReceipt=1
  let outcome
  try{
    outcome=await Product.updateOne(filter,{$set,...(Object.keys($unset).length?{$unset}:{})},{timestamps:false,writeConcern:{w:1,j:true},maxTimeMS:10000})
  }catch{
    if(!a)throw retry()
    const saved=await load(req)
    if(saved&&verifyReplay(saved,a))return {product:saved,receipt:saved.updateReceipt,replayed:true}
    throw retry()
  }
  const saved=await load(req)
  if(!saved)throw notFound()
  if(a&&verifyReplay(saved,a))return {product:saved,receipt:saved.updateReceipt,replayed:!outcome.modifiedCount}
  if(!a&&outcome.modifiedCount&&revision(saved)===base+1)return {product:saved,receipt:null,replayed:false}
  throw stale()
}
async function readEditState(req){
  const product=await load(req)
  if(!product)throw notFound()
  return {product:publicProduct(product)}
}
async function readUpdateAttempt(req){
  const a=identity(req,true),product=await load(req)
  if(!product)throw notFound()
  const currentRevision=revision(product),receipt=product.updateReceipt
  let phase='superseded'
  if(matches(receipt,a)&&receipt.version===1&&currentRevision===a.baseRevision+1)phase='saved'
  else if(receipt?.key===a.key&&receipt.baseRevision===a.baseRevision)throw conflict()
  else if(currentRevision===a.baseRevision)phase='absent'
  return {productId:String(product._id),actorId:req.supplier.id,baseRevision:a.baseRevision,currentRevision,phase,version:1}
}
module.exports={updateProductOnce,readEditState,readUpdateAttempt}
