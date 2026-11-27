const mongoose = require('mongoose')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const { escapeRegex } = require('./constants')
const { parseBusinessTypeInput, declaredBusinessTypes } = require('./businessTypes')
const { parseTaxonomyPath, applyTaxonomyFilter } = require('./taxonomy')
const { parseSupplierTrust, verifiedSupplierPredicate } = require('./supplierTrust')
const { regexes } = require('./searchIntent')

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
  options.supplierTrust = parseSupplierTrust(input)
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

async function publicCatalogFilter({ supplierId, businessType, supplierTrust } = {}) {
  const suppliers = await Supplier.find({ role: 'supplier', isActive: { $ne: false },
    ...(supplierId ? { _id: supplierId } : {}), ...(businessType ? { businessTypes: businessType } : {}), ...verifiedSupplierPredicate(supplierTrust) }).select('_id').lean()
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
  const allowed = new Set(['businessType', 'taxonomyPath', 'supplierTrust', 'page', 'limit'])
  if (Object.keys(input).some(key => !allowed.has(key))) throw badRequest('معاملات دليل الفئات غير صالحة')
  const options = parseOptions(input)
  const filter = await publicCatalogFilter({ businessType: options.businessType, supplierTrust: options.supplierTrust })
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

async function searchCatalog(input, { words, visual = false, supplierId, storeId, intent, countOnly = false } = {}) {
  const options = parseOptions(input)
  const filter = await publicCatalogFilter({ supplierId, businessType: options.businessType, supplierTrust: options.supplierTrust })
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
  const branches = intent ? (intent.branches || [intent]) : []
  const quantity = intent?.quantity ?? options.quantity
  const requireTier = branches.some(b=>b.budget!=null||b.minPrice!=null||b.maxPrice!=null||b.sort)
  const priceQuantity = quantity || (requireTier ? '$moq' : null)
  const lexical = group => ({ $or: ['name','category','description'].map(field=>({[field]:{$in:regexes(group)}})) })
  const branchPredicates = []
  if(intent){
    const verifiedIds=branches.some(b=>b.verified!==null) ? (await Supplier.find({
      role:'supplier',isActive:{$ne:false},...verifiedSupplierPredicate('verified')
    }).select('_id').lean()).map(row=>row._id) : []
    for(const b of branches){
      if(b.quantity!=null&&options.quantity!=null&&b.quantity!==options.quantity)intent.issues.push('quantity_conflict')
      if(b.currency&&options.currency&&b.currency!==options.currency)intent.issues.push('currency_conflict')
      if(b.sort&&options.order!=='relevance'&&options.order!==b.sort)intent.issues.push('sort_conflict')
      if(b.verified===false&&options.supplierTrust==='verified')intent.issues.push('trust_conflict')
      const clauses=[]
      if(b.city)clauses.push({city:{$in:regexes(b.cityAliases,true)}})
      if(b.excludedCityAliases.length)clauses.push({city:{$nin:regexes(b.excludedCityAliases,true)}})
      if(b.unit)clauses.push({unit:{$in:regexes(b.unitAliases,true)}})
      if(b.currency)clauses.push({currency:b.currency})
      if(b.categoryPath){const scoped={};applyTaxonomyFilter(scoped,b.categoryPath);clauses.push(...(scoped.$and||[]))}
      if(b.moq!=null)clauses.push({moq:{[b.moqStrict?'$lt':'$lte']:b.moq}})
      if(b.verified!==null)clauses.push({supplierId:{[b.verified?'$in':'$nin']:verifiedIds}})
      for(const group of b.groups)clauses.push(lexical(group))
      for(const group of b.excludedGroups)clauses.push({$nor:[lexical(group)]})
      const bounds={}
      if(b.minPrice!=null)bounds[b.strictMin?'$gt':'$gte']=b.minPrice
      if(b.maxPrice!=null)bounds[b.strictMax?'$lt':'$lte']=b.maxPrice
      const priced=[...clauses]
      if(Object.keys(bounds).length||b.budget!=null||b.sort)priced.push({pricingMode:'fixed',effectiveUnitPrice:{$type:'number',...bounds}})
      if(b.budget!=null){
        const cost={$convert:{input:'$effectiveUnitPrice',to:'decimal',onError:null,onNull:null}}
        const amount={$convert:{input:quantity||'$moq',to:'decimal',onError:null,onNull:null}}
        priced.push({$expr:{$and:[
          {$ne:[cost,null]},{$ne:[amount,null]},{$gte:[cost,0]},{$gte:[amount,1]},
          {$lte:[{$multiply:[cost,amount]},{$toDecimal:b.budget}]}
        ]}})
      }
      branchPredicates.push({initial:clauses.length?{$and:clauses}:{},priced:priced.length?{$and:priced}:{}})
    }
    if(intent.issues.length)filter.$and=[...(filter.$and||[]),{_id:{$in:[]}}]
    else filter.$and=[...(filter.$and||[]),{$or:branchPredicates.map(b=>b.initial)}]
  }
  if(quantity)filter.moq={$lte:quantity}
  const terms = (words || searchWords(options.q)).filter(w => typeof w === 'string' && w.trim()).slice(0, 15)
  if (!intent && terms.length) {
    const regexes = terms.map(w => new RegExp(escapeRegex(w.slice(0, 120)), 'i'))
    filter.$or = [{ name: { $in: regexes } }, { category: { $in: regexes } }, { description: { $in: regexes } }]
  }
  applyTaxonomyFilter(filter, options.taxonomyPath)
  const pipeline = [{ $match: filter }]
  if (priceQuantity) {
    pipeline.push({ $addFields: { _tiers: { $filter: { input: { $ifNull: ['$priceTiers', []] }, as: 't', cond: { $and: [{ $lte: ['$$t.minQty', priceQuantity] }, { $or: [{ $eq: [{ $ifNull: ['$$t.maxQty', null] }, null] }, { $gte: ['$$t.maxQty', priceQuantity] }] }] } } } } })
    pipeline.push({ $addFields: { effectiveUnitPrice: { $ifNull: [{ $arrayElemAt: ['$_tiers.price', 0] }, '$price'] } } })
  } else pipeline.push({ $addFields: { effectiveUnitPrice: '$price' } })
  const priceFilter = {}
  if (options.minPrice != null) priceFilter.$gte = options.minPrice
  if (options.maxPrice != null) priceFilter.$lte = options.maxPrice
  if (Object.keys(priceFilter).length) pipeline.push({ $match: { pricingMode: 'fixed', effectiveUnitPrice: priceFilter } })
  if(intent&&!intent.issues.length)pipeline.push({$match:{$or:branchPredicates.map(b=>b.priced)}})
  if(countOnly){const [row]=await Product.aggregate([...pipeline,{$count:'total'}]).option({maxTimeMS:5000});return {total:row?.total||0}}
  const exactExpression = !intent && !visual && options.q ? { $eq: [{ $toLower: { $ifNull: ['$name', ''] } }, options.q.toLowerCase()] } : false
  pipeline.push({ $addFields: { _rank: { $cond: [exactExpression, 0, 1] }, _priceMissing: { $cond: [{ $eq: ['$pricingMode', 'on_request'] }, 1, 0] } } })
  const order = intent?.sort || options.order
  const sort = order === 'price_asc' ? { _rank: 1, _priceMissing: 1, effectiveUnitPrice: 1, _id: 1 } : order === 'price_desc' ? { _rank: 1, _priceMissing: 1, effectiveUnitPrice: -1, _id: 1 } : order === 'newest' ? { _rank: 1, createdAt: -1, _id: 1 } : { _rank: 1, views: -1, _id: 1 }
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
  return { products, ...(intent?{searchPriceContext:{quantity:quantity??null,basis:quantity?'quantity':priceQuantity?'moq':'base'}}:{}), total: totals.total, exactCount: totals.exactCount, similarCount: totals.total - totals.exactCount, page: options.page, limit: options.limit, pagination: { page: options.page, limit: options.limit, total: totals.total, pages: Math.ceil(totals.total / options.limit), hasNextPage: options.page * options.limit < totals.total, hasPrevPage: options.page > 1 } }
}

module.exports = { PUBLIC_FIELDS, PUBLIC_VISIBILITY, imageUrlAllowed, badRequest, parseOptions, publicCatalogFilter, searchWords, searchCatalog, catalogCategories, categoryPredicate }
