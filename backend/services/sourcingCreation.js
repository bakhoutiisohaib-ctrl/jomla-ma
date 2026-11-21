const crypto = require('crypto')
const SourcingRequest = require('../models/SourcingRequest')
const { inspect } = require('./sourcingCreationIndex')
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }
const error = (status, code, message) => Object.assign(new Error(message), { status, code })
const uncertain = () => error(503, 'SOURCING_CREATION_UNCONFIRMED', 'تعذر تأكيد نتيجة الإنشاء؛ استكمل المحاولة نفسها دون تغيير بياناتها')
function keyFrom(req) {
  const key = req.get('Idempotency-Key')
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw error(400, 'SOURCING_CREATION_KEY_REQUIRED', 'مفتاح محاولة إنشاء صالح مطلوب')
  }
  return key
}
const text = (value, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function normalize(body = {}) {
  body = body || {}
  const input = {
    buyerPhone: text(body.buyerPhone, 30), buyerCity: text(body.buyerCity, 200),
    productName: text(body.productName, 300), category: text(body.category, 200),
    quantity: Number(body.quantity), unit: text(body.unit, 50) || 'قطعة',
    targetPrice: body.targetPrice == null || body.targetPrice === '' ? null : Number(body.targetPrice),
    imageUrl: text(body.imageUrl, 2000), notes: text(body.notes)
  }
  if (!input.productName || !/^[+0-9\s\-()]{8,20}$/.test(input.buyerPhone) ||
      !Number.isInteger(input.quantity) || input.quantity < 1 ||
      (input.targetPrice !== null && (!Number.isFinite(input.targetPrice) || input.targetPrice < 0))) {
    throw error(400, 'SOURCING_CREATION_INPUT_INVALID', 'يرجى التحقق من المنتج والهاتف والكمية والسعر')
  }
  if (input.imageUrl && !/^https:\/\//i.test(input.imageUrl)) {
    throw error(400, 'SOURCING_CREATION_INPUT_INVALID', 'رابط الصورة يجب أن يستخدم HTTPS')
  }
  return input
}
async function receipt(buyerId, key) {
  try {
    const found = await SourcingRequest.find({ buyerId, 'creationReceipt.key': key })
      .select('+creationReceipt').read('primary').collation({ locale: 'simple' }).limit(2).maxTimeMS(10000)
    if (found.length > 1) throw uncertain()
    if (found[0] && (found[0].creationReceipt?.version !== 1 || !/^[a-f0-9]{64}$/.test(found[0].creationReceipt.hash))) throw uncertain()
    return found[0] || null
  } catch { throw uncertain() }
}
function compare(sourcing, hash) {
  if (sourcing.creationReceipt?.version !== 1 || sourcing.creationReceipt.hash !== hash) {
    throw error(409, 'SOURCING_CREATION_KEY_CONFLICT', 'مفتاح المحاولة مستخدم لبيانات مختلفة؛ استكمل الطلب الأصلي')
  }
  return sourcing
}
async function create(req) {
  const key = keyFrom(req), input = normalize(req.body), buyerId = String(req.supplier.id)
  const hash = crypto.createHash('sha256').update(JSON.stringify({ version: 1, buyerId, input })).digest('hex')
  let ready = false
  try { ready = await inspect(SourcingRequest.collection) } catch { /* Fail closed without raw Mongo errors. */ }
  if (!ready) throw error(503, 'SOURCING_CREATION_INDEX_REQUIRED', 'إنشاء طلب التوريد متوقف حتى تهيئة فهرس منع التكرار والتحقق منه')
  let sourcing = await receipt(buyerId, key)
  if (sourcing) return { sourcing: compare(sourcing, hash), replayed: true }
  const candidate = new SourcingRequest({ ...input, targetPrice: input.targetPrice === null ? undefined : input.targetPrice,
    buyerId, buyerName: req.supplier.name, creationReceipt: { version: 1, key, hash } })
  let acknowledged = false
  try { await candidate.save(WRITE); acknowledged = true } catch { /* Lost acknowledgement, duplicate or pre-write failure: reread below. */ }
  sourcing = await receipt(buyerId, key)
  if (!sourcing) throw uncertain()
  return { sourcing: compare(sourcing, hash), replayed: !acknowledged || String(sourcing._id) !== String(candidate._id) }
}
async function lookup(req) {
  const sourcing = await receipt(String(req.supplier.id), keyFrom(req))
  if (!sourcing) throw error(404, 'SOURCING_CREATION_NOT_FOUND', 'لم يتم العثور على نتيجة مؤكدة؛ أعد استكمال المحاولة نفسها')
  return sourcing
}
module.exports = { create, lookup }
