const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const Supplier = require('../models/Supplier')
const Product  = require('../models/Product')
const { authenticate, generateToken } = require('../middleware/auth')
const { validateSupplierRegister, validateSupplierLogin, validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Suppliers
 *     description: Supplier registration and management
 */

/**
 * @swagger
 * /api/suppliers:
 *   get:
 *     summary: Get paginated list of suppliers
 *     tags: [Suppliers]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated suppliers
 * /api/suppliers/register:
 *   post:
 *     summary: Register a new supplier
 *     tags: [Suppliers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               city:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: Supplier created and token returned
 * /api/suppliers/login:
 *   post:
 *     summary: Login supplier
 *     tags: [Suppliers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login success with token
 */

// جيب جميع المورّدين
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  
  const suppliers = await Supplier.find()
    .select('-password')
    .limit(limit)
    .skip(skip)
  
  const total = await Supplier.countDocuments()
  
  res.json(formatPaginationResponse(suppliers, total, page, limit))
}))

// جيب مورد معين
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id).select('-password')
  if (!supplier) {
    return res.status(404).json({ message: '❌ المورد غير موجود' })
  }
  res.json(supplier)
}))

// تسجيل مورد جديد
router.post('/register', validateSupplierRegister, asyncHandler(async (req, res) => {
  const { name, city, phone, description, email, password } = req.body

  // التحقق من عدم وجود بريد مسجل مسبقاً
  const existing = await Supplier.findOne({ email })
  if (existing) {
    return res.status(409).json({ message: '❌ البريد الإلكتروني موجود بالفعل' })
  }

  // تشفير كلمة المرور
  const hashedPassword = await bcrypt.hash(password, 10)

  // إنشاء المورد الجديد
  const supplier = new Supplier({
    name,
    city,
    phone,
    description: description || '',
    email,
    password: hashedPassword,
    products: []
  })

  await supplier.save()

  // توليد التوكن
  const token = generateToken(supplier)

  res.status(201).json({
    message: '✅ تم تسجيل المورد بنجاح',
    token,
    supplier: {
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      city: supplier.city,
      phone: supplier.phone
    }
  })
}))

// تسجيل دخول مورد
router.post('/login', validateSupplierLogin, asyncHandler(async (req, res) => {
  const { email, password } = req.body

  // البحث عن المورد
  const supplier = await Supplier.findOne({ email })
  if (!supplier) {
    return res.status(401).json({ message: '❌ بيانات الدخول غير صحيحة' })
  }

  // التحقق من كلمة المرور
  const isPasswordValid = await bcrypt.compare(password, supplier.password)
  if (!isPasswordValid) {
    return res.status(401).json({ message: '❌ بيانات الدخول غير صحيحة' })
  }

  // توليد التوكن
  const token = generateToken(supplier)

  res.json({
    message: '✅ تم تسجيل الدخول بنجاح',
    token,
    supplier: {
      id: supplier._id,
      name: supplier.name,
      email: supplier.email,
      city: supplier.city,
      phone: supplier.phone
    }
  })
}))

// جيب منتجات مورد معين
router.get('/:id/products', validateMongoId, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  
  const products = await Product.find({ supplierId: req.params.id })
    .limit(limit)
    .skip(skip)
  
  const total = await Product.countDocuments({ supplierId: req.params.id })
  
  res.json(formatPaginationResponse(products, total, page, limit))
}))

// جلب بيانات المورد المسجل (الملف الشخصي) - يتطلب توكن
router.get('/me/profile', authenticate, asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.supplier.id).select('-password')
  if (!supplier) return res.status(404).json({ message: '❌ المورد غير موجود' })
  res.json(supplier)
}))

// إضافة منتج جديد مع رفع صور - يتطلب توكن
const upload = require('../middleware/upload')

router.post('/me/products', authenticate, upload.array('images', 6), asyncHandler(async (req, res) => {
  const { name, category, price, city, supplierPhone, description } = req.body
  const supplierId = req.supplier.id

  const images = (req.files || []).map(f => `/uploads/${f.filename}`)

  const product = new Product({
    name,
    category,
    price: price ? Number(price) : undefined,
    city,
    supplierPhone: supplierPhone || '',
    description: description || '',
    images,
    imageUrl: images.length ? images[0] : undefined,
    supplierId
  })

  await product.save()
  await Supplier.findByIdAndUpdate(supplierId, { $push: { products: product._id } })

  res.status(201).json({ message: '✅ تم إضافة المنتج', product })
}))

// جلب الطلبات المرتبطة بالمورد (stub يعتمد على نموذج Order إن وُجد)
router.get('/me/orders', authenticate, asyncHandler(async (req, res) => {
  const Order = require('../models/Order')
  const { page, limit, skip } = getPaginationParams(req)
  const filter = { supplierId: req.supplier.id }
  if (req.query.status) filter.status = req.query.status
  if (req.query.from || req.query.to) {
    filter.createdAt = {}
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from)
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to)
  }

  const orders = await Order.find(filter).limit(limit).skip(skip).sort({ createdAt: -1 })
  const total = await Order.countDocuments(filter)
  res.json(formatPaginationResponse(orders, total, page, limit))
}))

