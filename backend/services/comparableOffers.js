const mongoose=require('mongoose')
const Product=require('../models/Product')
const {publicCatalogFilter,parseOptions,badRequest}=require('../utils/catalog')
const {comparisonFamilies}=require('../utils/searchIntent')
const {comparisonQuote}=require('../utils/productPricing')
const MAX=5000
const FIELDS='name category taxonomyPath unit currency moq price priceTiers pricingMode city supplierId storeId imageUrl'
const fail=(status,message)=>Object.assign(new Error(message),{status})
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i])
const rank=p=>p.quote.kind==='fixed'&&p.quote.total!==null?0:p.quote.kind==='fixed'?1:p.quote.kind==='request'?2:p.quote.kind==='unknown'?3:4
async function comparableOffers(id,input={}){
  if(Object.keys(input).some(k=>!['quantity','page','limit'].includes(k)))throw badRequest('Invalid comparison filters')
  if(!/^[a-f0-9]{24}$/i.test(id))throw badRequest('Invalid product id')
  const options=parseOptions({...input,limit:input.limit??12})
  if(options.limit>50)throw badRequest('Comparison limit exceeds 50')
  const scope=await publicCatalogFilter()
  const oid=new mongoose.Types.ObjectId(id)
  const anchor=await Product.findOne({...scope,_id:oid}).select(FIELDS).lean().maxTimeMS(5000)
  if(!anchor)throw fail(404,'Product unavailable')
  const quantity=options.quantity??anchor.moq
  if(!Number.isSafeInteger(quantity)||quantity<1)throw badRequest('Invalid comparison quantity')
  if(typeof anchor.category!=='string'||!anchor.category.trim()||typeof anchor.unit!=='string'||!anchor.unit.trim()||!(/^[A-Z]{3}$/.test(anchor.currency||'')))throw fail(422,'Comparison context unavailable')
  const family=comparisonFamilies(anchor.name)
  let candidates=[anchor]
  if(family.length){
    const filter={...scope,category:anchor.category,unit:anchor.unit,currency:anchor.currency,taxonomyPath:anchor.taxonomyPath||{$in:['',null]}}
    candidates=await Product.find(filter).select(FIELDS).sort({_id:1}).limit(MAX+1).lean().maxTimeMS(5000)
    if(candidates.length>MAX)throw fail(503,'Comparison scope exceeds local capacity')
    candidates=candidates.filter(p=>same(comparisonFamilies(p.name),family))
    if(!candidates.some(p=>String(p._id)===String(oid)))throw fail(409,'Comparison anchor changed; retry')
  }
  // Rank only same-currency, same-unit, same-quantity goods estimates.
  // Requested quantity is never raised to fit a supplier's MOQ.
  const rows=candidates.map(p=>({ ...p,quote:comparisonQuote(p,quantity) }))
  rows.sort((a,b)=>rank(a)-rank(b)||(rank(a)===0?a.quote.unitPrice-b.quote.unitPrice:0)||String(a._id).localeCompare(String(b._id)))
  const total=rows.length
  const page=await Product.populate(rows.slice(options.skip,options.skip+options.limit),{path:'supplierId',select:'name city isVerified verificationStatus',options:{lean:true}})
  const offers=page.map(p=>({_id:p._id,name:p.name,category:p.category,taxonomyPath:p.taxonomyPath||'',unit:p.unit,currency:p.currency,moq:p.moq,city:p.city,supplierId:p.supplierId,storeId:p.storeId,imageUrl:p.imageUrl,quote:p.quote}))
  return {version:'v49-1',anchorId:String(oid),anchorName:anchor.name,category:anchor.category,taxonomyPath:anchor.taxonomyPath||'',unit:anchor.unit,currency:anchor.currency,quantity,familyKnown:family.length>0,offers,total,pagination:{page:options.page,limit:options.limit,total,pages:Math.ceil(total/options.limit)},identityVerified:false,shippingIncluded:false}
}
module.exports={comparableOffers}
