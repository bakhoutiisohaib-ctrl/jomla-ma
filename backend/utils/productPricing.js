// Existing quantity-tier rule shared with visual search. Validation is
// explicit for commercial estimates; do not silently rank malformed legacy data.
function effectivePrice(product, quantity) {
  if (!quantity) return product.price
  const tier = (product.priceTiers || []).find(t => t.minQty <= quantity && (t.maxQty == null || t.maxQty >= quantity))
  return tier?.price ?? product.price
}
const qty=n=>Number.isSafeInteger(n)&&n>0
const price=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0
function comparisonQuote(product, quantity) {
  if(!qty(product.moq))return {kind:'unknown'}
  if(quantity<product.moq)return {kind:'below_moq'}
  if(product.pricingMode==='on_request')return {kind:'request'}
  if(!['fixed',undefined].includes(product.pricingMode)||!price(product.price)||
     (product.priceTiers!=null&&!Array.isArray(product.priceTiers)))return {kind:'unknown'}
  const tiers=[...(product.priceTiers||[])]
  if(tiers.some(t=>!t||!qty(t.minQty)||t.minQty<product.moq||!price(t.price)||
     (t.maxQty!=null&&(!qty(t.maxQty)||t.maxQty<t.minQty))))return {kind:'unknown'}
  tiers.sort((a,b)=>a.minQty-b.minQty)
  for(let i=1;i<tiers.length;i++)if(tiers[i-1].maxQty==null||tiers[i].minQty<=tiers[i-1].maxQty)return {kind:'unknown'}
  const unitPrice=effectivePrice(product,quantity)
  let minorFactor
  try{minorFactor=10**new Intl.NumberFormat('en',{style:'currency',currency:product.currency}).resolvedOptions().maximumFractionDigits}catch{return {kind:'unknown'}}
  const total=unitPrice*quantity
  return {kind:'fixed',unitPrice,total:Number.isFinite(total)&&total*minorFactor<=Number.MAX_SAFE_INTEGER?total:null}
}
module.exports={effectivePrice,comparisonQuote}