// تحديث حالة طلب (المورد يمكنه تغيير الحالة) - يتطلب توكن
router.patch('/me/orders/:orderId/status', authenticate, asyncHandler(async (req, res) => {
  const { orderId } = req.params
  const { status } = req.body
  const allowed = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']
  if (!allowed.includes(status)) return res.status(400).json({ message: 'حالة غير صحيحة' })

  const Order = require('../models/Order')
  const order = await Order.findOne({ _id: orderId, supplierId: req.supplier.id })
  if (!order) return res.status(404).json({ message: '❌ الطلب غير موجود' })

  order.status = status
  await order.save()

  res.json({ message: '✅ تم تحديث حالة الطلب', order })
}))

// جلب التعليقات على منتجات المورد
router.get('/me/reviews', authenticate, asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const Review = require('../models/Review')
  const reviews = await Review.find({ supplierId: req.supplier.id }).limit(limit).skip(skip)
  const total = await Review.countDocuments({ supplierId: req.supplier.id })
  res.json(formatPaginationResponse(reviews, total, page, limit))
}))

// حذف تعليق (المورد يستطيع حذف تعليقات على منتجاته)
router.delete('/me/reviews/:id', authenticate, asyncHandler(async (req, res) => {
  const Review = require('../models/Review')
  const review = await Review.findById(req.params.id)
  if (!review) return res.status(404).json({ message: '❌ التعليق غير موجود' })
  if (String(review.supplierId) !== String(req.supplier.id)) return res.status(403).json({ message: 'غير مصرح' })
  await Review.findByIdAndDelete(req.params.id)
  res.json({ message: '✅ تم حذف التعليق' })
}))

// رد المورد على تعليق
router.post('/me/reviews/:id/reply', authenticate, asyncHandler(async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ message: 'النص مطلوب' })
  const Review = require('../models/Review')
  const review = await Review.findById(req.params.id)
  if (!review) return res.status(404).json({ message: '❌ التعليق غير موجود' })
  if (String(review.supplierId) !== String(req.supplier.id)) return res.status(403).json({ message: 'غير مصرح' })

  review.reply = { text, date: new Date() }
  await review.save()
  res.json({ message: '✅ تم إضافة الرد', review })
}))

// تحليل بسيط للسوق: إجمالي المنتجات، متوسط السعر، أكثر فئة
router.get('/me/analytics', authenticate, asyncHandler(async (req, res) => {
  const supplierId = req.supplier.id
  const stats = await Product.aggregate([
    { $match: { supplierId: require('mongoose').Types.ObjectId(supplierId) } },
    { $group: { _id: '$category', count: { $sum: 1 }, avgPrice: { $avg: '$price' } } },
    { $sort: { count: -1 } }
  ])

  const totalProducts = await Product.countDocuments({ supplierId })

  res.json({ totalProducts, categoryStats: stats })
}))

// تحليل ذكي مبسّط: مقارنة متوسط سعر المورد بمتوسط السوق لكل فئة
router.get('/me/analytics/details', authenticate, asyncHandler(async (req, res) => {
  const mongoose = require('mongoose')
  const supplierId = mongoose.Types.ObjectId(req.supplier.id)

  // متوسط سعر المورد لكل فئة
  const supplierStats = await Product.aggregate([
    { $match: { supplierId } },
    { $group: { _id: '$category', supplierAvg: { $avg: '$price' }, supplierCount: { $sum: 1 } } }
  ])

  // متوسط سعر السوق (كل الموردين) لكل فئة
  const marketStats = await Product.aggregate([
    { $group: { _id: '$category', marketAvg: { $avg: '$price' }, marketCount: { $sum: 1 } } }
  ])

  // دمج النتائج وحساب الفجوة
  const marketMap = {}
  marketStats.forEach(m => { marketMap[m._id] = m })

  const analysis = supplierStats.map(s => {
    const market = marketMap[s._id] || { marketAvg: null, marketCount: 0 }
    const gap = market.marketAvg ? ((s.supplierAvg - market.marketAvg) / market.marketAvg) * 100 : null
    return {
      category: s._id,
      supplierAvg: s.supplierAvg,
      supplierCount: s.supplierCount,
      marketAvg: market.marketAvg,
      marketCount: market.marketCount,
      gapPercentage: gap
    }
  })

  res.json({ analysis })
}))

// تحديث بيانات المورد
router.put('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(
    req.params.id, req.body, { new: true }
  )
  if (!supplier) {
    return res.status(404).json({ message: '❌ المورد غير موجود' })
  }
  res.json({ message: '✅ تم التحديث', supplier })
}))

module.exports = router
