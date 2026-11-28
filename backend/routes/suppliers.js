const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const Store = require('../models/Store')
const { authenticate, generateToken, requireRole, requirePermission } = require('../middleware/auth')
const { validateSupplierRegister, validateSupplierLogin, validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')
const { auditedChange } = require('../utils/audit')
const verification = require('../services/supplierVerification')
const { PUBLIC_FIELDS: PRODUCT_PUBLIC_FIELDS, PUBLIC_VISIBILITY } = require('../utils/catalog')

const PUBLIC_FIELDS = 'name city phone description avatar isVerified verificationStatus createdAt'
const { validBusinessTypes, declaredBusinessTypes } = require('../utils/businessTypes')
const ownerOnly = requireRole('supplier')
const httpError = (status, message) => Object.assign(new Error(message), { status })
const permissionsValid = values => Array.isArray(values) && values.every(v => Membership.STAFF_PERMISSIONS.includes(v))

function accountPayload(user, identity = {}) {
  return {
    id: String(user._id), _id: String(user._id), name: user.name, email: user.email,
    city: user.city, phone: user.phone, description: user.description, avatar: user.avatar,
    profilePending: Boolean(user.profilePending),
    businessTypes: user.role === 'supplier' ? declaredBusinessTypes(user.businessTypes) : [],
    role: user.role, ownerId: identity.ownerId || String(user._id),
    organization: user.organization, organizationId: Object.prototype.hasOwnProperty.call(identity, 'organizationId') ? identity.organizationId : (user.organizationId || null),
    permissions: identity.permissions || (['supplier', 'admin'].includes(user.role) ? ['all'] : []),
    isVerified: user.isVerified, verificationStatus: user.verificationStatus, verificationRevision: user.verificationRevision ?? 0,
    iceNumber: user.iceNumber, tradeRegistry: user.tradeRegistry, verificationDoc: user.verificationDoc,
    rejectionReason: user.rejectionReason
  }
}

async function organizationFor(owner, create = false, newId) {
  let organization = await Organization.findOne({ ownerSupplierId: owner._id || owner.id })
  if (!organization && create) {
    organization = await Organization.findOneAndUpdate(
      { ownerSupplierId: owner._id || owner.id },
      { $setOnInsert: { ...(newId ? { _id: newId } : {}), name: owner.organization || owner.name, city: owner.city || '', country: 'MA' } },
      { upsert: true, new: true, runValidators: true }
    )
    await Membership.findOneAndUpdate(
      { organizationId: organization._id, invitedEmail: owner.email },
      { $setOnInsert: {
        userId: owner._id || owner.id, role: 'owner', status: 'active',
        invitedBy: owner._id || owner.id, acceptedAt: new Date(), permissions: Membership.STAFF_PERMISSIONS
      } },
      { upsert: true, new: true, runValidators: true }
    )
    await Supplier.updateOne({ _id: owner._id || owner.id }, { $set: { organizationId: organization._id } })
  }
  return organization
}

router.post('/register', validateSupplierRegister, asyncHandler(async (req, res) => {
  const { name, city, phone, description, email, password, role = 'supplier', organization = '' } = req.body
  if (!['supplier', 'buyer', 'staff'].includes(role)) return res.status(400).json({ message: 'نوع الحساب غير مسموح' })
  if (req.body.permissions !== undefined || req.body.parentSupplierId !== undefined || req.body.organizationId !== undefined) {
    return res.status(400).json({ message: 'تعيين الموظف وصلاحياته يتم بدعوة من مالك الشركة' })
  }
  if (req.body.businessTypes !== undefined && (role !== 'supplier' || !validBusinessTypes(req.body.businessTypes))) {
    return res.status(400).json({ message: 'أنواع نشاط المورد غير صالحة' })
  }
  const normalizedEmail = String(email).trim().toLowerCase()
  if (await Supplier.exists({ email: normalizedEmail })) return res.status(409).json({ message: 'البريد الإلكتروني موجود بالفعل' })
  const supplier = new Supplier({
    name: name || 'مشتري جديد', city, phone, description: description || '', email: normalizedEmail,
    profilePending: role === 'buyer' && !require('../services/buyerProfile').contactComplete({ name, city, phone }),
    gender: req.body.gender || 'undisclosed',
    password: await bcrypt.hash(password, 12), role,
    organization: role === 'supplier' ? String(organization || name).trim() : '',
    businessTypes: role === 'supplier' ? declaredBusinessTypes(req.body.businessTypes) : [],
    permissions: [], products: []
  })
  await auditedChange({
    action: 'ACCOUNT_REGISTERED', targetType: 'Supplier', targetId: supplier._id,
    actor: { id: supplier._id, name, email: normalizedEmail, role }, details: { role }
  }, async () => {
    await supplier.save()
    if (role === 'supplier') await organizationFor(supplier, true)
  })
  const fresh = await Supplier.findById(supplier._id).select('+tokenVersion')
  res.status(201).json({ message: 'تم إنشاء الحساب بنجاح', token: generateToken(fresh), supplier: accountPayload(fresh) })
}))

router.post('/login', validateSupplierLogin, asyncHandler(async (req, res) => {
  const user = await Supplier.findOne({ email: String(req.body.email).trim().toLowerCase() }).select('+password +tokenVersion')
  if (!user || user.isActive === false || !(await bcrypt.compare(req.body.password, user.password))) {
    return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
  }
  res.json({ message: 'تم تسجيل الدخول', token: generateToken(user), supplier: accountPayload(user) })
}))

router.get('/me/profile', authenticate, asyncHandler(async (req, res) => {
  res.json(accountPayload(req.account, req.supplier))
}))

router.put('/me/business-types', authenticate, ownerOnly, asyncHandler(async (req, res) => {
  if (!req.body || Object.keys(req.body).length !== 1 || !validBusinessTypes(req.body.businessTypes)) {
    return res.status(400).json({ message: 'أنواع نشاط المورد غير صالحة' })
  }
  const businessTypes = declaredBusinessTypes(req.body.businessTypes)
  await auditedChange({
    action: 'SUPPLIER_BUSINESS_TYPES_UPDATED', targetType: 'Supplier', targetId: req.supplier.id,
    actor: req.supplier, details: { businessTypes }
  }, async () => {
    const result = await Supplier.updateOne({ _id: req.supplier.id, role: 'supplier', isActive: { $ne: false } }, { $set: { businessTypes } }, { runValidators: true })
    if (!result.matchedCount) throw httpError(403, 'حساب المورد غير متاح')
  })
  res.set('Cache-Control', 'private, no-store').json({ businessTypes })
}))

async function logout(req, res) {
  await auditedChange({
    action: 'ACCOUNT_SESSIONS_REVOKED', targetType: 'Supplier', targetId: req.supplier.id,
    actor: req.supplier
  }, () => Supplier.updateOne({ _id: req.supplier.id }, { $inc: { tokenVersion: 1 } }))
  res.json({ message: 'تم إلغاء جميع جلسات الحساب' })
}
router.post('/logout', authenticate, asyncHandler(logout))
router.post('/me/logout', authenticate, asyncHandler(logout))

router.put('/me/password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ message: 'كلمة المرور الجديدة تحتاج 8 أحرف على الأقل ولا تتجاوز 72 بايت؛ الحروف العربية قد تستعمل أكثر من بايت' })
  }
  const user = await Supplier.findById(req.supplier.id).select('+password +tokenVersion')
  if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(403).json({ message: 'كلمة المرور الحالية غير صحيحة' })
  const hashed = await bcrypt.hash(newPassword, 12)
  await auditedChange({
    action: 'ACCOUNT_PASSWORD_UPDATED', targetType: 'Supplier', targetId: user._id, actor: req.supplier
  }, () => Supplier.updateOne({ _id: user._id }, { $set: { password: hashed }, $inc: { tokenVersion: 1 } }))
  res.json({ message: 'تم تغيير كلمة المرور؛ يرجى تسجيل الدخول مجدداً' })
}))

