const express = require('express')
const router  = express.Router()
const multer  = require('multer')
const Product = require('../models/Product')
const Anthropic = require('@anthropic-ai/sdk')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
})

const claudeKey = process.env.CLAUDE_API_KEY
const hasClaude = !!(claudeKey && !claudeKey.includes('YOUR') && claudeKey.startsWith('sk-ant'))
const claude = hasClaude ? new Anthropic({ apiKey: claudeKey }) : null

// قاموس الترجمة والمصطلحات المغربية لنتائج الرؤية البصرية
const darjaTranslations = {
  'shoe': 'صباط', 'shoes': 'صباط', 'sneaker': 'سبرديلة', 'sneakers': 'سبرديلة', 'footwear': 'حذاء',
  'boot': 'بوط', 'sandals': 'صندالة', 'sandal': 'صندالة',
  'shirt': 'قميص', 't-shirt': 'تيشورت', 'clothing': 'ملابس', 'dress': 'كسوة',
  'pants': 'سروال', 'jeans': 'جينز', 'jacket': 'فيستة', 'hoodie': 'مونطو',
  'bag': 'صاك', 'handbag': 'صاك يد', 'backpack': 'محفظة',
  'glasses': 'نواظر', 'sunglasses': 'نواظر شمس',
  'watch': 'مكانة', 'jewelry': 'مجوهرات', 'ring': 'خاتم',
  'hat': 'طاقية', 'cap': 'كاسكيطة',
  'cosmetics': 'ماكياج', 'perfume': 'ريحة', 'electronics': 'إلكترونيات',
  'phone': 'بورطابل', 'case': 'كفر'
}

/**
 * تحليل بصري للصورة لتحديد الكلمات الدقيقة والمشابهة
 */
async function analyzeSearchImage(fileBuffer, mimeType, filename = '') {
  // 1 — إذا كان Claude متاحاً
  if (hasClaude && claude) {
    try {
      const imageBase64 = fileBuffer.toString('base64')
      const response = await claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 }
            },
            {
              type: 'text',
              text: `حلل هذه الصورة لمنتج جملة مطلوب في المغرب.
أخرج JSON فقط بدون علامات markdown:
{
  "exactName": "اسم ونوع المنتج بالعربية (مثال: صباط كلاسيكي جلدي)",
  "category": "الفئة الرئيسية (أحذية، ملابس، إلكترونيات، حقائب، تجميل، إلخ)",
  "exactKeywords": ["كلمة دقيقة 1", "كلمة دقيقة 2"],
  "similarKeywords": ["كلمة مشابهة 1", "كلمة مشابهة 2", "كلمة مشابهة 3"]
}`
            }
          ]
        }]
      })
      const clean = response.content[0].text.replace(/```json|```/g, '').trim()
      return JSON.parse(clean)
    } catch (err) {
      console.warn('⚠️ تعذر تحليل Claude للبحث بالصورة:', err.message)
    }
  }

  // 2 — إذا كان Google Cloud Vision متاحاً
  if (process.env.GOOGLE_VISION_KEY && !process.env.GOOGLE_VISION_KEY.includes('your')) {
    try {
      const vision = require('@google-cloud/vision')
      const client = new vision.ImageAnnotatorClient({ apiKey: process.env.GOOGLE_VISION_KEY })
      const [result] = await client.labelDetection({ image: { content: fileBuffer.toString('base64') } })
      const labels = (result.labelAnnotations || []).slice(0, 8).map(l => l.description.toLowerCase())
      
      const matchedDarja = []
      labels.forEach(l => {
        if (darjaTranslations[l]) matchedDarja.push(darjaTranslations[l])
      })

      const primary = matchedDarja[0] || labels[0] || 'منتج'
      return {
        exactName: primary,
        category: matchedDarja.length ? 'عام' : 'منتجات',
        exactKeywords: matchedDarja.slice(0, 2),
        similarKeywords: labels.slice(0, 4)
      }
    } catch (err) {
      console.warn('⚠️ تعذر تشغيل Google Vision:', err.message)
    }
  }

  // 3 — خطة بديلة ذكية
  const nameHint = filename ? filename.replace(/[-_.]/g, ' ') : 'منتج جملة'
  return {
    exactName: nameHint,
    category: 'عام',
    exactKeywords: nameHint.split(' ').filter(w => w.length > 2).slice(0, 2),
    similarKeywords: ['جملة', 'منتج', 'مغرب']
  }
}

