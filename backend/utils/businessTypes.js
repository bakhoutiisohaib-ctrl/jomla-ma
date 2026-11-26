const BUSINESS_TYPES = Object.freeze(['manufacturer', 'importer', 'distributor', 'wholesaler'])
const validBusinessTypes = values => Array.isArray(values) && values.length <= BUSINESS_TYPES.length &&
  values.every(value => typeof value === 'string' && BUSINESS_TYPES.includes(value)) &&
  new Set(values).size === values.length
function declaredBusinessTypes(values) {
  return validBusinessTypes(values) ? BUSINESS_TYPES.filter(value => values.includes(value)) : []
}
function parseBusinessType(value) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || !BUSINESS_TYPES.includes(value)) {
    throw Object.assign(new Error('نوع نشاط المورد غير صالح'), { status: 400 })
  }
  return value
}
function parseBusinessTypeInput(input = {}) {
  // Express simple query parsing leaves bracket syntax in literal keys.
  // Reject malformed filter keys rather than silently broadening the search.
  if (Object.keys(input).some(key => /^businessType(?:\[|\.)/.test(key))) {
    return parseBusinessType(null)
  }
  return parseBusinessType(input.businessType)
}
module.exports = { BUSINESS_TYPES, validBusinessTypes, declaredBusinessTypes, parseBusinessTypeInput }
