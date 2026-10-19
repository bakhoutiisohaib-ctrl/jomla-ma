const express    = require('express')
const router     = express.Router()
const multer     = require('multer')
const fs         = require('fs')
const path       = require('path')
const cloudinary = require('cloudinary').v2
const Anthropic  = require('@anthropic-ai/sdk')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')

// إعداد Cloudinary إن وُجدت المفاتيح
const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const cloudKey = process.env.CLOUDINARY_API_KEY
const cloudSecret = process.env.CLOUDINARY_API_SECRET
const hasCloudinary = !!(cloudName && cloudKey && cloudSecret && !cloudName.includes('your') && !cloudKey.includes('your'))

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key:    cloudKey,
    api_secret: cloudSecret
  })
}

// إعداد Claude إن وُجد المفتاح
const claudeKey = process.env.CLAUDE_API_KEY
const hasClaude = !!(claudeKey && !claudeKey.includes('YOUR') && claudeKey.startsWith('sk-ant'))
const claude = hasClaude ? new Anthropic({ apiKey: claudeKey }) : null

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
})

console.log('Loaded productAI route with Cloudinary:', hasCloudinary, 'Claude:', hasClaude)

/**
 * @swagger
 * tags:
 *   - name: ProductAI
 *     description: AI-driven product draft onboarding and image analysis
 */

// فحص جاهزية الخدمة
router.get('/ping', (req, res) => {
  res.json({
    ok: true,
    route: '/api/product-ai/ping',
    hasCloudinary,
    hasClaude
  })
})

/**
 * دالة استخراج مسودة الجملة الذكية بالاعتماد على التحليل الصوري
 */
async function generateWholesaleDraft(fileBuffer, mimeType, hints = {}) {
  const { productName = '', category = '' } = hints

  // إذا كان Claude متاحاً، نستعمل Claude 3.5 Sonnet لتحليل الصورة
  if (hasClaude && claude) {
    try {
      const imageBase64 = fileBuffer.toString('base64')
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: `أنت نظام ذكاء اصطناعي متخصص في تجارة الجملة المغربية لمنصة Jomla.ma.
حلل صورة هذا المنتج بدقة واستخرج مسودة مواصفات كاملة لعرضه على تجار الجملة والتجزئة في المغرب (B2B).

تلميحات مساعدة إن وُجدت:
- اسم المنتج المقترح من المورد: "${productName}"
- الفئة المقترحة: "${category}"

أخرج لي فقط كود JSON خالص (بدون أي علامات markdown أو كود خارجي) بهذا الشكل تماماً:
{
  "title": "اسم منتج تجاري دقيق وجذاب للمشترين المهنيين",
  "category": "إحدى الفئات الرئيسية: أحذية، ملابس، حقائب وإكسسوارات، إلكترونيات، مستحضرات تجميل، أواني ومستلزمات منزلية، مواد غذائية، أخرى",
  "description": "وصف تسويقي احترافي من 2-3 جمل يوضح خامة المنتج وتفاصيل الجملة وطرق التعبئة",
  "suggestedPrice": 50,
  "suggestedMoq": 10,
  "suggestedUnit": "قطعة أو درزينة أو كرتونة أو طرد",
  "suggestedPriceTiers": [
    { "minQty": 10, "maxQty": 49, "price": 50 },
    { "minQty": 50, "maxQty": 199, "price": 45 },
    { "minQty": 200, "maxQty": null, "price": 40 }
  ],
  "features": ["ميزة 1", "ميزة 2", "ميزة 3"],
  "tips": "نصيحة للمورد لتحسين البيع والعرض"
}`
            }
          ]
        }]
      })

      const rawText = response.content[0].text
      const cleanJson = rawText.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleanJson)
      return parsed
    } catch (err) {
      console.warn('⚠️ فشل تحليل Claude، سيتم استخدام المسودة الذكية البديلة:', err.message)
    }
  }

  // خطة بديلة ذكية تحاكي متطلبات سوق الجملة المغربي
  const title = productName || 'منتج جملة عالي الجودة'
  const cat = category || 'عام'
  return {
    title: title,
    category: cat,
    description: `منتج ممتاز موجه لتجار الجملة والتقسيط في المغرب. خامة ممتازة وتشطيب عالي الجودة مع إمكانية التوصيل السريع لكافة المدن المغربية.`,
    suggestedPrice: 65,
    suggestedMoq: 12,
    suggestedUnit: 'قطعة',
    suggestedPriceTiers: [
      { minQty: 12, maxQty: 49, price: 65 },
      { minQty: 50, maxQty: 199, price: 60 },
      { minQty: 200, maxQty: null, price: 54 }
    ],
    features: ['جودة تصنيع موثوقة', 'جاهز للتسليم الفوري', 'أسعار تفضيلية للكميات الكبيرة'],
    tips: 'إضافة صور واضحة لكرتونة الشحن أو تفاصيل العلامة التجارية يزيد من طلبات عروض الأسعار RFQ.'
  }
}

