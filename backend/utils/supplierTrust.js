// Only an actual administrative verification decision is supported today.
function parseSupplierTrust(input = {}) {
  const value = input.supplierTrust
  if (Object.keys(input).some(key => /^supplierTrust(?:\[|\.)/.test(key)) ||
      (value !== undefined && value !== '' && value !== 'verified')) {
    throw Object.assign(new Error('Invalid supplier trust filter'), { status: 400 })
  }
  return value || ''
}
function verifiedSupplierPredicate(value) {
  if (!value) return {}
  if (value !== 'verified') throw Object.assign(new Error('Invalid supplier trust filter'), { status: 400 })
  return { isVerified: true, verificationStatus: 'verified' }
}
module.exports = { parseSupplierTrust, verifiedSupplierPredicate }