const express = require('express')
const router  = express.Router()
const multer  = require('multer')
const vision  = require('@google-cloud/vision')
const Product = require('../models/Product')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: ImageSearch
 *     description: Search products by image (Google Vision)
 */

/**
 * @swagger
 * /api/image-search:
 *   post:
 *     summary: Upload an image to search for similar products
 *     tags: [ImageSearch]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Search results with detected labels
 */

const upload = multer({ storage: multer.memoryStorage() })

const client = new vision.ImageAnnotatorClient({
  apiKey: process.env.GOOGLE_VISION_KEY
})

router.post('/', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '❌ الصورة مطلوبة' })
  }

  if (!process.env.GOOGLE_VISION_KEY) {
    return res.status(500).json({ message: '❌ Google Vision API غير مشغلة' })
  }

  const [result] = await client.labelDetection({
    image: { content: req.file.buffer.toString('base64') }
  })

  const labels = result.labelAnnotations
    .slice(0, 8)
    .map(l => l.description.toLowerCase())

  console.log('🔍 Labels:', labels)

  const translations = {
    'shoe': 'صباط', 'shoes': 'صباط', 'sneaker': 'صباط', 'footwear': 'صباط',
    'shirt': 'قميص', 't-shirt': 'قميص', 'clothing': 'ملابس', 'dress': 'فستان',
    'pants': 'سروال', 'jeans': 'جينز', 'jacket': 'جاكيت',
    'bag': 'حقيبة', 'handbag': 'حقيبة', 'backpack': 'حقيبة',
    'glasses': 'نظارات', 'sunglasses': 'نظارات',
    'watch': 'ساعة', 'jewelry': 'مجوهرات',
    'hat': 'قبعة', 'cap': 'قبعة'
  }

  const searchWords = []
  labels.forEach(label => {
    if (translations[label]) searchWords.push(translations[label])
  })

  const finalWords = searchWords.length > 0 ? searchWords : labels.slice(0, 3)

  const { page, limit, skip } = getPaginationParams(req)

  const regexList = finalWords.map(w => new RegExp(escapeRegex(w), 'i'))
  let products = await Product.find({ name: { $in: regexList } })
    .limit(limit)
    .skip(skip)

  if (products.length === 0) {
    products = await Product.find()
      .sort({ views: -1 })
      .limit(limit)
      .skip(skip)
  }

  const total = products.length === 0 ? 0 : await Product.countDocuments({ name: { $in: regexList } })

  res.json({
    message: '✅ تم تحليل الصورة',
    labels: finalWords,
    ...formatPaginationResponse(products, total || 0, page, limit),
    description: finalWords.length > 0
      ? `وجدنا ${products.length} منتج مشابه لـ: ${finalWords.join('، ')}`
      : 'ما عرفناش الصورة — هاهو أشهر المنتجات'
  })
}))

module.exports = router
