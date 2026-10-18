const express   = require('express')
const router    = express.Router()
const Anthropic = require('@anthropic-ai/sdk')
const Product   = require('../models/Product')
const { body, validationResult } = require('express-validator')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse, escapeRegex } = require('../utils/constants')

const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })
const { cacheMiddleware } = require('../middleware/cache')

/**
 * @swagger
 * tags:
 *   - name: AI-Search
 *     description: AI-powered search using Claude
 */

/**
 * @swagger
 * /api/ai-search:
 *   post:
 *     summary: Perform an AI-enhanced search (returns paginated results)
 *     tags: [AI-Search]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               query:
 *                 type: string
 *               city:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: AI search results with pagination and suggestions
 */

// Validator
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

  // جيب كل المنتجات والمدن المتاحة
  const allProducts  = await Product.find()
  const cities       = [...new Set(allProducts.map(p => p.city).filter(Boolean))]
  const categories   = [...new Set(allProducts.map(p => p.category).filter(Boolean))]
  const productNames = allProducts.map(p => p.name)

  // اسأل Claude
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `أنت مساعد ذكي لموقع Jomla.ma لتجارة الجملة المغربية.

المستخدم كتب: "${query}"
المدينة المختارة: "${city || 'لا شيء'}"
الفئة المختارة: "${category || 'لا شيء'}"

المنتجات المتاحة: ${productNames.join('، ')}
المدن المتاحة: ${cities.join('، ')}
الفئات المتاحة: ${categories.join('، ')}

حلل طلب المستخدم وأعطني JSON فقط بهاد الشكل:
{
  "searchWords": ["كلمة1", "كلمة2"],
  "city": "المدينة أو null",
  "category": "الفئة أو null",
  "priceOrder": "asc أو desc أو null",
  "suggestions": ["اقتراح1", "اقتراح2", "اقتراح3"],
  "message": "رسالة قصيرة للمستخدم بالدارجة"
}`
    }]
  })

  const text = response.content[0].text
  const clean = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean)

  // بحث في قاعدة البيانات
  let filter = {}
  if (parsed.searchWords?.length > 0) {
    filter.$or = parsed.searchWords.map(w => ({
      name: { $regex: escapeRegex(w), $options: 'i' },
    }))
  }
  if (parsed.city)     filter.city     = { $regex: escapeRegex(parsed.city), $options: 'i' }
  if (parsed.category) filter.category = { $regex: escapeRegex(parsed.category), $options: 'i' }

  let products = await Product.find(filter)
    .limit(limit)
    .skip(skip)

  const total = await Product.countDocuments(filter)

  // ترتيب حسب السعر
  if (parsed.priceOrder === 'asc')  {
    products = products.sort((a, b) => a.price - b.price)
  }
  if (parsed.priceOrder === 'desc') {
    products = products.sort((a, b) => b.price - a.price)
  } else {
    // الترتيب الافتراضي حسب المشاهدات
    products = products.sort((a, b) => (b.views || 0) - (a.views || 0))
  }

  // إذا ما لقيناش نتائج
  if (products.length === 0) {
    products = await Product.find().sort({ views: -1 }).limit(limit).skip(skip)
  }

  res.json({
    message: '✅ البحث نجح',
    ...formatPaginationResponse(products, total, page, limit),
    aiResponse: {
      suggestions: parsed.suggestions,
      message: parsed.message
    }
  })
}))

module.exports = router
