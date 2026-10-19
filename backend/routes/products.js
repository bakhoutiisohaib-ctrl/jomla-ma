const express  = require('express')
const router   = express.Router()
const Product  = require('../models/Product')
const Supplier = require('../models/Supplier')
const { authenticate } = require('../middleware/auth')
const { validateProduct, validateProductUpdate, validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: Product management and search
 */

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Retrieve a paginated list of products
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page (default 10)
 *     responses:
 *       200:
 *         description: A paginated list of products
 *   post:
 *     summary: Create a new product (requires authentication)
 *     tags: [Products]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               price:
 *                 type: number
 *               city:
 *                 type: string
 *               description:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *     responses:
 *       201:
 *         description: Product created
 */

// جيب المنتجات (مع pagination)
const { cacheMiddleware } = require('../middleware/cache')

router.get('/', cacheMiddleware(20), asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)

  const products = await Product.find()
    .select('name price city category supplierId supplierPhone views moq unit priceTiers inStock imageUrl description createdAt')
    .populate('supplierId', 'name city phone isVerified verificationStatus')
    .sort({ views: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Product.countDocuments()

  res.json(formatPaginationResponse(products, total, page, limit))
}))

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Update a product (requires authentication)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               category:
 *                 type: string
 *               price:
 *                 type: number
 *               city:
 *                 type: string
 *               description:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Product updated
 *   delete:
 *     summary: Delete a product (requires authentication)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted
 */

// إضافة منتج جديد (يتطلب المصادقة)
router.post('/', authenticate, validateProduct, asyncHandler(async (req, res) => {
  let supplierPhone = req.body.supplierPhone
  if (!supplierPhone && req.supplier?.id) {
    const s = await Supplier.findById(req.supplier.id)
    if (s) supplierPhone = s.phone
  }

  const product = new Product({
    ...req.body,
    supplierId: req.supplier.id,
    supplierPhone: supplierPhone || ''
  })

  await product.save()

  // ربط المنتج بحساب المورد
  if (req.supplier?.id) {
    await Supplier.findByIdAndUpdate(req.supplier.id, {
      $addToSet: { products: product._id }
    })
  }

  res.status(201).json({
    message: '✅ تم إضافة المنتج بنجاح',
    product
  })
}))

// تحديث منتج (يتطلب المصادقة)
router.put('/:id', authenticate, validateMongoId, validateProductUpdate, asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)

  if (!product) {
    return res.status(404).json({ message: '❌ المنتج غير موجود' })
  }

  // التحقق من أن المورد هو صاحب المنتج
  if ((product.supplierId && product.supplierId.toString()) !== req.supplier.id) {
    return res.status(403).json({ message: '❌ ليس لديك صلاحية لتعديل هذا المنتج' })
  }

  // تحديث البيانات المسموحة
  const { name, category, price, city, description, imageUrl, moq, unit, priceTiers, inStock } = req.body
  if (name !== undefined) product.name = name
  if (category !== undefined) product.category = category
  if (price !== undefined) product.price = price
  if (city !== undefined) product.city = city
  if (description !== undefined) product.description = description
  if (imageUrl !== undefined) product.imageUrl = imageUrl
  if (moq !== undefined) product.moq = moq
  if (unit !== undefined) product.unit = unit
  if (priceTiers !== undefined) product.priceTiers = priceTiers
  if (inStock !== undefined) product.inStock = inStock

  await product.save()

  res.json({
    message: '✅ تم تحديث المنتج بنجاح',
    product
  })
}))

// حذف منتج (يتطلب المصادقة)
router.delete('/:id', authenticate, validateMongoId, asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)

  if (!product) {
    return res.status(404).json({ message: '❌ المنتج غير موجود' })
  }

  // التحقق من أن المورد هو صاحب المنتج
  if ((product.supplierId && product.supplierId.toString()) !== req.supplier.id) {
    return res.status(403).json({ message: '❌ ليس لديك صلاحية لحذف هذا المنتج' })
  }

  await Product.findByIdAndDelete(req.params.id)

  res.json({
    message: '✅ تم حذف المنتج بنجاح'
  })
}))

// دالة تحليل البحث الذكي
function parseQuery(query) {
  const raw = typeof query === 'string' ? query : String(query || '')
  const cities = ['فاس', 'طنجة', 'كازا', 'الدار البيضاء', 'مراكش', 'أكادير', 'الرباط', 'مكناس']
  const cheapWords = ['رخيص', 'رخيصة', 'أرخص', 'قليل', 'بسيط']
  const expWords = ['غالي', 'غالية', 'جودة', 'فاخر']
  const synonyms = {
    'صباط': ['شوز', 'سباط', 'حذاء'],
    'شوز': ['صباط', 'سباط', 'حذاء'],
    'تيشورت': ['قميص', 'تيشرت'],
    'پانطالون': ['سروال', 'جينز'],
  }

  let city = null
  let isCheap = false
  let isExpensive = false

  // استخراج المدينة
  cities.forEach(c => { if (raw.includes(c)) city = c })

  // استخراج نية السعر
  cheapWords.forEach(w => { if (raw.includes(w)) isCheap = true })
  expWords.forEach(w => { if (raw.includes(w)) isExpensive = true })

  // تنظيف الجملة
  let clean = raw
  ;[...cities, ...cheapWords, ...expWords].forEach(w => {
    clean = clean.split(w).join('')
  })
  clean = clean.replace(/في|ف|من|بحال/g, '').trim()

  // توسيع الكلمات المشابهة
  let searchWords = [clean]
  Object.entries(synonyms).forEach(([key, vals]) => {
    if (clean.includes(key)) searchWords = [...searchWords, ...vals]
    vals.forEach(v => { if (clean.includes(v)) searchWords = [...searchWords, key, ...vals] })
  })
  searchWords = [...new Set(searchWords.filter(w => w && w.length > 0))]

  return { searchWords, city, isCheap, isExpensive, original: clean }
}

// بحث ذكي
router.get('/search', asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100).trim() : ''
  const { page, limit, skip } = getPaginationParams(req)

  if (!q) {
    const all = await Product.find()
      .sort({ views: -1 })
      .limit(limit)
      .skip(skip)
    
    const total = await Product.countDocuments()
    return res.json(formatPaginationResponse(all, total, page, limit))
  }

  const parsed = parseQuery(q)
  const searchTerms = parsed.searchWords.filter(Boolean)
  const regexes = searchTerms.map(w => new RegExp(escapeRegex(w), 'i'))

  const filter = {}
  if (regexes.length > 0) {
    filter.$or = [
      { name: { $in: regexes } },
      { category: { $in: regexes } }
    ]
  } else {
    filter.name = { $regex: escapeRegex(q), $options: 'i' }
  }
  if (parsed.city) filter.city = { $regex: escapeRegex(parsed.city), $options: 'i' }

  let results = await Product.find(filter)
    .select('name price city category supplierId supplierPhone views moq unit priceTiers inStock imageUrl description createdAt')
    .populate('supplierId', 'name city phone isVerified verificationStatus')
    .sort({ views: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Product.countDocuments(filter)

  results = results.sort((a, b) => {
    let scoreA = a.views || 0
    let scoreB = b.views || 0

    if (parsed.isCheap) {
      scoreA -= a.price * 0.1
      scoreB -= b.price * 0.1
    }
    if (parsed.isExpensive) {
      scoreA += a.price * 0.1
      scoreB += b.price * 0.1
    }

    return scoreB - scoreA
  })

  res.json(formatPaginationResponse(results, total, page, limit))
}))

module.exports = router
