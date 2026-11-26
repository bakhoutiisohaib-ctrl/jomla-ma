const mongoose = require('mongoose')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const { escapeRegex } = require('./constants')
const { parseBusinessTypeInput, declaredBusinessTypes } = require('./businessTypes')
const { parseTaxonomyPath, applyTaxonomyFilter } = require('./taxonomy')

const badRequest = message => Object.assign(new Error(message), { status: 400 })
const PUBLIC_FIELDS = 'name category taxonomyPath pricingMode price currency country moq unit priceTiers inStock availability availabilityConfirmed city supplierId supplierPhone storeId views description images imageUrl createdAt matchType matchBasis effectiveUnitPrice'
const PUBLIC_VISIBILITY = { isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true, hasImageRights: true, 'imageRights.source': { $in: ['owned', 'licensed'] }, 'imageRights.declaredBy': { $type: 'objectId' }, 'imageRights.declaredAt': { $type: 'date' }, approvedBy: { $type: 'objectId' }, approvedAt: { $type: 'date' }, moderationStatus: { $ne: 'hidden' } }

function imageUrlAllowed(value) {
  if (typeof value !== 'string' || value.length > 2048) return false
  return /^\/uploads\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|gif)$/.test(value)
}

function parseOptions(input = {}) {
  const text = (name, max = 120) => {
    if (input[name] == null || input[name] === '') return ''
    if (typeof input[name] !== 'string' || input[name].length > max) throw badRequest(`قيمة ${name} غير صالحة`)
    return input[name].trim()
  }
  const number = (name, integer = false) => {
    if (input[name] == null || input[name] === '') return undefined
    if (!['string', 'number'].includes(typeof input[name])) throw badRequest(`قيمة ${name} غير صالحة`)
    const n = Number(input[name])
    if (!Number.isFinite(n) || n < (integer ? 1 : 0) || (integer && !Number.isSafeInteger(n))) throw badRequest(`قيمة ${name} غير صالحة`)
    return n
  }
  const options = { q: text('q'), city: text('city', 100), category: text('category', 100), supplier: text('supplier', 100), currency: text('currency', 3).toUpperCase(), quantity: number('quantity', true), minPrice: number('minPrice'), maxPrice: number('maxPrice'), page: number('page', true) || 1, limit: Math.min(number('limit', true) || 20, 100), order: text('order', 20) || 'relevance' }
  options.businessType = parseBusinessTypeInput(input)
  options.taxonomyPath = parseTaxonomyPath(input)
  if (Object.keys(input).some(key => /^(category|categoryMode)(?:\[|\.)/.test(key))) throw badRequest('قيمة الفئة غير صالحة')
  options.categoryMode = text('categoryMode', 10) || 'contains'
  if (!['contains', 'exact'].includes(options.categoryMode)) throw badRequest('طريقة تصفية الفئة غير صالحة')
  if (options.currency && !/^[A-Z]{3}$/.test(options.currency)) throw badRequest('رمز العملة غير صالح')
  if (options.minPrice != null && options.maxPrice != null && options.minPrice > options.maxPrice) throw badRequest('نطاق السعر غير صالح')
  if (!['relevance', 'price_asc', 'price_desc', 'newest'].includes(options.order)) throw badRequest('ترتيب البحث غير صالح')
  options.skip = (options.page - 1) * options.limit
  if (!Number.isSafeInteger(options.skip)) throw badRequest('رقم الصفحة غير صالح')
  return options
}

const synonymMap = { 'صباط': ['حذاء', 'سباط', 'شوز'], 'سبرديلة': ['حذاء رياضي', 'سنيكرز'], 'تيشورت': ['تيشرت', 'قميص'], 'سروال': ['بنطلون', 'جينز'] }
function searchWords(q) {
  const words = q ? [q, ...q.split(/\s+/).filter(w => w.length >= 2)] : []
  for (const [word, synonyms] of Object.entries(synonymMap)) if (q.includes(word)) words.push(...synonyms)
  return [...new Set(words)].slice(0, 15)
}

async function publicCatalogFilter({ supplierId, businessType } = {}) {
  const suppliers = await Supplier.find({ role: 'supplier', isActive: { $ne: false },
    ...(supplierId ? { _id: supplierId } : {}), ...(businessType ? { businessTypes: businessType } : {}) }).select('_id').lean()
  const supplierIds = suppliers.map(s => s._id)
  const stores = await Store.find({ supplierId: { $in: supplierIds }, reviewStatus: 'approved', isActive: true, adminSuspended: { $ne: true } }).select('_id supplierId').lean()
  // Membership in two independent ID lists is not proof of store ownership.
  // Keep this expression separate from caller-specific supplier/search predicates.
  return { ...PUBLIC_VISIBILITY, supplierId: { $in: supplierIds }, storeId: { $in: stores.map(s => s._id) },
    $expr: { $in: [['$supplierId', '$storeId'], { $literal: stores.map(s => [s.supplierId, s._id]) }] } }
}

function categoryPredicate(options) {
  return options.categoryMode === 'exact' ? options.category : new RegExp(escapeRegex(options.category), 'i')
}

async function catalogCategories(input = {}) {
  // This directory describes the published catalog for a declared activity,
  // independently of the current product page or search phrase.
  const allowed = new Set(['businessType', 'taxonomyPath', 'page', 'limit'])
  if (Object.keys(input).some(key => !allowed.has(key))) throw badRequest('معاملات دليل الفئات غير صالحة')
  const options = parseOptions(input)
  const filter = await publicCatalogFilter({ businessType: options.businessType })
  applyTaxonomyFilter(filter, options.taxonomyPath)
  const [result] = await Product.aggregate([
    { $match: filter },
    { $match: { category: { $type: 'string', $regex: /\S/ } } },
    { $match: { $expr: { $cond: [
      { $eq: [{ $type: '$category' }, 'string'] },
      { $and: [{ $lte: [{ $strLenCP: '$category' }, 100] }, { $eq: ['$category', { $trim: { input: '$category' } }] }] },
      false
    ] } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $facet: {
      data: [{ $sort: { count: -1, _id: 1 } }, { $skip: options.skip }, { $limit: options.limit }, { $project: { _id: 0, category: '$_id', count: 1 } }],
      total: [{ $count: 'value' }]
    } }
  ]).option({ maxTimeMS: 10000 })
  const total = result?.total?.[0]?.value || 0
  return { data: result?.data || [], pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit), hasNextPage: options.page * options.limit < total, hasPrevPage: options.page > 1 } }
}

