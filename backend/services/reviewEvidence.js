const Review=require('../models/Review')
const {historicalEvidence}=require('./tradeConfirmation')
const {formatPaginationResponse}=require('../utils/constants')
const validStars=r=>Number.isInteger(r.stars)&&r.stars>=1&&r.stars<=5
const fields=['_id','productId','supplierId','userName','stars','comment','reply','date']
const projection=fields.join(' ')+' buyerId basis +tradeConfirmationId'
async function verified(r){
  return validStars(r)&&r.basis==='mutual_confirmation'&&await historicalEvidence(r)
}
function dto(r,confirmed){
  const out={}
  for(const f of fields)if(r[f]!==undefined)out[f]=r[f]
  if(confirmed)out.basis='mutual_confirmation'
  return out
}
async function classified(r){return dto(r,await verified(r))}
async function publicList(supplierId,page,limit,skip){
  // One streaming pass provides the same classification for every page and the average.
  // Fail closed rather than publishing an incomplete aggregate on an exhausted budget.
  const deadline=Date.now()+8000
  const cursor=Review.find({supplierId}).select(projection).sort({date:-1,_id:1})
    .read('primary').maxTimeMS(8000).lean().cursor()
  let total=0,count=0,sum=0
  const data=[]
  for await(const r of cursor){
    if(Date.now()>deadline)throw Object.assign(Error('Review verification temporarily unavailable'),{status:503})
    const confirmed=await verified(r)
    if(Date.now()>deadline)throw Object.assign(Error('Review verification temporarily unavailable'),{status:503})
    if(confirmed){count++;sum+=r.stars}
    if(total>=skip&&data.length<limit)data.push(dto(r,confirmed))
    total++
  }
  return {...formatPaginationResponse(data,total,page,limit),legacyTotal:total-count,
    stats:{avg:count?Number((sum/count).toFixed(1)):0,total:count}}
}
async function ownerList(supplierId,page,limit,skip){
  const filter={supplierId}
  const [rows,total]=await Promise.all([Review.find(filter).select(projection).sort({date:-1,_id:1}).skip(skip).limit(limit).lean(),Review.countDocuments(filter)])
  const data=[]
  for(const r of rows)data.push(await classified(r))
  return formatPaginationResponse(data,total,page,limit)
}
module.exports={publicList,ownerList,classified}
