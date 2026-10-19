const express = require('express')
const router  = express.Router()
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
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

  // إنشاء قناة محادثة وتفاوض فورية للطلب (MessageThread)
  const thread = new MessageThread({
    rfqId: rfq._id,
    productId,
    supplierId: product.supplierId,
    buyerName,
    buyerPhone,
    subject: `طلب عرض سعر #${String(rfq._id).slice(-6)} - ${product.name}`,
    messages: [{
      senderRole: 'buyer',
      senderName: buyerName,
      senderPhone: buyerPhone,
      content: notes ? `الكمية المطلوبة: ${quantity} ${product.unit || 'قطعة'}. ملاحظات: ${notes}` : `الكمية المطلوبة: ${quantity} ${product.unit || 'قطعة'}`
    }]
  })
  await thread.save()

  res.status(201).json({
    message: '✅ تم إرسال طلب عرض السعر (RFQ) بنجاح للمورد',
    rfq,
    threadId: thread._id
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

    // حفظ عرض السعر المستقل (QuoteOffer) لدعم تاريخ العروض والتفاوض
    const quoteOffer = new QuoteOffer({
      rfqId: rfq._id,
      supplierId: rfq.supplierId,
      unitPrice: price,
      totalPrice: price * rfq.quantity,
      quantity: rfq.quantity,
      deliveryDays: deliveryDays ? Number(deliveryDays) : 3,
      notes: notes || '',
      status: 'active'
    })
    await quoteOffer.save()

    // تحديث وإشعار في قناة المحادثة (MessageThread)
    await MessageThread.findOneAndUpdate(
      { rfqId: rfq._id },
      {
        $push: {
          messages: {
            senderRole: 'supplier',
            senderName: req.supplier.name || 'المورد',
            content: `عرض السعر المقدم: ${price} درهم / وحدة (المجموع: ${price * rfq.quantity} درهم). التسليم خلال ${deliveryDays || 3} أيام. ${notes || ''}`
          }
        },
        $set: { lastMessageAt: new Date() }
      }
    )
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

// 5. قبول أو رفض المشتري لعرض السعر المقدم من المورد (دورة RFQ المكتملة)
router.put('/:id/action', asyncHandler(async (req, res) => {
  const { action } = req.body // 'accept' أو 'reject'
  const rfq = await QuoteRequest.findById(req.params.id)
    .populate('productId', 'name')
    .populate('supplierId', 'name phone')

  if (!rfq) {
    return res.status(404).json({ message: '❌ طلب عرض السعر غير موجود' })
  }

  if (rfq.status !== 'responded') {
    return res.status(400).json({ message: '⚠️ لا يمكن اتخاذ إجراء إلا على العروض التي قدم المورد سعراً لها' })
  }

  const isAccepted = action === 'accept'
  rfq.status = isAccepted ? 'accepted' : 'rejected'
  await rfq.save()

  // تحديث حالة العرض المستقل
  await QuoteOffer.findOneAndUpdate(
    { rfqId: rfq._id, status: 'active' },
    { status: isAccepted ? 'accepted' : 'rejected' }
  )

  // تسجيل القرار في المحادثة
  await MessageThread.findOneAndUpdate(
    { rfqId: rfq._id },
    {
      $push: {
        messages: {
          senderRole: 'buyer',
          senderName: rfq.buyerName,
          content: isAccepted ? '🎉 قبلت عرض السعر المقدم، جاهز لإتمام الصفقة!' : '❌ تم رفض عرض السعر الحالي.'
        }
      },
      $set: { lastMessageAt: new Date() }
    }
  )

  const whatsappSupplier = isAccepted && rfq.supplierId?.phone
    ? `https://wa.me/${rfq.supplierId.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
        `السلام عليكم، أنا المشتري ${rfq.buyerName}. لقد قبلت عرض سعركم لطلب #${String(rfq._id).slice(-6)} لمنتج "${rfq.productId?.name}" بسعر ${rfq.offer?.unitPrice} درهم. يرجى التنسيق لبدء التجهيز والتوصيل.`
      )}`
    : null

  res.json({
    message: isAccepted ? '🎉 مبروك! تم قبول عرض السعر بنجاح، يمكنك الآن التواصل مباشرة لإتمام الصفقة.' : 'تم رفض عرض السعر.',
    rfq,
    whatsappSupplier
  })
}))

// 6. جلب سجل المحادثة الثنائية وعروض الأسعار المستقلة للطلب (MessageThread & QuoteOffers)
router.get('/:id/thread', asyncHandler(async (req, res) => {
  const thread = await MessageThread.findOne({ rfqId: req.params.id })
  const offers = await QuoteOffer.find({ rfqId: req.params.id }).sort({ createdAt: -1 })

  res.json({
    thread,
    offers
  })
}))

// 7. إرسال رسالة جديدة في محادثة التفاوض الثنائية
router.post('/:id/messages', asyncHandler(async (req, res) => {
  const { content, senderRole, senderName, senderPhone } = req.body
  if (!content) {
    return res.status(400).json({ message: '⚠️ نص الرسالة مطلوب' })
  }

  let thread = await MessageThread.findOne({ rfqId: req.params.id })
  if (!thread) {
    return res.status(404).json({ message: '❌ محادثة الطلب غير موجودة' })
  }

  thread.messages.push({
    senderRole: senderRole || 'buyer',
    senderName: senderName || 'المشتري',
    senderPhone: senderPhone || '',
    content: String(content).trim()
  })
  thread.lastMessageAt = new Date()
  await thread.save()

  res.status(201).json({
    message: '✅ تم إرسال الرسالة بنجاح',
    thread
  })
}))

module.exports = router
