const express = require('express')
const router = express.Router()
const { asyncHandler } = require('../middleware/errorHandler')
const { searchCatalog } = require('../utils/catalog')
const { discoverExternally } = require('../services/externalDiscovery')
const { VERSION, parseIntent } = require('../utils/searchIntent')

const summarize = intent => {
  const keys=['version','terms','categoryPath','city','excludedCities','excludedTerms','quantity','unit','moq','moqStrict','minPrice','maxPrice','strictMin','strictMax','budget','currency','sort','verified','delivery']
  return {...Object.fromEntries(keys.map(k=>[k,intent[k]])),issues:[...new Set(intent.issues)],...(intent.branches?{branches:intent.branches.map(summarize)}:{})}
}
router.post('/', asyncHandler(async (req, res) => {
  const query = req.body.query ?? req.body.q ?? req.query.q ?? ''
  const input = { ...req.body, ...req.query, q: query }
  if (input.intentVersion !== undefined && input.intentVersion !== VERSION) return res.status(400).json({ message: 'Unsupported search intent version' })
  const intent = input.intentVersion === VERSION ? parseIntent(query) : null
  const result = await searchCatalog(input, intent ? { intent } : {})
  const externalDiscovery = intent ? { enabled: false, externalSources: [], reason: 'structured_search_scope' } : ({ ...req.body, ...req.query }).taxonomyPath
    ? { enabled: false, externalSources: [], reason: 'taxonomy_scope' }
    : ({ ...req.body, ...req.query }).supplierTrust
      ? { enabled: false, externalSources: [], reason: 'supplier_trust_scope' }
      : await discoverExternally(query, { internalTotal: result.total, category: req.body.category || req.query.category })
  res.json({
    ...result,
    message: 'تم البحث في المنتجات المنشورة والمتوفرة',
    analysisMode: intent ? 'structured_keywords' : 'text_keywords',
    ...(intent ? { searchIntent: summarize(intent) } : {}),
    aiUsed: false,
    aiMessage: intent ? 'بحث نصي محلي؛ الشروط المستخرجة ليست ضماناً للمواصفات أو التوصيل.' : 'المطابقة تعني تطابق عنوان النص فقط؛ النتائج الأخرى مرتبطة بكلمات البحث.',
    suggestions: [],
    sourcingOffer: { isNeeded: result.total === 0 && !intent?.issues.length, canRequestSourcing: result.total === 0 && !intent?.issues.length, suggestedQuery: req.body.query || '' },
    externalDiscovery
  })
}))
module.exports = router
