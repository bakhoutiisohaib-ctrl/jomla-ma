const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const { memoryUpload } = require('../middleware/upload')
const { asyncHandler } = require('../middleware/errorHandler')
const { searchImage } = require('../services/visualIndex')
const { discoverExternally } = require('../services/externalDiscovery')

router.post('/', rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false }), memoryUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'الصورة مطلوبة للبحث' })
  const input = { ...req.body, ...req.query }
  const result = await searchImage(req.file.buffer, { filters: input })
  const q = typeof input.q === 'string' ? input.q.trim() : ''
  const externalDiscovery = input.taxonomyPath ? { enabled: false, externalSources: [], reason: 'taxonomy_scope' }
    : q ? await discoverExternally(q, { internalTotal: result.total, category: input.category }) :
    { enabled: false, externalSources: [], reason: 'text_query_required' }
  res.json({ ...result,
    message: 'تطابق الصورة يعني الملف نفسه؛ التشابه البصري لا يثبت هوية المنتج أو مواصفاته.',
    analysisAvailable: true, analysisMode: 'local_visual_vectors', visualIdentityVerified: false,
    detectedProduct: q, detectedCategory: input.category || '',
    exactMatches: result.products.filter(p => p.matchBasis === 'exact_image'),
    similarMatches: result.products.filter(p => p.matchBasis !== 'exact_image'),
    sourcingOffer: { isAvailable: result.total === 0, canRequestSourcing: result.total === 0, suggestedSourcing: { productName: q, category: input.category || '' } },
    externalDiscovery
  })
}))
module.exports = router
