const express = require('express')
const router  = express.Router()
const QuoteRequest = require('../models/QuoteRequest')
const Product = require('../models/Product')
const { authenticate } = require('../middleware/auth')
const { body, validationResult } = require('express-validator')
const { asyncHandler } = require('../middleware/errorHandler')

// Validator لطلب عرض السعر
const validateRFQ = [
  body('productId').notEmpty().withMessage('معرف المنتج مطلوب'),
  body('buyerName').notEmpty().isLength({ min: 2 }).withMessage('اسم المشتري مطلوب'),
  body('buyerPhone').notEmpty().matches(/^[+0-9\s\-()]{8,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('quantity').isInt({ min: 1 }).withMessage('الكمية يجب أن تكون 1 على الأقل'),
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: '❌ بيانات غير صحيحة',
        errors: errors.array().map(e => ({ field: e.param || e.path, message: e.msg }))
      })
    }
    next()
  }
]

/**
 * @swagger
 * tags:
 *   - name: RFQ
 *     description: B2B Request For Quotation management
 */

// 1. تقديم طلب عرض سعر جديد (متاح للمشترين)
router.post('/', validateRFQ, asyncHandler(async (req, res) => {
  const { productId, buyerName, buyerPhone, buyerCity, quantity, targetPrice, notes } = req.body

  const product = await Product.findById(productId)
  if (!product) {
    return res.status(404).json({ message: '❌ المنتج غير موجود' })
  }

  const rfq = new QuoteRequest({
    productId,
    supplierId: product.supplierId,
    buyerName,
    buyerPhone,
    buyerCity: buyerCity || '',
    quantity: Number(quantity),
    targetPrice: targetPrice ? Number(targetPrice) : null,
    notes: notes || '',
    status: 'pending'
  })

  await rfq.save()

  res.status(201).json({
    message: '✅ تم إرسال طلب عرض السعر (RFQ) بنجاح للمورد',
    rfq
  })
}))

// 2. جلب جميع طلبات عروض الأسعار الواردة للمورد (يتطلب المصادقة)
router.get('/supplier', authenticate, asyncHandler(async (req, res) => {
  const rfqs = await QuoteRequest.find({ supplierId: req.supplier.id })
    .populate('productId', 'name imageUrl price moq unit category')
    .sort({ createdAt: -1 })

  const pendingCount = rfqs.filter(r => r.status === 'pending').length
  const respondedCount = rfqs.filter(r => r.status === 'responded').length

  res.json({
    data: rfqs,
    counts: {
      total: rfqs.length,
      pending: pendingCount,
      responded: respondedCount
    }
  })
}))

// 3. رد المورد على طلب عرض السعر (يتطلب المصادقة)
router.put('/:id/respond', authenticate, asyncHandler(async (req, res) => {
  const { unitPrice, deliveryDays, notes, status } = req.body

  const rfq = await QuoteRequest.findById(req.params.id)
  if (!rfq) {
    return res.status(404).json({ message: '❌ طلب عرض السعر غير موجود' })
  }

  // التحقق من ملكية المورد للطلب
  if (rfq.supplierId.toString() !== req.supplier.id) {
    return res.status(403).json({ message: '❌ ليس لديك صلاحية للرد على هذا الطلب' })
  }

  const newStatus = status === 'rejected' ? 'rejected' : 'responded'

  if (newStatus === 'responded') {
    if (!unitPrice || Number(unitPrice) <= 0) {
      return res.status(400).json({ message: '❌ سعر الوحدة المقترح مطلوب ويجب أن يكون أكبر من صفر' })
    }

    const price = Number(unitPrice)
    rfq.offer = {
      unitPrice: price,
      totalPrice: price * rfq.quantity,
      deliveryDays: deliveryDays ? Number(deliveryDays) : 3,
      notes: notes || '',
      respondedAt: new Date()
    }
  }

  rfq.status = newStatus
  await rfq.save()

  res.json({
    message: newStatus === 'rejected' ? 'تم رفض طلب عرض السعر' : '✅ تم إرسال عرض السعر بنجاح للمشتري',
    rfq
  })
}))

// 4. استعلام المشتري عن حالة طلب عرض السعر برقم المعرف
router.get('/:id', asyncHandler(async (req, res) => {
  const rfq = await QuoteRequest.findById(req.params.id)
    .populate('productId', 'name imageUrl price moq unit category city')
    .populate('supplierId', 'name phone city')

  if (!rfq) {
    return res.status(404).json({ message: '❌ طلب عرض السعر غير موجود' })
  }

  res.json(rfq)
}))

module.exports = router
