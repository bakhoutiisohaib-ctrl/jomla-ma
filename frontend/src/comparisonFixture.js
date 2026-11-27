export function comparisonFixture(product,quantity,page=1,others=[]){
 const rows=[product,...others].map(p=>{
  const q=quantity<p.moq?{kind:'below_moq'}:p.pricingMode==='on_request'?{kind:'request'}:(()=>{const unitPrice=(p.priceTiers||[]).find(t=>t.minQty<=quantity&&(t.maxQty==null||t.maxQty>=quantity))?.price??p.price;return {kind:'fixed',unitPrice,total:unitPrice*quantity}})();
  return {...p,taxonomyPath:p.taxonomyPath||'',quote:q};
 });
 const rank=q=>q.kind==='fixed'?0:q.kind==='request'?1:2;
 rows.sort((a,b)=>rank(a.quote)-rank(b.quote)||(a.quote.unitPrice??0)-(b.quote.unitPrice??0));
 return {version:'v49-1',anchorId:product._id,anchorName:product.name,category:product.category,taxonomyPath:product.taxonomyPath||'',unit:product.unit,currency:product.currency,quantity,familyKnown:true,total:rows.length,offers:rows.slice((page-1)*12,page*12),pagination:{page,limit:12,total:rows.length,pages:Math.ceil(rows.length/12)},identityVerified:false,shippingIncluded:false};
}
