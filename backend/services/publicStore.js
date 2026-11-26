const Store = require('../models/Store')
const { ownedAsset } = require('./mediaPrivacy')
const { declaredBusinessTypes } = require('../utils/businessTypes')

const STORE_VISIBLE = { isActive: true, reviewStatus: 'approved', adminSuspended: { $ne: true } }
const STORE_FIELDS = 'name slug description city address phone logoUrl categories supplierId createdAt'
const SUPPLIER_FIELDS = 'name city phone description isVerified verificationStatus businessTypes'
const supplierPopulation = { path: 'supplierId', match: { role: 'supplier', isActive: { $ne: false } }, select: SUPPLIER_FIELDS }

async function publicStoreDto(store) {
  if (!store?.supplierId) return null
  // Legacy/external/foreign logos are never adopted as public store media.
  const logo = store.logoUrl && await ownedAsset(store.logoUrl, store.supplierId._id)
  return { ...store, supplierId: { ...store.supplierId, businessTypes: declaredBusinessTypes(store.supplierId.businessTypes) }, logoUrl: logo ? store.logoUrl : '' }
}
async function getPublicStore(id) {
  const store = await Store.findOne({ _id: id, ...STORE_VISIBLE }).select(STORE_FIELDS).populate(supplierPopulation).lean()
  return publicStoreDto(store)
}

module.exports = { STORE_VISIBLE, STORE_FIELDS, supplierPopulation, publicStoreDto, getPublicStore }