router.get('/me/organization', authenticate, asyncHandler(async (req, res) => {
  const organization = req.supplier.role === 'staff'
    ? (req.supplier.organizationId && await Organization.findById(req.supplier.organizationId))
    : await organizationFor(req.account)
  if (!organization) return res.json({ organization: null, memberships: [] })
  const memberships = req.supplier.role === 'supplier'
    ? await Membership.find({ organizationId: organization._id }).populate('userId', 'name email role')
    : []
  res.json({ organization, memberships })
}))

router.put('/me/organization', authenticate, ownerOnly, asyncHandler(async (req, res) => {
  const allowed = ['name', 'description', 'city', 'country']
  if (Object.keys(req.body).some(key => !allowed.includes(key))) return res.status(400).json({ message: 'حقول الشركة غير مسموحة' })
  if (req.body.name !== undefined && (typeof req.body.name !== 'string' || !req.body.name.trim())) {
    return res.status(400).json({ message: 'اسم الشركة مطلوب' })
  }
  const targetId = req.supplier.organizationId || new mongoose.Types.ObjectId()
  const { result } = await auditedChange({
    action: 'ORGANIZATION_UPDATED', targetType: 'Organization', targetId, actor: req.supplier,
    details: { fields: Object.keys(req.body) }
  }, async () => {
    const organization = await organizationFor(req.account, true, targetId)
    for (const key of allowed) if (req.body[key] !== undefined) organization[key] = req.body[key]
    await organization.save()
    await Supplier.updateOne({ _id: req.supplier.id }, { $set: { organization: organization.name, organizationId: organization._id } })
    return organization
  })
  res.json({ organization: result })
}))

