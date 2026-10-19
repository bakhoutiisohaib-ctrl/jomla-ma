const express   = require('express')
const router    = express.Router()
const Anthropic = require('@anthropic-ai/sdk')
const Product   = require('../models/Product')
const { body, validationResult } = require('express-validator')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')
const { cacheMiddleware } = require('../middleware/cache')

const claudeKey = process.env.CLAUDE_API_KEY
const hasClaude = !!(claudeKey && !claudeKey.includes('YOUR') && claudeKey.startsWith('sk-ant'))
const claude = hasClaude ? new Anthropic({ apiKey: claudeKey }) : null

/**
 * تحليل محلي بديل بالدارجة المغربية في حال عدم توفر مفتاح Claude
 */
function localDarjaAnalysis(query, cityHint, categoryHint) {
  const q = String(query || '').toLowerCase()
  const synonyms = {
    'صباط': ['شوز', 'سباط', 'حذاء', 'سبرديلة'],
    'سبرديلة': ['صباط', 'حذاء رياضي', 'سنيكرز'],
    'تيشورت': ['قميص', 'تيشرت', 'ملابس'],
    'سروال': ['جينز', 'بنطلون', 'ملابس']
  }

  let words = [q]
  Object.entries(synonyms).forEach(([key, vals]) => {
    if (q.includes(key)) words = [...words, ...vals]
  })

  return {
    searchWords: [...new Set(words.filter(Boolean))],
    city: cityHint || null,
    category: categoryHint || null,
    suggestions: ['صباط جلد كازا', 'تيشورت قطن جملة', 'أحذية رياضية فاس'],
    message: `قلبنا على "${query}" بالذكاء الاصطناعي في كتالوج الجملة`
  }
}

const validateAISearch = [
  body('query')
    .notEmpty().withMessage('استعلام البحث مطلوب')
    .isLength({ min: 2 }).withMessage('البحث يجب أن يكون حرفين على الأقل'),
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

router.post('/', cacheMiddleware(15), validateAISearch, asyncHandler(async (req, res) => {
  const { query, city, category } = req.body
  const { page, limit, skip } = getPaginationParams(req)

  let parsed = null

  if (hasClaude && claude) {
    try {
      const allProducts  = await Product.find().select('name category city')
      const cities       = [...new Set(allProducts.map(p => p.city).filter(Boolean))]
      const categories   = [...new Set(allProducts.map(p => p.category).filter(Boolean))]
      const productNames = allProducts.map(p => p.name).slice(0, 30)

      const response = await claude.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `أنت محرك بحث ذكي لمنصة Jomla.ma لتجارة الجملة المغربية.
المستخدم يبحث عن: "${query}"
المدينة المحددة: "${city || ''}"
الفئة المحددة: "${category || ''}"

حلل الطلب وأخرج JSON فقط بدون markdown:
{
  "searchWords": ["كلمة1", "كلمة2"],
  "city": "المدينة أو null",
  "category": "الفئة أو null",
  "priceOrder": "asc أو desc أو null",
  "suggestions": ["اقتراح1", "اقتراح2"],
  "message": "رسالة توضيحية قصيرة للمشتري بالدارجة"
}`
        }]
      })
      const clean = response.content[0].text.replace(/```json|```/g, '').trim()
      parsed = JSON.parse(clean)
    } catch (err) {
      console.warn('⚠️ تعذر تشغيل Claude AI Search، استخدام البديل المحلي:', err.message)
    }
  }

  if (!parsed) {
    parsed = localDarjaAnalysis(query, city, category)
  }

  // بناء الفلتر
  let filter = {}
  const searchTerms = (parsed.searchWords || [query]).filter(Boolean)
  const regexes = searchTerms.map(w => new RegExp(escapeRegex(w), 'i'))

  if (regexes.length > 0) {
    filter.$or = [
      { name: { $in: regexes } },
      { category: { $in: regexes } }
    ]
  }

  if (parsed.city)     filter.city     = { $regex: escapeRegex(parsed.city), $options: 'i' }
  if (parsed.category) filter.category = { $regex: escapeRegex(parsed.category), $options: 'i' }

  let products = await Product.find(filter)
    .populate('supplierId', 'name city phone isVerified verificationStatus')
    .limit(limit)
    .skip(skip)

  const total = await Product.countDocuments(filter)

  // تمييز النتائج بمطابق أو مشابه
  const qLower = String(query).toLowerCase()
  const annotated = products.map(p => {
    const isExact = p.name.toLowerCase().includes(qLower) || qLower.includes(p.name.toLowerCase())
    return {
      ...p.toObject(),
      matchType: isExact ? 'exact' : 'similar'
    }
  })

  res.json({
    message: '✅ البحث نجح',
    products: annotated,
    total,
    page,
    limit,
    suggestions: parsed.suggestions || [],
    aiMessage: parsed.message || '',
    sourcingOffer: {
      isNeeded: total === 0,
      suggestedQuery: query
    }
  })
}))

module.exports = router
