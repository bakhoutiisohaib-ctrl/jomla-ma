const express = require('express')
const router = express.Router()
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const { authenticate } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

// 1. جلب قائمة المتاجر النشطة
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const { city, category } = req.query

  const filter = { isActive: true }
  if (city) filter.city = city
  if (category) filter.categories = category

  const stores = await Store.find(filter)
    .populate('supplierId', 'name isVerified verificationStatus iceNumber')
    .sort({ views: -1, createdAt: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Store.countDocuments(filter)

  res.json(formatPaginationResponse(stores, total, page, limit))
}))

// 2. جلب تفاصيل متجر معين مع منتجاته
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id)
    .populate('supplierId', 'name email phone isVerified verificationStatus iceNumber tradeRegistry')

  if (!store) {
    return res.status(404).json({ message: '❌ المتجر غير موجود' })
  }

  // تسجيل مشاهدة
  store.views = (store.views || 0) + 1
  await store.save().catch(() => {})

  const products = await Product.find({ supplierId: store.supplierId._id, inStock: true, isDraft: false })
    .sort({ createdAt: -1 })

  res.json({
    store,
    products
  })
}))

// 3. إنشاء متجر مستقل للمورد (يتطلب المصادقة كمورد)
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { name, description, city, address, phone, logoUrl, bannerUrl, categories } = req.body

  if (!name) {
    return res.status(400).json({ message: '⚠️ اسم المتجر التجاري مطلوب' })
  }

  const supplier = await Supplier.findById(req.supplier.id)
  if (!supplier) {
    return res.status(404).json({ message: '❌ المورد غير موجود' })
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-') + '-' + Math.floor(Math.random() * 1000)

  const store = new Store({
    supplierId: supplier._id,
    name: String(name).trim(),
    slug,
    description: description || '',
    city: city || supplier.city || 'الدار البيضاء',
    address: address || '',
    phone: phone || supplier.phone || '',
    logoUrl: logoUrl || '',
    bannerUrl: bannerUrl || '',
    categories: Array.isArray(categories) ? categories : ['عام'],
    isVerified: supplier.isVerified
  })

  await store.save()

  res.status(201).json({
    message: '✅ تم إنشاء المتجر التجاري بنجاح',
    store
  })
}))

// 4. تحديث بيانات المتجر
router.put('/:id', authenticate, validateMongoId, asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id)
  if (!store) {
    return res.status(404).json({ message: '❌ المتجر غير موجود' })
  }

  if (store.supplierId.toString() !== req.supplier.id && req.supplier.role !== 'admin') {
    return res.status(403).json({ message: '❌ ليس لديك صلاحية تعديل هذا المتجر' })
  }

  const allowedUpdates = ['name', 'description', 'city', 'address', 'phone', 'logoUrl', 'bannerUrl', 'categories', 'isActive']
  allowedUpdates.forEach(key => {
    if (req.body[key] !== undefined) store[key] = req.body[key]
  })

  await store.save()

  res.json({
    message: '✅ تم تحديث بيانات المتجر بنجاح',
    store
  })
}))

module.exports = router
