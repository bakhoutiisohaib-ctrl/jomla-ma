const express = require('express')
const router = express.Router()
const Report = require('../models/Report')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const { authenticate, requireAdmin } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')
const { auditedChange } = require('../utils/audit')
const { PUBLIC_VISIBILITY } = require('../utils/catalog')
const { getPublicStore } = require('../services/publicStore')

const publicReportLimit = require('express-rate-limit')({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false })
router.post('/', publicReportLimit, asyncHandler(async (req, res) => {
  const { reporterName, reporterPhone, targetType, targetId, targetName, reason, details } = req.body
  if (!['product', 'supplier'].includes(targetType) || typeof targetId !== 'string' || !/^[a-f0-9]{24}$/i.test(targetId) ||
      !['fake_product', 'copyright_infringement', 'incorrect_pricing', 'fraud', 'other'].includes(reason)) {
    return res.status(400).json({ message: 'بيانات البلاغ غير صحيحة' })
  }
  for (const [value, max] of [[reporterName, 200], [reporterPhone, 50], [targetName, 300], [details, 5000]]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > max)) return res.status(400).json({ message: 'بيانات البلاغ غير صحيحة أو أطول من المسموح' })
  }
  let target
  if (targetType === 'product') {
    // Match the public product detail policy, including the store's real owner.
    target = await Product.findOne({ _id: targetId, ...PUBLIC_VISIBILITY }).select('name supplierId storeId').lean()
    const store = target && await getPublicStore(target.storeId)
    if (!store || String(store.supplierId._id) !== String(target.supplierId)) target = null
  } else {
    target = await Supplier.findOne({ _id: targetId, role: 'supplier', isActive: { $ne: false } }).select('name').lean()
  }
  if (!target) return res.status(404).json({ message: 'الهدف المبلغ عنه غير موجود' })
  const report = new Report({
    reporterName: reporterName || 'مستخدم المنصة', reporterPhone: reporterPhone || '',
    targetType, targetId, targetName: target.name, reason, details: details || '', status: 'pending'
  })
  await auditedChange({
    action: 'REPORT_SUBMITTED', targetType: 'Report', targetId: report._id,
    details: { reason, targetType, targetId, targetName: target.name }
  }, () => report.save())
  // Preserve the receipt id without serializing reporter or moderation data.
  res.status(201).json({ message: 'تم استلام البلاغ للمراجعة', report: { _id: report._id } })
}))

router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const filter = {}
  if (typeof req.query.status === 'string' && req.query.status !== 'all') filter.status = req.query.status
  if (filter.status && !['pending', 'investigating', 'resolved', 'dismissed'].includes(filter.status)) return res.status(400).json({ message: 'حالة البلاغ غير صحيحة' })
  const reports = await Report.find(filter).select('-resolutionClaim').sort({ createdAt: -1 }).limit(limit).skip(skip).lean()
  res.json({
    ...formatPaginationResponse(reports, await Report.countDocuments(filter), page, limit),
    pendingCount: await Report.countDocuments({ status: 'pending' })
  })
}))

router.put('/:id/resolve', authenticate, requireAdmin, validateMongoId, asyncHandler(async (req, res) => {
  const { action, resolutionNotes, moderationAction = 'none' } = req.body
  if (!['resolved', 'dismissed'].includes(action) || !['none', 'hide_product', 'suspend_supplier'].includes(moderationAction) ||
      typeof resolutionNotes !== 'string' || !resolutionNotes.trim() || resolutionNotes.length > 5000 ||
      (action === 'dismissed' && moderationAction !== 'none')) {
    return res.status(400).json({ message: 'قرار صحيح وملاحظات المعالجة مطلوبان' })
  }
  const report = await require('../services/reportResolution').resolveReport(req.params.id, { action, resolutionNotes, moderationAction }, req.supplier)
  res.json({ message: 'تم حفظ قرار البلاغ وإجراء الإشراف', report })
}))

module.exports = router
module.exports.publicReportLimit = publicReportLimit
