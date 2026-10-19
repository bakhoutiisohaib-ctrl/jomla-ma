const express = require('express')
const router = express.Router()
const SourcingRequest = require('../models/SourcingRequest')
const QuoteRequest = require('../models/QuoteRequest')
const { authenticate } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Sourcing
 *     description: B2B wholesale sourcing requests for out-of-catalog products
 */

// تقديم طلب توريد خاص (مشتري مهني يبحث عن منتج غير متوفر)
router.post('/', asyncHandler(async (req, res) => {
  const { buyerName, buyerPhone, buyerCity, productName, category, quantity, unit, targetPrice, imageUrl, notes } = req.body

  if (!buyerName || !buyerPhone || !productName || !quantity) {
    return res.status(400).json({
      message: '⚠️ يرجى ملء الحقول الإلزامية: اسم المشتري، رقم الهاتف، اسم المنتج، والكمية المطلوبة'
    })
  }

  const sourcing = new SourcingRequest({
    buyerName: String(buyerName).trim(),
    buyerPhone: String(buyerPhone).trim(),
    buyerCity: buyerCity ? String(buyerCity).trim() : 'المغرب',
    productName: String(productName).trim(),
    category: category ? String(category).trim() : 'عام',
    quantity: Number(quantity),
    unit: unit ? String(unit).trim() : 'قطعة',
    targetPrice: targetPrice ? Number(targetPrice) : undefined,
    imageUrl: imageUrl ? String(imageUrl).trim() : undefined,
    notes: notes ? String(notes).trim() : ''
  })

  await sourcing.save()

  // رابط واتساب للمتابعة السريعة مع إدارة المنصة
  const whatsappMsg = `طلب توريد جديد على Jomla.ma:\nالمنتج: ${sourcing.productName}\nالكمية: ${sourcing.quantity} ${sourcing.unit}\nالمشتري: ${sourcing.buyerName} (${sourcing.buyerCity})\nالهاتف: ${sourcing.buyerPhone}`
  const whatsappLink = `https://wa.me/212600000000?text=${encodeURIComponent(whatsappMsg)}`

  res.status(201).json({
    message: '✅ تم تسجيل طلب التوريد بنجاح! سيتم بثه للموردين المعتمدين لتلقي عروض الأسعار.',
    sourcing,
    whatsappFollowup: whatsappLink
  })
}))

// جلب طلبات التوريد المفتوحة في السوق (للموردين لتصفح فرص التوريد)
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const { status = 'open', category } = req.query

  const filter = {}
  if (status && status !== 'all') filter.status = status
  if (category) filter.category = category

  const requests = await SourcingRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)

  const total = await SourcingRequest.countDocuments(filter)

  res.json(formatPaginationResponse(requests, total, page, limit))
}))

// جلب تفاصيل طلب توريد معين
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const sourcing = await SourcingRequest.findById(req.params.id)
  if (!sourcing) {
    return res.status(404).json({ message: '❌ طلب التوريد غير موجود' })
  }
  res.json(sourcing)
}))

// قيام مورد بتقديم عرض سعر لطلب التوريد (يتطلب تسجيل دخول المورد)
router.post('/:id/quote', authenticate, validateMongoId, asyncHandler(async (req, res) => {
  const { unitPrice, deliveryDays, notes } = req.body

  if (!unitPrice) {
    return res.status(400).json({ message: '⚠️ سعر الوحدة المعروض مطلوب' })
  }

  const sourcing = await SourcingRequest.findById(req.params.id)
  if (!sourcing) {
    return res.status(404).json({ message: '❌ طلب التوريد غير موجود' })
  }

  sourcing.quotesCount += 1
  sourcing.status = 'quoted'
  await sourcing.save()

  // إنشاء رابط واتساب للتواصل المباشر مع المشتري
  const quoteText = `السلام عليكم ${sourcing.buyerName}، اطلعت على طلب التوريد لـ "${sourcing.productName}" على Jomla.ma.\nعرضنا بالجملة:\n- سعر الوحدة: ${unitPrice} درهم\n- مدة التسليم: ${deliveryDays || 3} أيام\n- الملاحظات: ${notes || 'جاهز للتسليم'}`
  const buyerWhatsapp = `https://wa.me/${sourcing.buyerPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(quoteText)}`

  res.json({
    message: '✅ تم تسجيل عرض التوريد بنجاح! يمكنك الآن التواصل مباشرة مع المشتري.',
    sourcing,
    buyerWhatsapp
  })
}))

module.exports = router
