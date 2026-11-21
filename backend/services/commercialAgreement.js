const { createHash } = require('crypto')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')

const conflict = message => Object.assign(new Error(message), { status: 409, code: 'RFQ_DECISION_CONFLICT' })
function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (value?.toHexString) return value.toHexString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
  return value
}
const agreementHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

async function captureOfferContext(rfq) {
  let [product, supplier] = await Promise.all([
    Product.findOne({ _id: rfq.productId, supplierId: rfq.supplierId }).select('name category description unit moq city country storeId updatedAt').lean(),
    Supplier.findById(rfq.supplierId).select('name phone organization').lean()
  ])
  // A linked request retains the unit and product definition it requested.
  // Promotional terms are provenance, never automatic acceptance of its price.
  if (rfq.wholesaleOpportunity?.version === 1) {
    const frozen = rfq.wholesaleOpportunity.product
    if (!frozen || String(frozen.id) !== String(rfq.productId)) throw conflict('تعريف منتج الفرصة غير متسق')
    product = { ...frozen, _id: rfq.productId }
  }
  if (!product?.name?.trim() || !product.unit?.trim() || !supplier) throw conflict('تعذر تثبيت تعريف المنتج والمورد؛ راجع بيانات العرض')
  return {
    productSnapshot: { id: String(product._id), name: product.name, category: product.category || '',
      description: product.description || '', unit: product.unit, moq: product.moq, city: product.city || '',
      country: product.country || '', storeId: product.storeId ? String(product.storeId) : null,
      catalogUpdatedAt: product.updatedAt || null, capturedAt: new Date() },
    supplierSnapshot: { id: String(supplier._id), name: supplier.name, phone: supplier.phone || '', organization: supplier.organization || '' }
  }
}

async function buildAgreement(rfq, offer, decidedAt) {
  let product = offer.productSnapshot, supplier = offer.supplierSnapshot
  let source = 'offer_snapshot'
  if (!product) {
    // This is a NEW decision on a legacy offer, not reconstruction of an old
    // accepted agreement. The source is explicit and old records stay intact.
    const context = await captureOfferContext(rfq)
    product = context.productSnapshot
    supplier = context.supplierSnapshot
    source = 'legacy_product_at_decision'
  }
  if (String(product.id) !== String(rfq.productId) || !product.name?.trim() || !product.unit?.trim() ||
      String(supplier?.id) !== String(rfq.supplierId) || !supplier.name?.trim()) throw conflict('بيانات تعريف العرض غير مكتملة')
  const { quantity, unitPrice, totalPrice, deliveryDays, currency } = offer
  const computed = quantity * unitPrice
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity !== rfq.quantity ||
      !Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0 ||
      Math.abs(computed - totalPrice) > Number.EPSILON * Math.max(1, computed) * 4 ||
      !Number.isSafeInteger(deliveryDays) || deliveryDays < 1 || !/^[A-Z]{3}$/.test(currency) || currency !== rfq.currency) {
    throw conflict('قيم العرض التجاري غير متسقة؛ يلزم عرض مصحح من المورد')
  }
  // Deliberately no image URLs or bytes: historical snapshots never grant media
  // access or bypass the live Phase A authorization policy.
  return { version: 1, source, rfqId: String(rfq._id), offerId: String(offer._id),
    buyer: { id: String(rfq.buyerId), name: rfq.buyerName, phone: rfq.buyerPhone, city: rfq.buyerCity || '' },
    supplier: canonical(supplier), product: canonical(product), unit: product.unit,
    quantity, unitPrice, totalPrice, currency, deliveryDays,
    paymentTerms: offer.paymentTerms || '', notes: offer.notes || '', requestNotes: rfq.notes || '',
    validUntil: offer.validUntil || null, offerCreatedAt: offer.createdAt, acceptedAt: decidedAt,
    ...(rfq.wholesaleOpportunity ? { wholesaleOpportunity: canonical(rfq.wholesaleOpportunity) } : {}) }
}

module.exports = { captureOfferContext, buildAgreement, agreementHash, conflict }
