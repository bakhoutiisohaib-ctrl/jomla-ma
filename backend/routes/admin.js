const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const Store = require('../models/Store')
const QuoteRequest = require('../models/QuoteRequest')
const AuditLog = require('../models/AuditLog')
const Report = require('../models/Report')
const { authenticate, generateToken, requireAdmin } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')
const { auditedChange } = require('../utils/audit')

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ message: 'البريد وكلمة المرور مطلوبان' })
  const user = await Supplier.findOne({ email: email.trim().toLowerCase(), role: 'admin', isActive: { $ne: false } }).select('+password +tokenVersion')
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'بيانات المشرف غير صحيحة' })
  res.json({
    message: 'تم تسجيل الدخول', token: generateToken(user),
    admin: { id: String(user._id), _id: String(user._id), name: user.name, email: user.email, role: user.role }
  })
}))

router.post('/setup-first-admin', (req, res) => res.status(410).json({ message: 'إنشاء المشرف يتم محلياً باستخدام scripts/create-admin.js' }))
router.use(authenticate, requireAdmin)

router.get('/stats', asyncHandler(async (req, res) => {
  const [totalProducts, totalSuppliers, verifiedSuppliers, pendingVerifications, totalRfqs, pendingRfqs, pendingStores, pendingReports] = await Promise.all([
    Product.countDocuments(), Supplier.countDocuments({ role: 'supplier' }),
    Supplier.countDocuments({ role: 'supplier', isVerified: true }),
    Supplier.countDocuments({ role: 'supplier', verificationStatus: 'pending' }),
    QuoteRequest.countDocuments(), QuoteRequest.countDocuments({ status: 'pending' }),
    Store.countDocuments({ reviewStatus: 'pending' }), Report.countDocuments({ status: 'pending' })
  ])
  res.json({ totalProducts, totalSuppliers, verifiedSuppliers, pendingVerifications, totalRfqs, pendingRfqs, pendingStores, pendingReports })
}))

router.get('/suppliers', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { role: 'supplier' }
  if (typeof req.query.status === 'string' && req.query.status !== 'all') filter.verificationStatus = req.query.status
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const regex = new RegExp(escapeRegex(req.query.search.trim().slice(0, 100)), 'i')
    filter.$or = ['name', 'email', 'city', 'iceNumber', 'tradeRegistry'].map(key => ({ [key]: regex }))
  }
  const suppliers = await Supplier.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip)
  res.json(formatPaginationResponse(suppliers, await Supplier.countDocuments(filter), page, limit))
}))

router.put('/suppliers/:id/verify', validateMongoId, asyncHandler(async (req, res) => {
  const { action, rejectionReason, verificationRevision } = req.body
  if (!['approve', 'reject'].includes(action) || !Number.isSafeInteger(verificationRevision) || verificationRevision < 0 || (rejectionReason !== undefined && (typeof rejectionReason !== 'string' || rejectionReason.length > 2000))) return res.status(400).json({ message: 'إجراء مراجعة أو إصدار ملف غير صالح' })
  const supplier = await Supplier.findOne({ _id: req.params.id, role: 'supplier', isActive: { $ne: false } })
  if (!supplier) return res.status(404).json({ message: 'المورد غير موجود أو معطل' })
  if (supplier.verificationStatus !== 'pending' || (supplier.verificationRevision ?? 0) !== verificationRevision) return res.status(409).json({ message: 'تغير ملف التوثيق؛ أعد تحميل الطلب قيد المراجعة' })
  const previousStatus = supplier.verificationStatus
  const { auditId, result: saved } = await auditedChange({
    action: action === 'approve' ? 'SUPPLIER_VERIFIED' : 'SUPPLIER_REJECTED',
    targetType: 'Supplier', targetId: supplier._id, actor: req.supplier,
    details: { previousStatus, verificationRevision, newStatus: action === 'approve' ? 'verified' : 'rejected', rejectionReason: rejectionReason || null, iceNumber: supplier.iceNumber, tradeRegistry: supplier.tradeRegistry }
  }, async () => {
    const approved = action === 'approve'
    const updated = await Supplier.findOneAndUpdate({ _id: supplier._id, role: 'supplier', isActive: { $ne: false },
      verificationStatus: 'pending', verificationRevision: verificationRevision === 0 ? { $in: [0, null] } : verificationRevision },
      { $set: { isVerified: approved, verificationStatus: approved ? 'verified' : 'rejected',
        rejectionReason: approved ? '' : (rejectionReason?.trim() || 'الوثائق لا تستوفي شروط التوثيق'),
        ...(approved ? { verifiedAt: new Date() } : {}) }, ...(!approved ? { $unset: { verifiedAt: 1 } } : {}) },
      { returnDocument: 'after', runValidators: true })
    if (!updated) throw Object.assign(new Error('تغير ملف التوثيق؛ أعد تحميل الحالة الحالية'), { status: 409 })
    await Store.updateMany({ supplierId: supplier._id }, { $set: { isVerified: updated.isVerified } })
    return updated
  })
  res.json({ message: action === 'approve' ? 'تم توثيق المورد' : 'تم رفض طلب التوثيق', supplier: saved, auditId })
}))