router.get('/me/staff-invitations', authenticate, asyncHandler(async (req, res) => {
  let filter
  if (req.supplier.role === 'supplier') {
    const organization = await organizationFor(req.account)
    if (!organization) return res.json({ data: [] })
    filter = { organizationId: organization._id }
  } else {
    filter = { invitedEmail: req.supplier.email, role: 'staff', status: 'invited', invitationExpiresAt: { $gt: new Date() } }
  }
  const invitations = await Membership.find(filter).populate('organizationId', 'name city').sort({ createdAt: -1 })
  res.json({ data: invitations })
}))

router.post('/me/staff-invitations', authenticate, ownerOnly, asyncHandler(async (req, res) => {
  const { email, permissions } = req.body
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !permissionsValid(permissions)) {
    return res.status(400).json({ message: 'بريد الموظف وقائمة صلاحيات صحيحة مطلوبان' })
  }
  const invitedEmail = email.trim().toLowerCase()
  if (invitedEmail === req.supplier.email) return res.status(400).json({ message: 'لا يمكن دعوة مالك الشركة كموظف' })
  const existingUser = await Supplier.findOne({ email: invitedEmail })
  if (existingUser && existingUser.role !== 'staff') return res.status(409).json({ message: 'يجب أن يكون حساب المدعو من نوع موظف' })
  const organization = await organizationFor(req.account, true)
  let membership = await Membership.findOne({ organizationId: organization._id, invitedEmail })
  if (membership?.status === 'active') return res.status(409).json({ message: 'الموظف عضو بالفعل؛ عدّل العضوية بدلاً من دعوته' })
  membership = membership || new Membership({ organizationId: organization._id, invitedEmail, role: 'staff', invitedBy: req.supplier.id })
  membership.permissions = [...new Set(permissions)]
  membership.status = 'invited'
  membership.invitationExpiresAt = new Date(Date.now() + 7 * 86400000)
  membership.userId = undefined
  membership.acceptedAt = undefined
  const acceptanceToken = crypto.randomBytes(32).toString('hex')
  membership.invitationTokenHash = crypto.createHash('sha256').update(acceptanceToken).digest('hex')
  await auditedChange({
    action: 'STAFF_INVITED', targetType: 'Membership', targetId: membership._id,
    actor: req.supplier, details: { invitedEmail, permissions: membership.permissions, organizationId: organization._id }
  }, () => membership.save())
  const invitation = membership.toObject()
  delete invitation.invitationTokenHash
  res.status(201).json({ message: 'تم إنشاء الدعوة؛ شارك الرمز مع الموظف عبر وسيلة موثوقة. لم يُرسل بريد', invitation, acceptanceToken })
}))

