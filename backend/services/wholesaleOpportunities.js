const crypto = require('crypto')
const mongoose = require('mongoose')
const Opportunity = require('../models/WholesaleOpportunity')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const { PUBLIC_VISIBILITY, parseOptions } = require('../utils/catalog')
const { STORE_VISIBLE } = require('./publicStore')
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }
const fail = (status, message) => Object.assign(new Error(message), { status })
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
const same = (a, b) => String(a) === String(b)
const fields = ['title', 'description', 'terms', 'price', 'currency', 'unit', 'moq', 'priceTiers', 'expiresAt']
const productFields = 'name category description imageUrl unit currency moq city country storeId supplierId updatedAt'
function normalize(body) {
  const text = (key, max, required = false) => {
    const value = body[key] == null && !required ? '' : body[key]
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(400, 'بيانات الفرصة النصية غير صحيحة')
    return value.trim()
  }
  const number = (value, integer = false) => {
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw fail(400, 'السعر أو الكمية غير صحيح')
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0 || n > 1000000000 || (integer && !Number.isSafeInteger(n))) throw fail(400, 'السعر أو الكمية غير صحيح')
    return n
  }
  const result = { title: text('title', 160, true), description: text('description', 2000), terms: text('terms', 2000),
    price: number(body.price), currency: text('currency', 3, true).toUpperCase(), unit: text('unit', 50, true), moq: number(body.moq, true) }
  if (!/^[A-Z]{3}$/.test(result.currency) || result.price < 0.01 || typeof body.expiresAt !== 'string' || body.expiresAt.length > 40) throw fail(400, 'العملة أو تاريخ الانتهاء غير صحيح')
  const expiry = new Date(body.expiresAt)
  if (!Number.isFinite(expiry.getTime())) throw fail(400, 'تاريخ الانتهاء غير صحيح')
  result.expiresAt = expiry.toISOString()
  if (body.priceTiers != null && !Array.isArray(body.priceTiers)) throw fail(400, 'شرائح الأسعار غير صحيحة')
  if ((body.priceTiers || []).length > 20) throw fail(400, 'الحد الأقصى 20 شريحة')
  result.priceTiers = (body.priceTiers || []).map(t => {
    if (!t || typeof t !== 'object') throw fail(400, 'شرائح الأسعار غير صحيحة')
    return { minQty: number(t.minQty, true), ...(t.maxQty == null || t.maxQty === '' ? {} : { maxQty: number(t.maxQty, true) }), price: number(t.price) }
  }).sort((a, b) => a.minQty - b.minQty)
  result.priceTiers.forEach((t, i, tiers) => {
    if (t.price < 0.01 || t.minQty < result.moq || (t.maxQty != null && t.maxQty < t.minQty) ||
        (i && (tiers[i-1].maxQty == null || t.minQty <= tiers[i-1].maxQty))) throw fail(400, 'شرائح الأسعار متداخلة أو لا تحترم MOQ')
  })
  return result
}
async function eligibleProduct(productId, owner) {
  const product = await Product.findOne({ _id: productId, ...(owner ? { supplierId: owner } : {}), ...PUBLIC_VISIBILITY }).select(productFields).lean().maxTimeMS(5000)
  if (!product) throw fail(404, 'المنتج أو الفرصة غير متاح')
  const [store, supplier] = await Promise.all([
    Store.findOne({ _id: product.storeId, supplierId: product.supplierId, ...STORE_VISIBLE }).select('name city').lean().maxTimeMS(5000),
    Supplier.findOne({ _id: product.supplierId, role: 'supplier', isActive: { $ne: false } }).select('name city').lean().maxTimeMS(5000)
  ])
  if (!store || !supplier) throw fail(404, 'المنتج أو الفرصة غير متاح')
  return { product, store, supplier }
}
function checkCommercial(input, product, publishing) {
  if (input.currency !== product.currency || input.unit !== product.unit || input.moq < product.moq) throw fail(400, 'وحدة الفرصة وعملتها يجب أن تطابق المنتج، وMOQ لا يقل عن المنتج')
  if (publishing && new Date(input.expiresAt) <= new Date()) throw fail(400, 'اختر تاريخ انتهاء مستقبلياً قبل النشر')
}
function dto(row, context = {}) {
  return { _id: row._id, productId: row.productId, storeId: row.storeId, supplierId: row.supplierId,
    ...Object.fromEntries(fields.map(f => [f, row[f]])), status: row.status === 'published' && new Date(row.expiresAt) <= new Date() ? 'expired' : row.status,
    revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt, ...context }
}
async function create(req) {
  const body = req.body || {}, owner = req.supplier.ownerId || req.supplier.id, key = req.get('Idempotency-Key')
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key) || !id(body.productId) || (body.status && body.status !== 'draft')) throw fail(400, 'معرف المحاولة والمنتج مطلوبان؛ احفظ مسودة أولاً')
  const input = { productId: body.productId.toLowerCase(), ...normalize(body) }
  const keyHash = hash({ owner, key }), inputHash = hash(input), _id = new mongoose.Types.ObjectId(keyHash.slice(0, 24))
  const read = () => Opportunity.findById(_id).select('+creationReceipt')
  let saved = await read()
  if (!saved) {
    const { product } = await eligibleProduct(input.productId, owner)
    checkCommercial(input, product, false)
    try { saved = await Opportunity.create([{ ...input, _id, supplierId: owner, storeId: product.storeId,
      status: 'draft', creationReceipt: { actorId: req.supplier.id, keyHash, inputHash } }], WRITE).then(rows => rows[0]) }
    catch (failure) { saved = await read(); if (!saved) throw failure }
  }
  if (!same(saved.supplierId, owner) || saved.creationReceipt?.keyHash !== keyHash || !same(saved.creationReceipt?.actorId, req.supplier.id)) throw fail(409, 'معرف المحاولة غير متاح')
  if (saved.creationReceipt.inputHash !== inputHash) throw fail(409, 'استُخدم معرف المحاولة مع بيانات مختلفة')
  return dto(saved)
}
async function update(req) {
  const owner = req.supplier.ownerId || req.supplier.id, body = req.body || {}
  const current = await Opportunity.findOne({ _id: req.params.id, supplierId: owner })
  if (!current) throw fail(404, 'الفرصة غير موجودة')
  if (!Number.isSafeInteger(body.revision) || body.revision !== current.revision) throw fail(409, 'تغيرت الفرصة؛ أعد تحميل النسخة الحالية')
  let change
  if (body.status === 'paused' && Object.keys(body).every(f => ['status', 'revision'].includes(f))) change = { status: 'paused' }
  else {
    if (body.productId != null && !same(body.productId, current.productId)) throw fail(400, 'لا يمكن تغيير منتج الفرصة؛ أنشئ فرصة مستقلة')
    if (!['draft', 'published', 'paused'].includes(body.status)) throw fail(400, 'حالة الفرصة غير صحيحة')
    const input = normalize(body), { product } = await eligibleProduct(current.productId, owner)
    if (!same(product.storeId, current.storeId)) throw fail(409, 'تغير متجر المنتج؛ أنشئ فرصة جديدة')
    checkCommercial(input, product, body.status === 'published')
    change = { ...input, status: body.status }
  }
  const saved = await Opportunity.findOneAndUpdate({ _id: current._id, supplierId: owner, revision: body.revision },
    { $set: change, $inc: { revision: 1 } }, { ...WRITE, returnDocument: 'after', runValidators: true })
  if (!saved) throw fail(409, 'تغيرت الفرصة؛ أعد تحميل النسخة الحالية')
  return dto(saved)
}
function joins() {
  return [
    { $lookup: { from: Product.collection.name, let: { pid: '$productId', owner: '$supplierId', store: '$storeId' }, pipeline: [
      { $match: { ...PUBLIC_VISIBILITY, $expr: { $and: [{ $eq: ['$_id', '$$pid'] }, { $eq: ['$supplierId', '$$owner'] }, { $eq: ['$storeId', '$$store'] }] } } },
      { $project: { name: 1, category: 1, description: 1, imageUrl: 1, city: 1, country: 1, moq: 1, unit: 1, currency: 1 } }
    ], as: 'product' } }, { $unwind: '$product' },
    { $lookup: { from: Store.collection.name, let: { sid: '$storeId', owner: '$supplierId' }, pipeline: [
      { $match: { ...STORE_VISIBLE, $expr: { $and: [{ $eq: ['$_id', '$$sid'] }, { $eq: ['$supplierId', '$$owner'] }] } } },
      { $project: { name: 1, city: 1 } }
    ], as: 'store' } }, { $unwind: '$store' },
    { $lookup: { from: Supplier.collection.name, let: { owner: '$supplierId' }, pipeline: [
      { $match: { role: 'supplier', isActive: { $ne: false }, $expr: { $eq: ['$_id', '$$owner'] } } },
      { $project: { name: 1, city: 1 } }
    ], as: 'supplier' } }, { $unwind: '$supplier' },
    // Parent commercial changes invalidate promotion rather than relabelling it.
    { $match: { $expr: { $and: [{ $eq: ['$unit', '$product.unit'] }, { $eq: ['$currency', '$product.currency'] }, { $gte: ['$moq', '$product.moq'] }] } } }
  ]
}
async function list(query) {
  const o = parseOptions(query), match = { status: 'published', expiresAt: { $gt: new Date() } }
  if (o.quantity) match.moq = { $lte: o.quantity }
  if (o.currency) match.currency = o.currency
  if ((o.minPrice != null || o.maxPrice != null) && !o.currency) throw fail(400, 'حدد العملة عند تصفية الأسعار')
  const pipeline = [{ $match: match }, ...joins()]
  if (o.category) pipeline.push({ $match: { 'product.category': o.category } })
  pipeline.push({ $addFields: { effectivePrice: o.quantity ? { $ifNull: [{ $arrayElemAt: [{ $map: { input: { $filter: {
    input: '$priceTiers', as: 't', cond: { $and: [{ $lte: ['$$t.minQty', o.quantity] }, { $gte: [{ $ifNull: ['$$t.maxQty', Number.MAX_SAFE_INTEGER] }, o.quantity] }] }
  } }, as: 'tier', in: '$$tier.price' } }, 0] }, '$price'] } : '$price' } })
  if (o.minPrice != null || o.maxPrice != null) pipeline.push({ $match: { effectivePrice: { ...(o.minPrice != null ? { $gte: o.minPrice } : {}), ...(o.maxPrice != null ? { $lte: o.maxPrice } : {}) } } })
  const [result] = await Opportunity.aggregate([...pipeline, { $facet: {
    data: [{ $sort: { createdAt: -1, _id: 1 } }, { $skip: (o.page-1)*Math.min(o.limit, 24) }, { $limit: Math.min(o.limit, 24) }, { $unset: ['creationReceipt', '__v'] }],
    total: [{ $count: 'count' }]
  } }]).option({ maxTimeMS: 5000 })
  return { data: result.data.map(row => ({ ...dto(row, { product: row.product, store: row.store, supplier: row.supplier }), effectivePrice: row.effectivePrice })),
    total: result.total[0]?.count || 0, page: o.page, limit: Math.min(o.limit, 24) }
}
async function publicDetail(value) {
  if (!id(String(value))) throw fail(404, 'الفرصة غير متاحة')
  const [row] = await Opportunity.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(value), status: 'published', expiresAt: { $gt: new Date() } } }, ...joins()]).option({ maxTimeMS: 5000 })
  if (!row) throw fail(404, 'الفرصة غير متاحة')
  return dto(row, { product: row.product, store: row.store, supplier: row.supplier })
}
async function snapshot(value, productId, quantity) {
  const offer = await publicDetail(value)
  if (!same(offer.productId, productId)) throw fail(400, 'الفرصة لا تخص هذا المنتج')
  if (quantity < offer.moq) throw fail(400, 'الكمية أقل من الحد الأدنى للفرصة')
  const tier = offer.priceTiers.find(t => quantity >= t.minQty && (t.maxQty == null || quantity <= t.maxQty))
  return { version: 1, id: String(offer._id), revision: offer.revision, title: offer.title,
    description: offer.description, terms: offer.terms, price: offer.price, currency: offer.currency, unit: offer.unit,
    moq: offer.moq, priceTiers: offer.priceTiers, quantity, indicativeUnitPrice: tier?.price ?? offer.price,
    expiresAt: offer.expiresAt, capturedAt: new Date(),
    product: { id: String(offer.productId), name: offer.product.name, category: offer.product.category, description: offer.product.description,
      unit: offer.unit, moq: offer.product.moq, city: offer.product.city, country: offer.product.country, storeId: String(offer.storeId) },
    store: { id: String(offer.storeId), name: offer.store.name } }
}
module.exports = { create, update, dto, list, publicDetail, snapshot, eligibleProduct, normalize }
