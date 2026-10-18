const express    = require('express')
const router     = express.Router()
const multer     = require('multer')
const cloudinary = require('cloudinary').v2
const Anthropic  = require('@anthropic-ai/sdk')
const { authenticate } = require('../middleware/auth')
const { body, validationResult } = require('express-validator')
const { asyncHandler } = require('../middleware/errorHandler')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const claude  = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
const upload  = multer({ storage: multer.memoryStorage() })

console.log('Loaded productAI route with Cloudinary:', !!process.env.CLOUDINARY_CLOUD_NAME, 'Claude:', !!process.env.CLAUDE_API_KEY)

/**
 * @swagger
 * tags:
 *   - name: ProductAI
 *     description: Product image enhancement and AI-generated descriptions
 */

/**
 * @swagger
 * /api/product-ai/ping:
 *   get:
 *     summary: Health check for product AI route
 *     tags: [ProductAI]
 *     responses:
 *       200:
 *         description: OK
 * /api/product-ai/enhance:
 *   post:
 *     summary: Enhance an uploaded product image and generate description (requires auth)
 *     tags: [ProductAI]
 *     security:
 *       - bearerAuth: []
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
 *               productName:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Enhanced image and AI-generated data
 */

// Health check
router.get('/ping', (req, res) => {
  res.json({ ok: true, route: '/api/product-ai/ping' })
})

// Validator
const validateEnhance = [
  body('productName')
    .notEmpty().withMessage('اسم المنتج مطلوب')
    .isLength({ min: 2 }).withMessage('اسم المنتج قصير جداً'),
  body('category')
    .notEmpty().withMessage('الفئة مطلوبة'),
  (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: '❌ بيانات غير صحيحة',
        errors: errors.array()
      })
    }
    next()
  }
]

// تحسين الصورة وتوليد الوصف
router.post('/enhance', authenticate, upload.single('image'), validateEnhance, asyncHandler(async (req, res) => {
  const { productName, category } = req.body

  // التحقق من الصورة
  if (!req.file) {
    return res.status(400).json({ message: '❌ الصورة مطلوبة' })
  }

  // التحقق من المتغيرات البيئية
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const cloudKey = process.env.CLOUDINARY_API_KEY
  const cloudSecret = process.env.CLOUDINARY_API_SECRET
  const claudeKey = process.env.CLAUDE_API_KEY

  if (!cloudName || cloudName.includes('your') || cloudName === 'your_cloud_name') {
    return res.status(500).json({ message: '❌ Cloudinary Cloud Name غير مشغّل' })
  }

  if (!cloudKey || cloudKey.includes('your') || cloudKey === 'your_api_key') {
    return res.status(500).json({ message: '❌ Cloudinary API Key غير صحيح' })
  }

  if (!cloudSecret || cloudSecret.includes('YOUR') || cloudSecret === 'YOUR_API_SECRET_HERE') {
    return res.status(500).json({ message: '❌ Cloudinary API Secret غير صحيح' })
  }

  if (!claudeKey || claudeKey.includes('YOUR') || claudeKey === 'sk-ant-YOUR_CLAUDE_API_KEY_HERE') {
    return res.status(500).json({ message: '❌ Claude API Key غير صحيح' })
  }

  // 1 — رفع الصورة على Cloudinary مع تحسين تلقائي
  const uploadResult = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: 'jomla-ma',
        resource_type: 'auto',
        transformation: [
          { quality: 'auto:best' },
          { fetch_format: 'auto' },
          { width: 800, height: 800, crop: 'fill', gravity: 'auto' },
          { effect: 'improve:outdoor:20' },
          { effect: 'sharpen:100' }
        ]
      },
      (err, result) => err ? reject(err) : resolve(result)
    ).end(req.file.buffer)
  })

  // 2 — Claude يحلل الصورة ويكتب وصف احترافي
  const imageBase64 = req.file.buffer.toString('base64')
  const mimeType    = req.file.mimetype

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: imageBase64 }
        },
        {
          type: 'text',
          text: `أنت خبير في كتابة أوصاف المنتجات للتجارة بالجملة المغربية.

اسم المنتج: "${productName}"
الفئة: "${category}"

اكتب لي JSON فقط بهاد الشكل:
{
  "title": "اسم منتج احترافي وجذاب",
  "description": "وصف احترافي 2-3 جمل بالعربية يجذب تجار الجملة",
  "keywords": ["كلمة1", "كلمة2", "كلمة3"],
  "suggestedPrice": "نطاق سعر مقترح بالدرهم",
  "tips": "نصيحة واحدة لتحسين تصوير هاد المنتج"
}`
        }
      ]
    }]
  })

  const text    = response.content[0].text
  const clean   = text.replace(/```json|```/g, '').trim()
  const aiData  = JSON.parse(clean)

  // 3 — صور مشابهة من Cloudinary
  let similarImages = []
  try {
    const similarSearch = await cloudinary.search
      .expression(`folder:jomla-ma AND tags=${category}`)
      .sort_by('created_at', 'desc')
      .max_results(4)
      .execute()
    
    similarImages = similarSearch.resources?.map(r => r.secure_url) || []
  } catch (err) {
    console.log('⚠️ لم نتمكن من جلب الصور المشابهة')
  }

  res.json({
    message: '✅ تم تحسين الصورة وتوليد الوصف',
    originalImage:  uploadResult.secure_url,
    enhancedImage:  uploadResult.secure_url,
    publicId:       uploadResult.public_id,
    aiData,
    similarImages
  })
}))

// البحث على صور احترافية من Pexels
router.post('/search-images', async (req, res) => {
  try {
    const { productName, category } = req.body
    const searchQuery = productName || category || 'product'
    
    // استخدام Pexels API (مجاني، لا يحتاج ترجمة)
    const pexelsKey = process.env.PEXELS_KEY
    if (!pexelsKey) {
      return res.json({ images: [], message: '⚠️ PEXELS_KEY غير موجود في .env' })
    }

    // طلب البحث من Pexels
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=square`
    const response = await fetch(url, {
      headers: { Authorization: pexelsKey }
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('Pexels error:', response.status, errorText)
      return res.json({ images: [], message: `❌ Pexels API error: ${response.status}` })
    }

    const data = await response.json()
    const images = (data.photos || []).map(photo => ({
      url: photo.src.large2x || photo.src.large,
      thumb: photo.src.small,
      credit: photo.photographer
    }))

    res.json({ images, queries: [searchQuery], message: images.length ? `✅ ${images.length} صورة تم العثور عليها` : '⚠️ لم نجد صوراً لهذا المنتج' })
    
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'خطأ في البحث عن الصور', images: [] })
  }
})

module.exports = router