router.post('/', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '❌ الصورة مطلوبة للبحث' })
  }

  const { page, limit, skip } = getPaginationParams(req)

  // تحليل الصورة واستخراج الكلمات المطابقة والمشابهة
  const analysis = await analyzeSearchImage(req.file.buffer, req.file.mimetype, req.file.originalname)
  const exactWords = (analysis.exactKeywords || []).filter(Boolean)
  const similarWords = (analysis.similarKeywords || []).filter(Boolean)

  const exactRegexes = exactWords.map(w => new RegExp(escapeRegex(w), 'i'))
  const similarRegexes = similarWords.map(w => new RegExp(escapeRegex(w), 'i'))

  // 1 — البحث عن النتائج المطابقة تماماً (Exact Matches)
  let exactFilter = {}
  if (exactRegexes.length > 0) {
    exactFilter = {
      $or: [
        { name: { $in: exactRegexes } },
        { category: { $in: exactRegexes } }
      ]
    }
  } else {
    exactFilter = { name: { $regex: escapeRegex(analysis.exactName || ''), $options: 'i' } }
  }

  const rawExactProducts = await Product.find(exactFilter)
    .populate('supplierId', 'name city phone isVerified verificationStatus')
    .sort({ views: -1 })
    .limit(limit)

  const exactMatches = rawExactProducts.map(p => ({
    ...p.toObject(),
    matchType: 'exact' // مطابق تماماً
  }))

  const exactIds = exactMatches.map(p => p._id.toString())

  // 2 — البحث عن النتائج المشابهة (Similar Matches)
  let similarMatches = []
  if (similarRegexes.length > 0 || analysis.category) {
    const similarFilter = {
      _id: { $nin: exactIds },
      $or: [
        ...(similarRegexes.length > 0 ? [{ name: { $in: similarRegexes } }, { category: { $in: similarRegexes } }] : []),
        ...(analysis.category ? [{ category: { $regex: escapeRegex(analysis.category), $options: 'i' } }] : [])
      ]
    }

    const rawSimilarProducts = await Product.find(similarFilter)
      .populate('supplierId', 'name city phone isVerified verificationStatus')
      .sort({ views: -1 })
      .limit(limit)

    similarMatches = rawSimilarProducts.map(p => ({
      ...p.toObject(),
      matchType: 'similar' // منتج مشابه
    }))
  }

  // دمج النتائج مع إعطاء الأولوية للمطابق ثم المشابه
  let combinedProducts = [...exactMatches, ...similarMatches]

  // إذا لم نجد أي تطابق، نجلب أشهر المنتجات مع تمييزها
  if (combinedProducts.length === 0) {
    const popular = await Product.find()
      .populate('supplierId', 'name city phone isVerified verificationStatus')
      .sort({ views: -1 })
      .limit(limit)

    combinedProducts = popular.map(p => ({
      ...p.toObject(),
      matchType: 'popular'
    }))
  }

  const totalResults = exactMatches.length + similarMatches.length

  res.json({
    message: '✅ تم تحليل الصورة وتصنيف النتائج',
    detectedProduct: analysis.exactName || 'منتج جملة',
    detectedCategory: analysis.category || 'عام',
    exactCount: exactMatches.length,
    similarCount: similarMatches.length,
    exactMatches,
    similarMatches,
    products: combinedProducts.slice(skip, skip + limit),
    total: totalResults,
    page,
    limit,
    sourcingOffer: {
      isAvailable: exactMatches.length === 0,
      canRequestSourcing: exactMatches.length === 0,
      promptText: exactMatches.length === 0 
        ? `لم نجد منتجاً مطابقاً تماماً لـ "${analysis.exactName}". يمكنك تقديم طلب توريد خاص وسيقوم الموردون المعتمدون بالرد عليك بعروض أسعار تنافسية.`
        : null,
      suggestedSourcing: {
        productName: analysis.exactName || '',
        category: analysis.category || ''
      }
    },
    // روابط استكشاف مرجعية خارجية عند عدم التوفر (للمقارنة فقط وبدون ادعاء تحقق)
    externalDiscovery: {
      enabled: exactMatches.length === 0,
      notice: 'روابط خارجية تجريبية للمقارنة والاستكشاف فقط',
      searchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent((analysis.exactName || '') + ' wholesale morocco')}`
    }
  })
}))

module.exports = router
