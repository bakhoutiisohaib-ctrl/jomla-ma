export const validReviewStars = stars => Number.isInteger(stars) && stars >= 1 && stars <= 5;
const validId = id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
const count = n => Number.isSafeInteger(n) && n >= 0;
export const confirmedReview = r => r?.basis === 'mutual_confirmation' && validReviewStars(r.stars);
export function reviewBasisLabel(l, r) {
  return confirmedReview(r)
    ? l('تعامل أقره الطرفان','Transaction confirmée mutuellement','Mutually confirmed transaction')
    : l('تقييم غير محتسب في المعدل — أدلة غير كافية للتحقق','Avis exclu de la moyenne — preuves insuffisantes','Excluded from the rating average — insufficient evidence');
}
export function validReviewRows(rows, supplierId) {
  return Array.isArray(rows) && rows.every(r=>validId(r?._id) && r.supplierId===supplierId &&
    (r.basis===undefined || confirmedReview(r)) &&
    !Object.prototype.hasOwnProperty.call(r,'buyerId') && !Object.prototype.hasOwnProperty.call(r,'tradeConfirmationId')) &&
    new Set(rows.map(r=>r._id)).size===rows.length;
}
export function validatedPublicReviews(data,supplierId,page,limit) {
  const s=data?.stats,p=data?.pagination,excluded=data?.legacyTotal;
  if(!count(s?.total)||!Number.isFinite(s.avg)||(s.total===0?s.avg!==0:s.avg<1||s.avg>5)||
    !count(excluded)||!count(p?.total)||s.total+excluded!==p.total||
    p.page!==page||p.limit!==limit||p.pages!==Math.ceil(p.total/limit)||
    p.hasNextPage!==(page<p.pages)||p.hasPrevPage!==(page>1)||
    !validReviewRows(data.data,supplierId)||data.data.length!==Math.min(limit,Math.max(0,p.total-(page-1)*limit)))return null;
  const confirmed=data.data.filter(confirmedReview).length;
  if(confirmed>s.total||data.data.length-confirmed>excluded)return null;
  return data;
}
