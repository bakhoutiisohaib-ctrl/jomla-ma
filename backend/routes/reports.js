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

router.post('/', asyncHandler(async (req, res) => {
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
  const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip)
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
  const report = await Report.findById(req.params.id)
  if (!report) return res.status(404).json({ message: 'البلاغ غير موجود' })
  if (['resolved', 'dismissed'].includes(report.status)) return res.status(409).json({ message: 'تم اتخاذ قرار في هذا البلاغ مسبقاً' })
  if ((moderationAction === 'hide_product' && report.targetType !== 'product') ||
      (moderationAction === 'suspend_supplier' && report.targetType !== 'supplier')) {
    return res.status(400).json({ message: 'إجراء الإشراف لا يطابق نوع البلاغ' })
  }
  const target = moderationAction === 'hide_product' ? await Product.findById(report.targetId)
    : moderationAction === 'suspend_supplier' ? await Supplier.findOne({ _id: report.targetId, role: 'supplier' }) : null
  if (moderationAction !== 'none' && !target) return res.status(404).json({ message: 'الهدف المبلغ عنه لم يعد موجوداً' })
  await auditedChange({
    action: action === 'dismissed' ? 'REPORT_DISMISSED' : 'REPORT_RESOLVED',
    targetType: 'Report', targetId: report._id, actor: req.supplier,
    details: { resolutionNotes, moderationAction, targetType: report.targetType, targetId: report.targetId }
  }, async () => {
    if (moderationAction === 'hide_product') {
      await auditedChange({
        action: 'PRODUCT_MODERATED', targetType: 'Product', targetId: target._id,
        actor: req.supplier, details: { action: 'hide', reportId: report._id, reason: resolutionNotes }
      }, async () => {
        target.moderationStatus = 'hidden'
        target.moderationReason = resolutionNotes
        target.moderatedAt = new Date()
        target.moderatedBy = req.supplier.id
        await Product.updateOne({ _id: target._id }, { $set: {
          moderationStatus: target.moderationStatus, moderationReason: target.moderationReason,
          moderatedAt: target.moderatedAt, moderatedBy: target.moderatedBy
        } }, { runValidators: true })
      })
    } else if (moderationAction === 'suspend_supplier') {
      await auditedChange({
        action: 'ACCOUNT_STATUS_UPDATED', targetType: 'Supplier', targetId: target._id,
        actor: req.supplier, details: { isActive: false, reportId: report._id, reason: resolutionNotes }
      }, async () => {
        await Supplier.updateOne({ _id: target._id }, { $set: { isActive: false }, $inc: { tokenVersion: 1 } })
        await Store.updateMany({ supplierId: target._id }, { $set: { isActive: false, adminSuspended: true } })
      })
    }
    report.status = action
    report.resolutionNotes = resolutionNotes.trim()
    report.resolvedAt = new Date()
    report.resolvedBy = req.supplier.id
    report.moderationAction = moderationAction
    await report.save()
  })
  res.json({ message: 'تم حفظ قرار البلاغ وإجراء الإشراف', report })
}))

module.exports = router