/**
 * دالة رفع ومعالجة الصورة (عبر Cloudinary أو التخزين المحلي)
 */
async function processProductImage(file) {
  if (hasCloudinary) {
    try {
      const uploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: 'jomla-ma',
            resource_type: 'auto',
            transformation: [
              { quality: 'auto:best' },
              { fetch_format: 'auto' },
              { width: 800, height: 800, crop: 'fill', gravity: 'auto' },
              { effect: 'sharpen:80' }
            ]
          },
          (err, result) => err ? reject(err) : resolve(result)
        ).end(file.buffer)
      })
      return uploadResult.secure_url
    } catch (err) {
      console.warn('⚠️ فشل الرفع لـ Cloudinary، سيتم الحفظ محلياً:', err.message)
    }
  }

  // حفظ محلي في مجلد uploads
  const uploadsDir = path.join(__dirname, '..', 'uploads')
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
  }
  const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg'
  const filename = `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
  const filePath = path.join(uploadsDir, filename)
  fs.writeFileSync(filePath, file.buffer)
  return `/uploads/${filename}`
}

/**
 * @swagger
 * /api/product-ai/enhance:
 *   post:
 *     summary: Analyze product image and generate wholesale draft
 *     tags: [ProductAI]
 */
router.post('/enhance', authenticate, upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '❌ يرجى اختيار أو التقاط صورة للمنتج أولاً' })
  }

  const { productName, category } = req.body

  // 1 — رفع ومعالجة الصورة
  const imageUrl = await processProductImage(req.file)

  // 2 — استخراج مسودة الجملة الذكية
  const draft = await generateWholesaleDraft(req.file.buffer, req.file.mimetype, { productName, category })

  // 3 — صور مشابهة (إذا توفر Cloudinary)
  let similarImages = []
  if (hasCloudinary && draft.category) {
    try {
      const similarSearch = await cloudinary.search
        .expression(`folder:jomla-ma AND tags=${draft.category}`)
        .sort_by('created_at', 'desc')
        .max_results(4)
        .execute()
      similarImages = similarSearch.resources?.map(r => r.secure_url) || []
    } catch {
      // ignore
    }
  }

  res.json({
    message: '✅ تم تحليل الصورة واستخراج مسودة منتج الجملة بالذكاء الاصطناعي',
    imageUrl,
    originalImage: imageUrl,
    enhancedImage: imageUrl,
    draft,
    aiData: draft, // backward compatibility
    similarImages
  })
}))

// البحث على صور احترافية من Pexels
router.post('/search-images', async (req, res) => {
  try {
    const { productName, category } = req.body
    const searchQuery = productName || category || 'product wholesale'
    const pexelsKey = process.env.PEXELS_KEY

    if (!pexelsKey) {
      return res.json({ images: [], message: '⚠️ PEXELS_KEY غير موجود في .env' })
    }

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=8&orientation=square`
    const response = await fetch(url, {
      headers: { Authorization: pexelsKey }
    })

    if (!response.ok) {
      return res.json({ images: [], message: `⚠️ خطأ في مزود الصور الخارجية: ${response.status}` })
    }

    const data = await response.json()
    const images = (data.photos || []).map(photo => ({
      url: photo.src.large2x || photo.src.large,
      thumb: photo.src.small,
      credit: photo.photographer
    }))

    res.json({
      images,
      queries: [searchQuery],
      message: images.length ? `✅ تم العثور على ${images.length} صورة` : '⚠️ لم نجد صوراً مطابقة'
    })
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الصور', images: [] })
  }
})

module.exports = router
