const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const { memoryUpload } = require('../middleware/upload')
const { asyncHandler } = require('../middleware/errorHandler')
const { searchImage } = require('../services/visualIndex')
const { discoverExternally } = require('../services/externalDiscovery')

router.post('/', rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false }), memoryUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'الصورة مطلوبة للبحث' })
  const input = { ...req.body, ...req.query }
  if(input.visualVersion!==undefined&&input.visualVersion!=='v49-1')return res.status(400).json({message:'Unsupported visual search version'})
  const structuredVisual=input.visualVersion==='v49-1'
  let result
  try {result=await searchImage(req.file.buffer,{filters:input,requireDetail:structuredVisual})}
  catch(error){if(structuredVisual&&error.code==='VISUAL_INSUFFICIENT_DETAIL')return res.status(422).json({message:error.message,code:error.code});throw error}
  const q = typeof input.q === 'string' ? input.q.trim() : ''
  const externalDiscovery = structuredVisual ? {enabled:false,externalSources:[],reason:'visual_search_scope'} : input.taxonomyPath ? { enabled: false, externalSources: [], reason: 'taxonomy_scope' }
    : input.supplierTrust ? { enabled: false, externalSources: [], reason: 'supplier_trust_scope' }
    : q ? await discoverExternally(q, { internalTotal: result.total, category: input.category }) :
    { enabled: false, externalSources: [], reason: 'text_query_required' }
  res.json({ ...result,
    ...(structuredVisual?{visualVersion:'v49-1',queryQuality:'sufficient_detail'}:{}),
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
