const express = require('express')
const router = express.Router()
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const { getPublicStore } = require('../services/publicStore')
const { authenticate, requirePermission } = require('../middleware/auth')
const { validateProduct, validateProductUpdate, validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { formatPaginationResponse } = require('../utils/constants')
const { badRequest, parseOptions, searchCatalog, catalogCategories, PUBLIC_FIELDS, PUBLIC_VISIBILITY } = require('../utils/catalog')
const { auditedChange } = require('../utils/audit')
const { assertProductImagesOwned } = require('../services/mediaPrivacy')
const { enqueueJob, publicJob } = require('../services/jobQueue')
const { createProductOnce, publicProduct } = require('../services/productCreation')

const editFields = ['name', 'category', 'pricingMode', 'price', 'currency', 'country', 'moq', 'unit', 'priceTiers', 'availability', 'availabilityConfirmed', 'inStock', 'city', 'description', 'images', 'imageUrl', 'isDraft', 'storeId']

async function queueIndex(product, req, receipt = null) {
  try {
    const { job } = await enqueueJob({ type: 'visual_index_product', ownerId: String(product.supplierId),
      requestedBy: String(receipt?.actorId || req.supplier.id), organizationId: receipt ? (receipt.organizationId ? String(receipt.organizationId) : null) : (req.supplier.organizationId ? String(req.supplier.organizationId) : null),
      requiredPermission: 'manage_products', payload: { productId: String(product._id) },
      idempotencyKey: receipt ? `creation:${product._id}` : `${product._id}:${product.updatedAt.toISOString()}`, timeoutMs: 60000 })
    return { status: 'queued', job: publicJob(job) }
  } catch {
    // The product is already saved. Explicitly report a retryable indexing gap.
    return { status: 'unavailable', message: 'حُفظ المنتج؛ فهرسة الصورة تحتاج إعادة المحاولة أو تشغيل أداة الفهرسة.' }
  }
}

async function prepareProduct(product, req) {
  const body = req.body
  const ownerId = req.supplier.ownerId || req.supplier.id
  const imageChanged = body.imageUrl !== undefined && body.imageUrl !== product.imageUrl
  if (imageChanged) { product.hasImageRights = false; product.imageRights = undefined }
  for (const field of editFields) if (body[field] !== undefined) product[field] = field === 'storeId' && !body[field] ? undefined : body[field]
  product.supplierId = ownerId
  product.organizationId = req.supplier.organizationId || undefined
  const supplier = await Supplier.findById(ownerId).select('phone')
  product.supplierPhone = supplier?.phone || ''
  if (product.pricingMode === 'on_request') { product.price = undefined; product.priceTiers = [] }
  await assertProductImagesOwned(product)
  if (body.hasImageRights === false) { product.hasImageRights = false; product.imageRights = undefined }
  if (body.hasImageRights === true) {
    const source = body.imageRights?.source
    if (!['owned', 'licensed'].includes(source)) throw badRequest('حدد مصدر حق الصورة: owned أو licensed')
    const licenseReference = body.imageRights?.licenseReference?.trim()
    if (source === 'licensed' && !licenseReference) throw badRequest('مرجع ترخيص الصورة مطلوب')
    product.hasImageRights = true
    product.imageRights = { source, licenseReference, declaredBy: req.supplier.id, declaredAt: new Date() }
  }
  let store = null
  if (product.storeId) store = await Store.findOne({ _id: product.storeId, supplierId: ownerId })
  if (product.storeId && !store) throw badRequest('المتجر غير موجود أو لا تملكه')
  if (product.isDraft === false) {
    if (body.publishApproved !== true || body.hasImageRights !== true || body.availabilityConfirmed !== true) throw badRequest('النشر يحتاج اعتماداً صريحاً وإقرار حقوق الصورة وتأكيد التوفر في هذا الطلب')
    if (!store || store.reviewStatus !== 'approved' || !store.isActive || store.adminSuspended) throw badRequest('النشر يحتاج متجراً مملوكاً ومعتمداً ونشطاً')
    if (!product.imageUrl) throw badRequest('صورة المنتج مطلوبة للنشر')
    if (product.moderationStatus === 'hidden') throw badRequest('المنتج محجوب من الإشراف')
    product.approvedBy = req.supplier.id
    product.approvedAt = new Date()
  } else { product.approvedBy = undefined; product.approvedAt = undefined }
  await product.validate()
  return product
}

router.get('/mine', authenticate, requirePermission('manage_products'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = parseOptions(req.query)
  const filter = { supplierId: req.supplier.ownerId || req.supplier.id }
  const [products, total] = await Promise.all([
    Product.find(filter).populate('supplierId', 'name city phone').sort({ createdAt: -1, _id: 1 }).skip(skip).limit(limit),
    Product.countDocuments(filter)
  ])
  res.json(formatPaginationResponse(products, total, page, limit))
}))

