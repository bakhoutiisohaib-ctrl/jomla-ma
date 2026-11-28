import {reviewBasisLabel,validatedPublicReviews,validReviewRows} from './reviewPresentation';
import {labelFor} from '../../i18n/useLabels';
const supplierId='2'.repeat(24),row={_id:'1'.repeat(24),supplierId,stars:1,basis:'mutual_confirmation'};
const valid={stats:{avg:1,total:1},legacyTotal:0,data:[row],pagination:{page:1,limit:5,total:1,pages:1,hasNextPage:false,hasPrevPage:false}};
test.each([
 ['ar','تعامل أقره الطرفان','تقييم غير محتسب في المعدل — أدلة غير كافية للتحقق'],
 ['fr','Transaction confirmée mutuellement','Avis exclu de la moyenne — preuves insuffisantes'],
 ['en','Mutually confirmed transaction','Excluded from the rating average — insufficient evidence']
])('neutral evidence classification in %s',(lang,confirmed,excluded)=>{
 const l=(...args)=>labelFor(lang,...args);
 expect(reviewBasisLabel(l,row)).toBe(confirmed);
 expect(reviewBasisLabel(l,{...row,basis:undefined})).toBe(excluded);
});
test('consistent counts are required and internal identifiers or duplicate rows fail closed',()=>{
 expect(validatedPublicReviews(valid,supplierId,1,5)).toBe(valid);
 for(const key of ['buyerId','tradeConfirmationId'])expect(validReviewRows([{...row,[key]:'3'.repeat(24)}],supplierId)).toBe(false);
 expect(validReviewRows([row,row],supplierId)).toBe(false);
 expect(validatedPublicReviews({...valid,pagination:{...valid.pagination,hasNextPage:true}},supplierId,1,5)).toBeNull();
});
