// Verification and owner-declared company country are distinct claims.
function parseSupplierTrust(input = {}) {
  const value = input.supplierTrust
  if (Object.keys(input).some(key => /^supplierTrust(?:\[|\.)/.test(key)) ||
      (value !== undefined && value !== '' && !['verified','declared_ma','rated'].includes(value))) {
    throw Object.assign(new Error('Invalid supplier trust filter'), { status: 400 })
  }
  return value || ''
}
function verifiedSupplierPredicate(value) {
  if (!value) return {}
  if (value !== 'verified') throw Object.assign(new Error('Invalid supplier trust filter'), { status: 400 })
  return { isVerified: true, verificationStatus: 'verified' }
}
async function supplierTrustPredicate(value,scope={}){
  if(value==='rated')return {_id:{$in:await require('../services/supplierRatingFilter').ratedSupplierIds(scope)}}
  if(value!=='declared_ma')return verifiedSupplierPredicate(value)
  const Organization=require('../models/Organization')
  const owners=await Organization.distinct('ownerSupplierId',{country:'MA',declaredCountry:'MA',$expr:{$and:[{$eq:[{$type:'$country'},'string']},{$eq:[{$type:'$declaredCountry'},'string']},{$eq:[{$type:'$ownerSupplierId'},'objectId']}]}}).read('primary').maxTimeMS(5000)
  return {_id:{$in:owners}}
}
module.exports = { parseSupplierTrust, verifiedSupplierPredicate, supplierTrustPredicate }