router.post('/me/staff-invitations/:id/accept', authenticate, validateMongoId, requireRole('staff'), asyncHandler(async (req, res) => {
  const membership = await Membership.findById(req.params.id).select('+invitationTokenHash')
  if (!membership || membership.invitedEmail !== req.supplier.email) return res.status(404).json({ message: 'الدعوة غير موجودة' })
  const tokenHash = typeof req.body.token === 'string' && crypto.createHash('sha256').update(req.body.token).digest('hex')
  if (!tokenHash || !membership.invitationTokenHash || !crypto.timingSafeEqual(Buffer.from(tokenHash, 'hex'), Buffer.from(membership.invitationTokenHash, 'hex'))) {
    return res.status(403).json({ message: 'رمز الدعوة غير صحيح' })
  }
  if (membership.status !== 'invited' || !membership.invitationExpiresAt || membership.invitationExpiresAt <= new Date()) {
    return res.status(409).json({ message: 'الدعوة غير متاحة أو منتهية' })
  }
  if (await Membership.exists({ userId: req.supplier.id, status: 'active' })) return res.status(409).json({ message: 'أنت مرتبط بشركة بالفعل' })
  const organization = await Organization.findById(membership.organizationId)
  const owner = organization && await Supplier.findOne({ _id: organization.ownerSupplierId, role: 'supplier', isActive: { $ne: false } })
  if (!owner) return res.status(409).json({ message: 'الشركة غير متاحة' })
  await auditedChange({
    action: 'STAFF_INVITATION_ACCEPTED', targetType: 'Membership', targetId: membership._id,
    actor: req.supplier, details: { organizationId: organization._id }
  }, async () => {
    const updated = await Membership.findOneAndUpdate(
      { _id: membership._id, status: 'invited', invitationTokenHash: tokenHash, invitedEmail: req.supplier.email, invitationExpiresAt: { $gt: new Date() } },
      { $set: { status: 'active', userId: req.supplier.id, acceptedAt: new Date() }, $unset: { invitationTokenHash: '' }, $inc: { __v: 1 } }, { new: true, runValidators: true }
    )
    if (!updated) throw httpError(409, 'الدعوة لم تعد متاحة')
    await Supplier.updateOne({ _id: req.supplier.id }, { $set: { organizationId: organization._id, parentSupplierId: owner._id } })
  })
  res.json({ message: 'تم قبول العضوية', organization, membership: await Membership.findById(membership._id) })
}))

router.patch('/me/memberships/:id', authenticate, ownerOnly, validateMongoId, asyncHandler(async (req, res) => {
  const organization = await organizationFor(req.account)
  const membership = organization && await Membership.findOne({ _id: req.params.id, organizationId: organization._id, role: 'staff' })
  if (!membership) return res.status(404).json({ message: 'العضوية غير موجودة' })
  const { permissions, status } = req.body
  if (Object.keys(req.body).some(k => !['permissions', 'status'].includes(k)) ||
      (permissions !== undefined && !permissionsValid(permissions)) || (status !== undefined && !['active', 'revoked'].includes(status))) {
    return res.status(400).json({ message: 'بيانات العضوية غير صحيحة' })
  }
  if (status === 'active' && membership.status !== 'active') return res.status(409).json({ message: 'إعادة الانضمام تتطلب دعوة جديدة وقبول الموظف' })
  await auditedChange({
    action: 'MEMBERSHIP_UPDATED', targetType: 'Membership', targetId: membership._id,
    actor: req.supplier, details: { permissions, status }
  }, async () => {
    if (permissions !== undefined) membership.permissions = [...new Set(permissions)]
    if (status !== undefined) membership.status = status
    await membership.save()
    if (status === 'revoked' && membership.userId) {
      await Supplier.updateOne({ _id: membership.userId }, { $unset: { organizationId: '', parentSupplierId: '' }, $inc: { tokenVersion: 1 } })
    }
  })
  res.json({ message: 'تم تحديث العضوية', membership })
}))

