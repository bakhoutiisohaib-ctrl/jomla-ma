const express = require('express')
const router = express.Router()
const { asyncHandler } = require('../middleware/errorHandler')
const { searchCatalog } = require('../utils/catalog')
const { discoverExternally } = require('../services/externalDiscovery')

router.post('/', asyncHandler(async (req, res) => {
  const result = await searchCatalog({ ...req.body, ...req.query, q: req.body.query ?? req.body.q ?? req.query.q ?? '' })
  const query = req.body.query ?? req.body.q ?? req.query.q ?? ''
  const externalDiscovery = ({ ...req.body, ...req.query }).taxonomyPath
    ? { enabled: false, externalSources: [], reason: 'taxonomy_scope' }
    : ({ ...req.body, ...req.query }).supplierTrust
      ? { enabled: false, externalSources: [], reason: 'supplier_trust_scope' }
      : await discoverExternally(query, { internalTotal: result.total, category: req.body.category || req.query.category })
  res.json({
    ...result,
    message: 'تم البحث في المنتجات المنشورة والمتوفرة',
    analysisMode: 'text_keywords',
    aiUsed: false,
    aiMessage: 'المطابقة تعني تطابق عنوان النص فقط؛ النتائج الأخرى مرتبطة بكلمات البحث.',
    suggestions: [],
    sourcingOffer: { isNeeded: result.total === 0, canRequestSourcing: result.total === 0, suggestedQuery: req.body.query || '' },
    externalDiscovery
  })
}))
module.exports = router
