const crypto = require('crypto')
const Product = require('../models/Product')

const INDEX_NAME = 'product_creation_owner_key'
const INPUT_FIELDS = ['name', 'category', 'taxonomyPath', 'pricingMode', 'price', 'currency', 'country', 'moq', 'unit', 'priceTiers', 'availability', 'availabilityConfirmed', 'inStock', 'city', 'description', 'images', 'imageUrl', 'isDraft', 'storeId', 'hasImageRights', 'publishApproved']

function failure(status, message) { return Object.assign(new Error(message), { status }) }
function canonical(value, depth = 0) {
  if (depth > 35) throw failure(400, 'بيانات المنتج متداخلة أكثر من المسموح')
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1))
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)]))
}

function productInput(body) {
  const input = Object.fromEntries(INPUT_FIELDS.filter(field => body[field] !== undefined).map(field => [field, body[field]]))
  if (body.imageRights !== undefined) input.imageRights = Object.fromEntries(['source', 'licenseReference'].filter(field => body.imageRights?.[field] !== undefined).map(field => [field, body.imageRights[field]]))
  return input
}

function requestIdentity(req) {
  const key = req.get('Idempotency-Key')
  // Old API clients retain their existing contract. The current editor always
  // supplies a key; an invalid supplied key must never silently become unkeyed.
  if (key === undefined) return null
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw failure(400, 'معرف محاولة الحفظ غير صالح')
  const input = productInput(req.body)
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical({ actorId: req.supplier.id, input }))).digest('hex')
  return { key, hash, actorId: req.supplier.id, organizationId: req.supplier.organizationId || null }
}

async function requireCreationIndex() {
  // init() can succeed with autoIndex disabled. Verify the actual Mongo index
  // as well, and fail closed rather than offering an unproved guarantee.
  try {
    await Product.init()
    const indexes = await Product.collection.indexes()
    const index = indexes.find(item => item.name === INDEX_NAME)
    const exactKeys = JSON.stringify(canonical(index?.key)) === JSON.stringify(canonical({ supplierId: 1, 'creationReceipt.key': 1 }))
    const exactPartial = JSON.stringify(canonical(index?.partialFilterExpression)) === JSON.stringify({ 'creationReceipt.key': { $type: 'string' } })
    if (!index?.unique || !exactKeys || !exactPartial || index.sparse || (index.collation && index.collation.locale !== 'simple')) throw new Error('Missing creation index')
  } catch { throw failure(503, 'تعذر تأكيد حماية محاولة الحفظ؛ أعد المحاولة لاحقاً بنفس المعرف') }
}

function publicProduct(product) {
  const result = typeof product.toObject === 'function' ? product.toObject({ transform: false }) : { ...product }
  delete result.creationReceipt
  delete result.updateReceipt
  return result
}

// The unique identity, fingerprint and original product result are committed
// in ONE insert. No separate reservation/ledger or multi-document transaction.
async function createProductOnce(req, prepareProduct) {
  const identity = requestIdentity(req)
  const ownerId = req.supplier.ownerId || req.supplier.id
  const filter = identity && { supplierId: ownerId, 'creationReceipt.key': identity.key }
  if (identity) await requireCreationIndex()
  let product = identity && await Product.findOne(filter).select('+creationReceipt')
  let replayed = Boolean(product)
  if (!product) {
    product = await prepareProduct(new Product({ supplierId: ownerId }), req)
    if (identity) {
      const now = new Date()
      product.createdAt = now; product.updatedAt = now; product.__v = 0
      product.creationReceipt = { ...identity, snapshot: JSON.parse(JSON.stringify(publicProduct(product))) }
    }
    try { await product.save(identity ? { timestamps: false } : {}) }
    catch (error) {
      if (!identity || error.code !== 11000) throw error
      product = await Product.findOne(filter).select('+creationReceipt')
      if (!product) throw failure(503, 'تعذر استرجاع محاولة الحفظ؛ أعد المحاولة بنفس المعرف')
      replayed = true
    }
  }
  if (identity && product.creationReceipt?.hash !== identity.hash) throw failure(409, 'استُخدم معرف محاولة الحفظ مع بيانات أو منفذ مختلف؛ لا ترسل منتجاً جديداً قبل مراجعة المحاولة الأصلية')
  return { product, receipt: identity ? product.creationReceipt : null, replayed }
}

module.exports = { createProductOnce, publicProduct, canonical, productInput }