router.post('/me/verify', authenticate, ownerOnly, asyncHandler(async (req, res) => {
  const body = req.body || {}, supplier = req.account
  const fields = ['iceNumber', 'tradeRegistry', 'verificationDoc']
  // Older clients may submit the initial revision; subsequent edits must name it.
  const expected = body.verificationRevision ?? 0
  if (Object.keys(body).some(k => ![...fields, 'verificationRevision'].includes(k)) ||
      !Number.isSafeInteger(expected) || expected < 0 ||
      fields.some(k => body[k] !== undefined && (typeof body[k] !== 'string' || body[k].length > (k === 'verificationDoc' ? 2048 : 100)))) {
    return res.status(400).json({ message: 'بيانات طلب التوثيق غير صحيحة' })
  }
  const input = Object.fromEntries(fields.map(k => [k, (body[k] ?? supplier[k] ?? '').trim()]))
  if (!input.iceNumber && !input.tradeRegistry) return res.status(400).json({ message: 'رقم ICE أو السجل التجاري مطلوب' })
  if (input.verificationDoc) {
    let valid = false
    try {
      const url = new URL(input.verificationDoc)
      valid = url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
    } catch { /* A legacy managed reference can be retained, not newly supplied. */ }
    if (!valid && input.verificationDoc !== supplier.verificationDoc) return res.status(400).json({ message: 'رابط وثيقة التوثيق غير صالح' })
  }
  const {supplier:saved,replayed}=await verification.submit(supplier,req.supplier,input,expected)
  res.json({ message: replayed?'هذه حالة ملف التوثيق المحفوظ':'تم إرسال طلب التوثيق للمراجعة', supplier: accountPayload(saved, req.supplier), ...(replayed?{replayed:true}:{}) })
}))

// Retired duplicate upload route: all writes use the validated catalog API.
router.post('/me/products', authenticate, requirePermission('manage_products'), (req, res) => {
  res.status(410).json({ message: 'استخدم /api/products مع حقول النشر والإقرار الإلزامية' })
})

router.get('/me/orders', authenticate, requirePermission('manage_rfq'), asyncHandler(async (req, res) => {
  const Order = require('../models/Order')
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { supplierId: req.supplier.ownerId }
  if (req.query.status) filter.status = req.query.status
  const orders = await Order.find(filter).limit(limit).skip(skip).sort({ createdAt: -1 })
  res.json(formatPaginationResponse(orders, await Order.countDocuments(filter), page, limit))
}))

router.patch('/me/orders/:orderId/status', authenticate, requirePermission('manage_rfq'), asyncHandler(async (req, res) => {
  if (!['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(req.body.status)) return res.status(400).json({ message: 'حالة غير صحيحة' })
  const Order = require('../models/Order')
  const order = await Order.findOne({ _id: req.params.orderId, supplierId: req.supplier.ownerId })
  if (!order) return res.status(404).json({ message: 'الطلب غير موجود' })
  order.status = req.body.status
  await order.save()
  res.json({ message: 'تم تحديث حالة الطلب', order })
}))

router.get('/me/reviews', authenticate, requirePermission('manage_store'), asyncHandler(async (req, res) => {
  const Review = require('../models/Review')
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { supplierId: req.supplier.ownerId }
  res.json(formatPaginationResponse(await Review.find(filter).limit(limit).skip(skip), await Review.countDocuments(filter), page, limit))
}))
// A supplier may reply but must not erase a buyer's independent review.
router.delete('/me/reviews/:id', authenticate, (req, res) => res.status(403).json({ message: 'إزالة التقييمات تتم بمراجعة إدارة المنصة' }))
router.post('/me/reviews/:id/reply', authenticate, requireRole('supplier'), validateMongoId, asyncHandler(async (req, res) => {
  if (Object.keys(req.body || {}).some(key=>key!=='text') || typeof req.body.text !== 'string' || !req.body.text.trim() || req.body.text.length > 2000) return res.status(400).json({ message: 'نص رد صالح مطلوب' })
  const Review = require('../models/Review')
  const review = await Review.findOne({ _id: req.params.id, supplierId: req.supplier.ownerId })
  if (!review) return res.status(404).json({ message: 'التقييم غير موجود' })
  if(review.reply?.text===req.body.text.trim())return res.json({message:'الرد محفوظ بالفعل',review})
  await auditedChange({
    action: 'REVIEW_REPLIED', targetType: 'Review', targetId: review._id, actor: req.supplier
  }, async () => {
    review.reply = { text: req.body.text.trim(), date: new Date() }
    await review.save()
  })
  res.json({ message: 'تم إضافة الرد', review })
}))

router.get('/me/analytics', authenticate, requirePermission('manage_store', 'manage_products'), asyncHandler(async (req, res) => {
  const supplierId = new mongoose.Types.ObjectId(req.supplier.ownerId)
  const categoryStats = await Product.aggregate([
    { $match: { supplierId } },
    { $group: { _id: '$category', count: { $sum: 1 }, avgPrice: { $avg: '$price' } } },
    { $sort: { count: -1 } }
  ])
  res.json({ totalProducts: await Product.countDocuments({ supplierId }), categoryStats })
}))
router.get('/me/analytics/details', authenticate, requirePermission('manage_store', 'manage_products'), asyncHandler(async (req, res) => {
  const supplierId = new mongoose.Types.ObjectId(req.supplier.ownerId)
  const supplierStats = await Product.aggregate([
    { $match: { supplierId } }, { $group: { _id: '$category', supplierAvg: { $avg: '$price' }, supplierCount: { $sum: 1 } } }
  ])
  const marketStats = await Product.aggregate([
    { $match: { isDraft: false, moderationStatus: { $ne: 'hidden' } } },
    { $group: { _id: '$category', marketAvg: { $avg: '$price' }, marketCount: { $sum: 1 } } }
  ])
  const marketMap = Object.fromEntries(marketStats.map(m => [m._id, m]))
  res.json({ analysis: supplierStats.map(s => {
    const market = marketMap[s._id] || { marketAvg: null, marketCount: 0 }
    return { category: s._id, supplierAvg: s.supplierAvg, supplierCount: s.supplierCount,
      marketAvg: market.marketAvg, marketCount: market.marketCount,
      gapPercentage: market.marketAvg ? ((s.supplierAvg - market.marketAvg) / market.marketAvg) * 100 : null }
  }) })
}))

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { role: 'supplier', isActive: { $ne: false } }
  const suppliers = await Supplier.find(filter).select(PUBLIC_FIELDS).limit(limit).skip(skip)
  res.json(formatPaginationResponse(suppliers, await Supplier.countDocuments(filter), page, limit))
}))
router.get('/:id/products', validateMongoId, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const owner = await Supplier.exists({ _id: req.params.id, role: 'supplier', isActive: { $ne: false } })
  if (!owner) return res.status(404).json({ message: 'المورد غير موجود' })
  const activeStores = await Store.find({ supplierId: req.params.id, isActive: true, reviewStatus: 'approved', adminSuspended: { $ne: true } }).distinct('_id')
  const filter = { ...PUBLIC_VISIBILITY, supplierId: req.params.id, storeId: { $in: activeStores } }
  const products = await Product.find(filter).select(PRODUCT_PUBLIC_FIELDS).limit(limit).skip(skip)
  res.json(formatPaginationResponse(products, await Product.countDocuments(filter), page, limit))
}))
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOne({ _id: req.params.id, role: 'supplier', isActive: { $ne: false } }).select(PUBLIC_FIELDS)
  if (!supplier) return res.status(404).json({ message: 'المورد غير موجود' })
  res.json(supplier)
}))