async function searchCatalog(input, { words, visual = false, supplierId, storeId } = {}) {
  const options = parseOptions(input)
  const filter = await publicCatalogFilter({ supplierId, businessType: options.businessType })
  if (storeId) filter.$and = [{ storeId }]
  if (options.city) filter.city = new RegExp(escapeRegex(options.city), 'i')
  if (options.category) filter.category = categoryPredicate(options)
  if (options.currency) filter.currency = options.currency
  if (options.supplier) {
    if (mongoose.isValidObjectId(options.supplier)) filter.$and = [...(filter.$and || []), { supplierId: new mongoose.Types.ObjectId(options.supplier) }]
    else {
      const suppliers = await Supplier.find({ name: new RegExp(escapeRegex(options.supplier), 'i') }).select('_id').lean()
      filter.$and = [...(filter.$and || []), { supplierId: { $in: suppliers.map(s => s._id) } }]
    }
  }
  if (options.quantity) filter.moq = { $lte: options.quantity }
  const terms = (words || searchWords(options.q)).filter(w => typeof w === 'string' && w.trim()).slice(0, 15)
  if (terms.length) {
    const regexes = terms.map(w => new RegExp(escapeRegex(w.slice(0, 120)), 'i'))
    filter.$or = [{ name: { $in: regexes } }, { category: { $in: regexes } }, { description: { $in: regexes } }]
  }
  applyTaxonomyFilter(filter, options.taxonomyPath)
  const pipeline = [{ $match: filter }]
  if (options.quantity) {
    pipeline.push({ $addFields: { _tiers: { $filter: { input: { $ifNull: ['$priceTiers', []] }, as: 't', cond: { $and: [{ $lte: ['$$t.minQty', options.quantity] }, { $or: [{ $eq: [{ $ifNull: ['$$t.maxQty', null] }, null] }, { $gte: ['$$t.maxQty', options.quantity] }] }] } } } } })
    pipeline.push({ $addFields: { effectiveUnitPrice: { $ifNull: [{ $arrayElemAt: ['$_tiers.price', 0] }, '$price'] } } })
  } else pipeline.push({ $addFields: { effectiveUnitPrice: '$price' } })
  const priceFilter = {}
  if (options.minPrice != null) priceFilter.$gte = options.minPrice
  if (options.maxPrice != null) priceFilter.$lte = options.maxPrice
  if (Object.keys(priceFilter).length) pipeline.push({ $match: { pricingMode: 'fixed', effectiveUnitPrice: priceFilter } })
  const exactExpression = !visual && options.q ? { $eq: [{ $toLower: { $ifNull: ['$name', ''] } }, options.q.toLowerCase()] } : false
  pipeline.push({ $addFields: { _rank: { $cond: [exactExpression, 0, 1] }, _priceMissing: { $cond: [{ $eq: ['$pricingMode', 'on_request'] }, 1, 0] } } })
  const sort = options.order === 'price_asc' ? { _rank: 1, _priceMissing: 1, effectiveUnitPrice: 1, _id: 1 } : options.order === 'price_desc' ? { _rank: 1, _priceMissing: 1, effectiveUnitPrice: -1, _id: 1 } : options.order === 'newest' ? { _rank: 1, createdAt: -1, _id: 1 } : { _rank: 1, views: -1, _id: 1 }
  const projection = Object.fromEntries(PUBLIC_FIELDS.split(' ').map(field => [field, 1]))
  projection._rank = 1
  const [result] = await Product.aggregate([...pipeline, { $facet: {
    products: [{ $sort: sort }, { $skip: options.skip }, { $limit: options.limit }, { $project: projection }],
    totals: [{ $group: { _id: null, total: { $sum: 1 }, exactCount: { $sum: { $cond: [{ $eq: ['$_rank', 0] }, 1, 0] } } } }]
  } }])
  const totals = result?.totals?.[0] || { total: 0, exactCount: 0 }
  let products = (result?.products || []).map(p => {
    const { _rank, ...product } = p
    return { ...product, matchType: options.q || visual ? (_rank === 0 ? 'exact' : 'similar') : 'catalog', matchBasis: _rank === 0 ? 'title_text' : (visual ? 'image_description_keywords' : 'text_keywords') }
  })
  products = await Product.populate(products, { path: 'supplierId', select: 'name city phone isVerified verificationStatus businessTypes', options: { lean: true } })
  products = products.map(product => ({ ...product, supplierId: product.supplierId ? { ...product.supplierId, businessTypes: declaredBusinessTypes(product.supplierId.businessTypes) } : null }))
  return { products, total: totals.total, exactCount: totals.exactCount, similarCount: totals.total - totals.exactCount, page: options.page, limit: options.limit, pagination: { page: options.page, limit: options.limit, total: totals.total, pages: Math.ceil(totals.total / options.limit), hasNextPage: options.page * options.limit < totals.total, hasPrevPage: options.page > 1 } }
}

module.exports = { PUBLIC_FIELDS, PUBLIC_VISIBILITY, imageUrlAllowed, badRequest, parseOptions, publicCatalogFilter, searchWords, searchCatalog, catalogCategories, categoryPredicate }