router.put('/suppliers/:id/status', validateMongoId, asyncHandler(async (req, res) => {
  const { isActive, reason } = req.body
  if (typeof isActive !== 'boolean' || typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ message: 'الحالة وسبب الإجراء مطلوبان' })
  const supplier = await Supplier.findOne({ _id: req.params.id, role: 'supplier' })
  if (!supplier) return res.status(404).json({ message: 'المورد غير موجود' })
  await auditedChange({
    action: 'ACCOUNT_STATUS_UPDATED', targetType: 'Supplier', targetId: supplier._id,
    actor: req.supplier, details: { isActive, reason: reason.slice(0, 2000) }
  }, async () => {
    await Supplier.updateOne({ _id: supplier._id }, { $set: { isActive }, $inc: { tokenVersion: 1 } })
    if (!isActive) await Store.updateMany({ supplierId: supplier._id }, { $set: { isActive: false, adminSuspended: true } })
  })
  res.json({ message: 'تم تحديث حالة المورد؛ تفعيل المتاجر يتم بمراجعة مستقلة' })
}))

router.get('/stores', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = {}
  if (typeof req.query.status === 'string' && req.query.status !== 'all') filter.reviewStatus = req.query.status
  const stores = await Store.find(filter).populate('supplierId', 'name city phone isVerified verificationStatus')
    .sort({ createdAt: -1 }).limit(limit).skip(skip)
  res.json(formatPaginationResponse(stores, await Store.countDocuments(filter), page, limit))
}))

router.put('/stores/:id/review', validateMongoId, asyncHandler(async (req, res) => {
  const { action, reason } = req.body
  if (!['approve', 'reject'].includes(action) || (reason !== undefined && typeof reason !== 'string')) return res.status(400).json({ message: 'إجراء مراجعة غير صالح' })
  const store = await Store.findById(req.params.id)
  if (!store) return res.status(404).json({ message: 'المتجر غير موجود' })
  const owner = await Supplier.findOne({ _id: store.supplierId, role: 'supplier', isActive: { $ne: false } })
  if (!owner) return res.status(409).json({ message: 'حساب مالك المتجر غير متاح' })
  await auditedChange({
    action: 'STORE_REVIEWED', targetType: 'Store', targetId: store._id, actor: req.supplier,
    details: { previousStatus: store.reviewStatus, action, reason: reason || '' }
  }, async () => {
    store.reviewStatus = action === 'approve' ? 'approved' : 'rejected'
    store.isActive = action === 'approve'
    store.adminSuspended = action !== 'approve'
    store.reviewReason = String(reason || '').slice(0, 2000)
    store.reviewedBy = req.supplier.id
    store.reviewedAt = new Date()
    store.isVerified = owner.isVerified
    await store.save()
  })
  res.json({ message: 'تمت مراجعة المتجر', store })
}))

router.put('/stores/:id/status', validateMongoId, asyncHandler(async (req, res) => {
  const { isActive, reason } = req.body
  if (typeof isActive !== 'boolean' || typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ message: 'الحالة وسبب الإجراء مطلوبان' })
  const store = await Store.findById(req.params.id)
  if (!store) return res.status(404).json({ message: 'المتجر غير موجود' })
  if (isActive && store.reviewStatus !== 'approved') return res.status(409).json({ message: 'يجب اعتماد المتجر أولاً' })
  if (isActive && !(await Supplier.exists({ _id: store.supplierId, role: 'supplier', isActive: { $ne: false } }))) return res.status(409).json({ message: 'مالك المتجر غير متاح' })
  await auditedChange({
    action: 'STORE_STATUS_UPDATED', targetType: 'Store', targetId: store._id, actor: req.supplier,
    details: { isActive, reason: reason.slice(0, 2000) }
  }, async () => {
    store.isActive = isActive
    store.adminSuspended = !isActive
    await store.save()
  })
  res.json({ message: 'تم تحديث حالة المتجر', store })
}))

router.get('/products', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = {}
  if (['visible', 'hidden'].includes(req.query.status)) filter.moderationStatus = req.query.status
  if (typeof req.query.search === 'string') filter.name = new RegExp(escapeRegex(req.query.search.slice(0, 100)), 'i')
  const products = await Product.find(filter).populate('supplierId', 'name').sort({ createdAt: -1 }).limit(limit).skip(skip)
  res.json(formatPaginationResponse(products, await Product.countDocuments(filter), page, limit))
}))

router.put('/products/:id/moderate', validateMongoId, asyncHandler(async (req, res) => {
  const { action, reason } = req.body
  if (!['hide', 'restore'].includes(action) || typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ message: 'إجراء hide أو restore وسبب الإشراف مطلوبان' })
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'المنتج غير موجود' })
  await auditedChange({
    action: 'PRODUCT_MODERATED', targetType: 'Product', targetId: product._id, actor: req.supplier,
    details: { previousStatus: product.moderationStatus, action, reason: reason.slice(0, 2000) }
  }, async () => {
    product.moderationStatus = action === 'hide' ? 'hidden' : 'visible'
    product.moderationReason = reason.slice(0, 2000)
    product.moderatedAt = new Date()
    product.moderatedBy = req.supplier.id
    // Restoration never publishes a draft or grants image rights.
    await Product.updateOne({ _id: product._id }, { $set: {
      moderationStatus: product.moderationStatus, moderationReason: product.moderationReason,
      moderatedAt: product.moderatedAt, moderatedBy: product.moderatedBy
    } }, { runValidators: true })
  })
  res.json({ message: 'تم تطبيق قرار الإشراف', product })
}))

router.get('/audit-logs', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).skip(skip)
  res.json(formatPaginationResponse(logs, await AuditLog.countDocuments(), page, limit))
}))

module.exports = router