router.put('/:id', authenticate, validateMongoId, asyncHandler(async (req, res) => {
  if (req.params.id !== req.supplier.id) return res.status(403).json({ message: 'لا يمكنك تعديل حساب آخر' })
  const allowed = ['name', 'city', 'phone', 'description', 'avatar']
  if (!Object.keys(req.body).length || Object.keys(req.body).some(key => !allowed.includes(key) || typeof req.body[key] !== 'string')) {
    return res.status(400).json({ message: 'يسمح فقط بتعديل الاسم والمدينة والهاتف والوصف والصورة' })
  }
  if (req.body.name !== undefined && !req.body.name.trim()) return res.status(400).json({ message: 'الاسم مطلوب' })
  for (const key of allowed) if (req.body[key]?.length > (key === 'description' ? 3000 : 500)) return res.status(400).json({ message: 'بيانات الملف أطول من الحد المسموح' })
  const changes = { ...req.body }
  if (req.account.role === 'buyer' && req.account.profilePending) {
    // The placeholder is not a supplied contact name. Completion must include it.
    changes.profilePending = !(typeof changes.name === 'string' && require('../services/buyerProfile').contactComplete({ ...req.account.toObject(), ...changes }))
  }
  const { result } = await auditedChange({
    action: 'ACCOUNT_PROFILE_UPDATED', targetType: 'Supplier', targetId: req.supplier.id,
    actor: req.supplier, details: { fields: Object.keys(req.body) }
  }, () => Supplier.findByIdAndUpdate(req.supplier.id, { $set: changes }, { new: true, runValidators: true }))
  res.json({ message: 'تم التحديث', supplier: accountPayload(result, req.supplier) })
}))

module.exports = router
