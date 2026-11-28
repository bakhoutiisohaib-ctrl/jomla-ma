const mongoose=require('mongoose')
const Review=require('../models/Review')
const Supplier=require('../models/Supplier')
const Store=require('../models/Store')
const {historicalEvidenceBatch}=require('./tradeConfirmation')
// Explicit local acceptance limits; do not truncate or return unfiltered results.
const POLICY=Object.freeze({minimumReviews:3,minimumAverage:4.5,maxSuppliers:1000,maxReviews:10000,batchSize:64,budgetMs:8000})
const unavailable=()=>Object.assign(Error('Supplier rating filter temporarily unavailable'),{status:503})
let active=0
async function ratedSupplierIds(scope={}){
 if(active>=2)throw unavailable()
 active++
 const deadline=Date.now()+POLICY.budgetMs
 const check=()=>{if(Date.now()>deadline)throw unavailable()}
 try{
  const stores=await Store.aggregate([{$match:{isActive:true,reviewStatus:'approved',adminSuspended:{$ne:true},...(scope.supplierId?{supplierId:new mongoose.Types.ObjectId(scope.supplierId)}:{})}},{$group:{_id:'$supplierId'}},{$limit:POLICY.maxSuppliers+1}]).read('primary').option({maxTimeMS:5000})
  check()
  if(stores.length>POLICY.maxSuppliers)throw unavailable()
  const owners=await Supplier.find({role:'supplier',isActive:{$ne:false},_id:{$in:stores.map(s=>s._id)},...(scope.businessType?{businessTypes:scope.businessType}:{})}).select('_id').read('primary').maxTimeMS(5000).lean()
  check()
  if(!owners.length)return []
  const totals=new Map()
  const cursor=Review.find({supplierId:{$in:owners.map(o=>o._id)},basis:'mutual_confirmation'}).select('supplierId buyerId basis stars date productId +tradeConfirmationId').limit(POLICY.maxReviews+1).read('primary').maxTimeMS(5000).lean().cursor()
  let batch=[],seen=0
  async function consume(){
   check()
   const good=batch.filter(r=>r.basis==='mutual_confirmation'&&Number.isInteger(r.stars)&&r.stars>=1&&r.stars<=5)
   const accepted=await historicalEvidenceBatch(good)
   check()
   good.forEach((r,i)=>{if(!accepted[i])return;const id=String(r.supplierId),t=totals.get(id)||{count:0,sum:0};t.count++;t.sum+=r.stars;totals.set(id,t)})
   batch=[]
  }
  for await(const r of cursor){check();if(++seen>POLICY.maxReviews)throw unavailable();batch.push(r);if(batch.length===POLICY.batchSize)await consume()}
  if(batch.length)await consume()
  return owners.filter(o=>{const t=totals.get(String(o._id));return t&&t.count>=POLICY.minimumReviews&&Number((t.sum/t.count).toFixed(1))>=POLICY.minimumAverage}).map(o=>o._id)
 }catch(e){if(e.status===503)throw e;throw unavailable()}finally{active--}
}
module.exports={ratedSupplierIds,POLICY}
