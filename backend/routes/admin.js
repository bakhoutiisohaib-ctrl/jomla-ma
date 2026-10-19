const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const QuoteRequest = require('../models/QuoteRequest')
const AuditLog = require('../models/AuditLog')
const { authenticate, generateToken, requireAdmin } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Admin
 *     description: Platform administration, supplier verification, and audit logs
 */

// تسجيل دخول المشرف (Admin Login)
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ message: '⚠️ البريد الإلكتروني وكلمة المرور مطلوبان' })
  }

  const supplier = await Supplier.findOne({ email })
  if (!supplier || supplier.role !== 'admin') {
    return res.status(401).json({ message: '❌ بيانات المشرف غير صحيحة أو الحساب ليس لديه صلاحيات الإدارة' })
  }

  const isValid = await bcrypt.compare(password, supplier.password)
  if (!isValid) {
    return res.status(401).json({ message: '❌ بيانات المشرف غير صحيحة' })
  }

  const token = generateToken(supplier)
  res.json({
    message: '✅ تم تسجيل دخول المشرف بنجاح',
    token,
    admin: {
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      role: supplier.role
    }
  })
}))

// إحصائيات لوحة التحكم للمشرف
router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [
    totalProducts,
    totalSuppliers,
    verifiedSuppliers,
    pendingVerifications,
    totalRfqs,
    pendingRfqs
  ] = await Promise.all([
    Product.countDocuments(),
    Supplier.countDocuments({ role: { $ne: 'admin' } }),
    Supplier.countDocuments({ isVerified: true }),
    Supplier.countDocuments({ verificationStatus: 'pending' }),
    QuoteRequest.countDocuments(),
    QuoteRequest.countDocuments({ status: 'pending' })
  ])

  res.json({
    totalProducts,
    totalSuppliers,
    verifiedSuppliers,
    pendingVerifications,
    totalRfqs,
    pendingRfqs
  })
}))

// جلب قائمة الموردين مع الفلترة حسب حالة التوثيق
router.get('/suppliers', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const { status, search } = req.query

  const filter = { role: { $ne: 'admin' } }

  if (status && status !== 'all') {
    filter.verificationStatus = status
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { city: { $regex: search, $options: 'i' } },
      { iceNumber: { $regex: search, $options: 'i' } },
      { tradeRegistry: { $regex: search, $options: 'i' } }
    ]
  }

  const suppliers = await Supplier.find(filter)
    .select('-password')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Supplier.countDocuments(filter)

  res.json(formatPaginationResponse(suppliers, total, page, limit))
}))

// مراجعة توثيق مورد: قبول (تفعيل شارة مورد موثوق) أو رفض
router.put('/suppliers/:id/verify', authenticate, requireAdmin, validateMongoId, asyncHandler(async (req, res) => {
  const { action, rejectionReason } = req.body

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: '⚠️ الإجراء يجب أن يكون إما approve أو reject' })
  }

  const supplier = await Supplier.findById(req.params.id)
  if (!supplier) {
    return res.status(404).json({ message: '❌ المورد غير موجود' })
  }

  const previousStatus = supplier.verificationStatus

  if (action === 'approve') {
    supplier.isVerified = true
    supplier.verificationStatus = 'verified'
    supplier.verifiedAt = new Date()
    supplier.rejectionReason = ''
  } else {
    supplier.isVerified = false
    supplier.verificationStatus = 'rejected'
    supplier.rejectionReason = rejectionReason || 'الوثائق المدلى بها غير مطابقة لشروط التوثيق'
  }

  await supplier.save()

  // تسجيل الإجراء في سجل التدقيق (AuditLog)
  const auditEntry = await AuditLog.create({
    action: action === 'approve' ? 'SUPPLIER_VERIFIED' : 'SUPPLIER_REJECTED',
    targetType: 'Supplier',
    targetId: supplier._id,
    performedBy: {
      id: req.supplier.id,
      name: req.supplier.name || 'مشرف المنصة',
      email: req.supplier.email,
      role: 'admin'
    },
    details: {
      previousStatus,
      newStatus: supplier.verificationStatus,
      rejectionReason: supplier.rejectionReason || null,
      iceNumber: supplier.iceNumber,
      tradeRegistry: supplier.tradeRegistry
    }
  })

  res.json({
    message: action === 'approve' 
      ? '✅ تم قبول وتوثيق المورد بنجاح ومنحه شارة مورد موثوق 🛡️' 
      : '⚠️ تم رفض طلب توثيق المورد وحفظ سبب الرفض',
    supplier: {
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      isVerified: supplier.isVerified,
      verificationStatus: supplier.verificationStatus,
      verifiedAt: supplier.verifiedAt,
      rejectionReason: supplier.rejectionReason
    },
    auditId: auditEntry._id
  })
}))

// سجل التدقيق المالي والإداري (Audit Logs)
router.get('/audit-logs', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)

  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)

  const total = await AuditLog.countDocuments()

  res.json(formatPaginationResponse(logs, total, page, limit))
}))

// تهيئة المشرف الأول (إذا لم يكن هناك أي مشرف)
router.post('/setup-first-admin', asyncHandler(async (req, res) => {
  const existingAdmin = await Supplier.findOne({ role: 'admin' })
  if (existingAdmin) {
    return res.status(403).json({ message: '❌ تم إعداد المشرف مسبقاً' })
  }

  const { name, email, password, phone } = req.body
  if (!email || !password || !name) {
    return res.status(400).json({ message: '⚠️ الاسم والبريد وكلمة المرور مطلوبة' })
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const admin = new Supplier({
    name,
    email,
    password: hashedPassword,
    phone: phone || '+212600000000',
    city: 'الدار البيضاء',
    role: 'admin',
    isVerified: true,
    verificationStatus: 'verified'
  })

  await admin.save()
  const token = generateToken(admin)

  res.status(201).json({
    message: '✅ تم إنشاء حساب المشرف الأول بنجاح',
    token,
    admin: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role
    }
  })
}))

module.exports = router
