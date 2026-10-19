const express = require('express')
const router = express.Router()
const Report = require('../models/Report')
const AuditLog = require('../models/AuditLog')
const { authenticate, requireRole } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

// تقديم بلاغ جديد (متاح للمستخدمين والمشترين)
router.post('/', asyncHandler(async (req, res) => {
  const { reporterName, reporterPhone, targetType, targetId, targetName, reason, details } = req.body

  if (!targetType || !targetId || !targetName || !reason) {
    return res.status(400).json({ message: '⚠️ بيانات البلاغ غير مكتملة (نوع الهدف، المعرف، والسبب مطلوبة)' })
  }

  const report = new Report({
    reporterName: reporterName || 'مستخدم المنصة',
    reporterPhone: reporterPhone || '',
    targetType,
    targetId,
    targetName,
    reason,
    details: details || '',
    status: 'pending'
  })

  await report.save()

  // تسجيل البلاغ في سجل التدقيق
  await AuditLog.create({
    action: 'REPORT_SUBMITTED',
    actorRole: 'buyer',
    actorEmail: reporterPhone || 'anonymous@buyer.ma',
    targetModel: targetType === 'product' ? 'Product' : 'Supplier',
    targetId,
    details: { reason, targetName, details },
    ipAddress: req.ip || req.connection?.remoteAddress
  }).catch(() => {})

  res.status(201).json({
    message: '✅ تم استلام البلاغ وسيتم مراجعته من قبل إدارة المنصة في أقرب وقت',
    report
  })
}))

// جلب البلاغات للمشرف فقط
router.get('/', authenticate, requireRole('admin'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const { status } = req.query

  const filter = {}
  if (status && status !== 'all') filter.status = status

  const reports = await Report.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Report.countDocuments(filter)
  const pendingCount = await Report.countDocuments({ status: 'pending' })

  res.json({
    ...formatPaginationResponse(reports, total, page, limit),
    pendingCount
  })
}))

// معالجة أو إغلاق البلاغ من قبل المشرف
router.put('/:id/resolve', authenticate, requireRole('admin'), validateMongoId, asyncHandler(async (req, res) => {
  const { action, resolutionNotes } = req.body // action: 'resolved' | 'dismissed'

  const report = await Report.findById(req.params.id)
  if (!report) {
    return res.status(404).json({ message: '❌ البلاغ غير موجود' })
  }

  report.status = action === 'dismissed' ? 'dismissed' : 'resolved'
  report.resolutionNotes = resolutionNotes || ''
  report.resolvedAt = new Date()

  await report.save()

  // تسجيل قرار المشرف
  await AuditLog.create({
    action: action === 'dismissed' ? 'REPORT_DISMISSED' : 'REPORT_RESOLVED',
    actorRole: 'admin',
    actorId: req.supplier.id,
    actorEmail: req.supplier.email,
    targetModel: 'Report',
    targetId: report._id,
    details: { action, resolutionNotes, targetName: report.targetName },
    ipAddress: req.ip || req.connection?.remoteAddress
  }).catch(() => {})

  res.json({
    message: action === 'dismissed' ? 'تم رفض البلاغ وحفظه' : '✅ تم حل البلاغ واتخاذ الإجراء اللازم',
    report
  })
}))

module.exports = router
