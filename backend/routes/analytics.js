const router = require('express').Router()
const mongoose = require('mongoose')
const Analytics = require('../models/Analytics')
const { authenticate, requireAdmin } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')

// Business totals come from Products/RFQ, never client-submitted analytics.
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { event, meta = {} } = req.body
  if (Object.keys(req.body).some(k => !['event', 'meta'].includes(k)) ||
      !['search', 'image_search', 'product_view'].includes(event) || !meta || Array.isArray(meta) || typeof meta !== 'object' ||
      Object.keys(meta).some(k => !['query', 'category', 'city', 'productId'].includes(k))) {
    return res.status(400).json({ message: 'حدث تحليلي غير مسموح أو بيانات غير صحيحة' })
  }
  for (const key of ['query', 'category', 'city']) {
    if (meta[key] !== undefined && (typeof meta[key] !== 'string' || meta[key].length > 120)) return res.status(400).json({ message: 'بيانات الحدث غير صحيحة' })
  }
  if (meta.productId !== undefined && !mongoose.isValidObjectId(meta.productId)) return res.status(400).json({ message: 'معرف المنتج غير صحيح' })
  await Analytics.create({ event, meta })
  res.status(201).json({ message: 'تم تسجيل الحدث' })
}))

router.get('/summary', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [total, byEvent] = await Promise.all([
    Analytics.countDocuments(), Analytics.aggregate([{ $group: { _id: '$event', count: { $sum: 1 } } }])
  ])
  res.json({ total, byEvent })
}))
module.exports = router
