const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const { authenticate, requirePermission } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')
const { auditedChange } = require('../utils/audit')
const verification = require('../services/supplierVerification')
const { searchCatalog } = require('../utils/catalog')
const { parseBusinessTypeInput } = require('../utils/businessTypes')
const { parseSupplierTrust, verifiedSupplierPredicate } = require('../utils/supplierTrust')
const { assertProductImagesOwned } = require('../services/mediaPrivacy')
const { STORE_VISIBLE, STORE_FIELDS, supplierPopulation, publicStoreDto, getPublicStore } = require('../services/publicStore')

const fields = ['name', 'description', 'city', 'address', 'phone', 'logoUrl', 'bannerUrl', 'categories']
function validateStoreInput(body, updating = false) {
  if ((!updating || body.name !== undefined) && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) return 'اسم متجر صالح مطلوب'
  for (const key of fields.filter(k => k !== 'categories')) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > (key === 'description' ? 3000 : 1000))) return 'بيانات المتجر غير صحيحة'
  }
  if (body.categories !== undefined && (!Array.isArray(body.categories) || body.categories.length > 30 || body.categories.some(v => typeof v !== 'string' || v.length > 100))) return 'فئات المتجر غير صحيحة'
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') return 'حالة المتجر غير صحيحة'
  if (Object.keys(body).some(k => ![...fields, ...(updating ? ['isActive'] : [])].includes(k))) return 'هناك حقول غير مسموحة في بيانات المتجر'
  return null
}

router.get('/mine', authenticate, requirePermission('manage_store', 'manage_products'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { supplierId: req.supplier.ownerId }
  const stores = await Store.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip)
  const owner=await Supplier.findById(req.supplier.ownerId).select("isVerified verificationStatus")
  res.json(formatPaginationResponse(stores.map(s=>verification.storeDto(s,owner)), await Store.countDocuments(filter), page, limit))
}))

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const businessType = parseBusinessTypeInput(req.query)
  const supplierTrust = parseSupplierTrust(req.query)
  const owners = await Supplier.find({ role: 'supplier', ...(businessType ? { businessTypes: businessType } : {}), ...verifiedSupplierPredicate(supplierTrust), isActive: { $ne: false } }).distinct('_id')
  const filter = { ...STORE_VISIBLE, supplierId: { $in: owners } }
  if (typeof req.query.city === 'string') filter.city = req.query.city
  if (typeof req.query.category === 'string') filter.categories = req.query.category
  const stores = await Store.find(filter).select(STORE_FIELDS).populate(supplierPopulation)
    .sort({ views: -1, createdAt: -1, _id: -1 }).limit(limit).skip(skip).lean()
  const visible = (await Promise.all(stores.map(publicStoreDto))).filter(Boolean)
  res.set('Cache-Control', 'no-store').json(formatPaginationResponse(visible, await Store.countDocuments(filter), page, limit))
}))

router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const store = await getPublicStore(req.params.id)
  if (!store || !store.supplierId) return res.status(404).json({ message: 'المتجر غير متاح' })
  await Store.updateOne({ _id: store._id }, { $inc: { views: 1 } })
  const result = await searchCatalog({ ...req.query, limit: req.query.limit || 100 }, { storeId: store._id, supplierId: store.supplierId._id })
  res.json({ store, products: result.products, pagination: result.pagination })
}))

router.post('/', authenticate, requirePermission('manage_store'), asyncHandler(async (req, res) => {
  const error = validateStoreInput(req.body)
  if (error) return res.status(400).json({ message: error })
  const supplier = await Supplier.findOne({ _id: req.supplier.ownerId, role: 'supplier', isActive: { $ne: false } })
  if (!supplier) return res.status(403).json({ message: 'إنشاء متجر متاح لحساب مورد فعال فقط' })
  if (!req.supplier.organizationId) return res.status(409).json({ message: 'أكمل ملف الشركة أولاً' })
  if (req.body.logoUrl) await assertProductImagesOwned({ supplierId: supplier._id, imageUrl: req.body.logoUrl })
  const store = new Store({
    supplierId: supplier._id, organizationId: req.supplier.organizationId,
    slug: crypto.randomBytes(12).toString('hex'), name: req.body.name.trim(),
    description: req.body.description || '', city: req.body.city || supplier.city || '',
    address: req.body.address || '', phone: req.body.phone || supplier.phone || '',
    logoUrl: req.body.logoUrl || '', bannerUrl: req.body.bannerUrl || '',
    categories: req.body.categories || [], isVerified: verification.approved(supplier), verificationProjection:verification.stamp(supplier),
    reviewStatus: 'pending', isActive: false
  })
  await auditedChange({
    action: 'STORE_CREATED', targetType: 'Store', targetId: store._id, actor: req.supplier,
    details: { supplierId: supplier._id, reviewStatus: 'pending' }
  }, () => store.save())
  const current=await verification.syncStore(store)
  res.status(201).json({ message: 'تم إنشاء المتجر وهو بانتظار مراجعة الإدارة', ...current })
}))

router.put('/:id', authenticate, requirePermission('manage_store'), validateMongoId, asyncHandler(async (req, res) => {
  const error = validateStoreInput(req.body, true)
  if (error) return res.status(400).json({ message: error })
  const store = await Store.findById(req.params.id)
  if (!store) return res.status(404).json({ message: 'المتجر غير موجود' })
  if (String(store.supplierId) !== req.supplier.ownerId && req.supplier.role !== 'admin') return res.status(403).json({ message: 'لا تملك هذا المتجر' })
  if (req.body.logoUrl) await assertProductImagesOwned({ supplierId: store.supplierId, imageUrl: req.body.logoUrl })
  if (req.body.isActive === true && (store.reviewStatus !== 'approved' || store.adminSuspended)) return res.status(409).json({ message: 'تفعيل المتجر يتطلب موافقة الإدارة ورفع التعليق' })
  await auditedChange({
    action: 'STORE_UPDATED', targetType: 'Store', targetId: store._id, actor: req.supplier,
    details: { fields: Object.keys(req.body) }
  }, async () => {
    for (const key of [...fields, 'isActive']) if (req.body[key] !== undefined) store[key] = req.body[key]
    await store.save()
  })
  const owner=await Supplier.findById(store.supplierId).select('isVerified verificationStatus')
  res.json({ message: 'تم تحديث بيانات المتجر', store:verification.storeDto(store,owner) })
}))

module.exports = router