const publicList = asyncHandler(async (req, res) => {
  const result = await searchCatalog(req.query)
  res.json({ ...formatPaginationResponse(result.products, result.total, result.page, result.limit), exactCount: result.exactCount, similarCount: result.similarCount })
})
router.get('/', publicList)
router.get('/search', publicList)
router.get('/categories', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(await catalogCategories(req.query))
}))

// Editor reads remain on /mine; public details never expose a draft to an
// owner/admin simply because a session or a known id was supplied.
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const product = await Product.findOne({ _id: req.params.id, ...PUBLIC_VISIBILITY }).select(PUBLIC_FIELDS).lean()
  const store = product && await getPublicStore(product.storeId)
  if (!product || !store || String(store.supplierId._id) !== String(product.supplierId)) {
    return res.status(404).json({ message: 'المنتج غير متاح' })
  }
  res.json({ product: { ...product, supplierId: store.supplierId }, store })
}))

router.post('/', authenticate, requirePermission('manage_products'), validateProduct, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const { product, receipt, replayed } = await createProductOnce(req, prepareProduct)
  try { await Supplier.findByIdAndUpdate(product.supplierId, { $addToSet: { products: product._id } }) }
  catch { throw Object.assign(new Error('حُفظ المنتج وتعذر استكمال الربط؛ أعد المحاولة بنفس معرف الحفظ'), { status: 503 }) }
  const visualIndex = await queueIndex(product, req, receipt)
  const result = receipt ? receipt.snapshot : publicProduct(product)
  res.status(201).json({ message: result.isDraft ? 'تم حفظ المنتج كمسودة خاصة' : 'تم اعتماد ونشر المنتج', product: result, visualIndex,
    ...(receipt ? { creation: { replayed } } : {}) })
}))

router.put('/:id', authenticate, requirePermission('manage_products'), validateMongoId, validateProductUpdate, asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, supplierId: req.supplier.ownerId || req.supplier.id })
  if (!product) return res.status(404).json({ message: 'المنتج غير موجود' })
  await prepareProduct(product, req)
  await product.save()
  const visualIndex = await queueIndex(product, req)
  res.json({ message: product.isDraft ? 'تم تحديث المسودة الخاصة' : 'تم اعتماد تحديث المنتج', product, visualIndex })
}))

router.delete('/:id', authenticate, requirePermission('manage_products'), validateMongoId, asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, supplierId: req.supplier.ownerId || req.supplier.id }
  const product = await Product.findOne(filter)
  if (!product) return res.status(404).json({ message: 'المنتج غير موجود' })
  await auditedChange({ action: 'PRODUCT_DELETED', targetType: 'Product', targetId: product._id, actor: req.supplier, details: { name: product.name } }, async () => {
    await Product.deleteOne(filter)
    await Supplier.findByIdAndUpdate(product.supplierId, { $pull: { products: product._id } })
  })
  res.json({ message: 'تم حذف المنتج' })
}))
module.exports = router
