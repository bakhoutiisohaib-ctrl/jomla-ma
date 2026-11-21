const mongoose = require('mongoose')

const OfferSchema = new mongoose.Schema({
  unitPrice:    { type: Number, min: 0 },
  totalPrice:   { type: Number, min: 0 },
  deliveryDays: { type: Number, min: 1 },
  notes:        { type: String, trim: true },
  respondedAt:  { type: Date, default: Date.now },
  productSnapshot: { type: mongoose.Schema.Types.Mixed }
}, { _id: false })

// Single-document durable decision/outbox. Legacy RFQs have no decision and are
// deliberately excluded from automatic reconciliation.
const DecisionSchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true, enum: [1] },
  action: { type: String, required: true, enum: ['accept', 'reject'] },
  offerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actor: { id: mongoose.Schema.Types.ObjectId, role: String, name: String },
  decidedAt: { type: Date, required: true },
  phase: { type: String, required: true, enum: ['pending', 'completed'] },
  agreement: mongoose.Schema.Types.Mixed,
  agreementHash: String,
  attempts: { type: Number, default: 0 },
  nextAttemptAt: Date,
  lastErrorCode: String,
  completedAt: Date
}, { _id: false })

const QuoteRequestSchema = new mongoose.Schema({
  buyerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  supplierId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  buyerName:   { type: String, required: true, trim: true },
  buyerPhone:  { type: String, required: true, trim: true },
  buyerCity:   { type: String, trim: true },
  quantity:    { type: Number, required: true, min: 1 },
  currency:    { type: String, default: 'MAD' },
  targetPrice: { type: Number, min: 0 }, // السعر المستهدف المقترح من المشتري
  notes:       { type: String, trim: true }, // متطلبات خاصة (ألوان، قياسات، تغليف)
  // Server-captured W1 context only; absent on historical RFQs. No media grants.
  wholesaleOpportunity: { type: mongoose.Schema.Types.Mixed, immutable: true, default: undefined },
  status: {
    type: String,
    enum: ['creating', 'pending', 'responded', 'offering', 'deciding', 'accepted', 'rejected'],
    default: 'pending'
  },
  offer:       OfferSchema,
  currentOfferId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuoteOffer' },
  revision:    { type: Number, default: 0 },
  decision: { type: DecisionSchema, default: undefined },
  // Supplier refusal is independent of the buyer decision/offer journals.
  // Absent on historical requests; never inferred or backfilled.
  supplierRejection: { type: new mongoose.Schema({
    kind: { type: String, required: true, enum: ['supplier_rejection'] },
    version: { type: Number, required: true, enum: [1] },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    rfqId: { type: mongoose.Schema.Types.ObjectId, required: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actor: { id: mongoose.Schema.Types.ObjectId, ownerId: mongoose.Schema.Types.ObjectId, name: String, role: String },
    threadId: { type: mongoose.Schema.Types.ObjectId, required: true },
    previousStatus: { type: String, required: true, enum: ['pending', 'responded'] },
    previousOfferId: mongoose.Schema.Types.ObjectId,
    claimedRevision: { type: Number, required: true },
    decidedAt: { type: Date, required: true },
    phase: { type: String, required: true, enum: ['pending', 'completed'] },
    attempts: { type: Number, default: 0 }, nextAttemptAt: Date,
    lastErrorCode: String, completedAt: Date
  }, { _id: false }), select: false, default: undefined },
  // R3 owns only this submission journal. The previous offer/pointer stay intact
  // while status=offering fences Phase B's existing responded/revision CAS.
  offerSubmission: { type: new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    key: { type: String, required: true }, hash: { type: String, required: true },
    offerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    phase: { type: String, required: true, enum: ['pending', 'committing', 'aborting', 'completed', 'expired'] },
    previousStatus: { type: String, required: true, enum: ['pending', 'responded'] },
    previousOfferId: mongoose.Schema.Types.ObjectId,
    actor: { id: mongoose.Schema.Types.ObjectId, name: String },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    dataHash: { type: String, required: true },
    startedAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 }, nextAttemptAt: Date,
    lastErrorCode: String, completedAt: Date
  }, { _id: false }), select: false, default: undefined },
  // Only new R2 requests carry this durable creation journal. Historical RFQs
  // are never inferred/backfilled, and the Phase B decision journal is separate.
  creation: { type: new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    key: { type: String, required: true }, hash: { type: String, required: true },
    phase: { type: String, required: true, enum: ['pending', 'completed'] },
    threadId: { type: mongoose.Schema.Types.ObjectId, required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    subject: { type: String, required: true }, initialContent: { type: String, required: true },
    attempts: { type: Number, default: 0 }, nextAttemptAt: Date,
    lastErrorCode: String, completedAt: Date
  }, { _id: false }), select: false, default: undefined },
  createdAt:   { type: Date, default: Date.now }
})

QuoteRequestSchema.index({ supplierId: 1, status: 1, createdAt: -1 })
QuoteRequestSchema.index({ buyerId: 1, createdAt: -1 })
QuoteRequestSchema.index({ 'decision.phase': 1, 'decision.nextAttemptAt': 1, _id: 1 })
QuoteRequestSchema.index({ buyerId: 1, 'creation.key': 1 }, { name: 'rfq_creation_buyer_key', unique: true,
  partialFilterExpression: { 'creation.key': { $type: 'string' } } })
QuoteRequestSchema.index({ status: 1, 'creation.version': 1, 'creation.phase': 1, 'creation.nextAttemptAt': 1, _id: 1 })
QuoteRequestSchema.index({ 'offerSubmission.version': 1, 'offerSubmission.phase': 1, 'offerSubmission.nextAttemptAt': 1, _id: 1 }, { name: 'rfq_offer_recovery' })
for (const format of ['toJSON', 'toObject']) QuoteRequestSchema.set(format, {
  transform: (_document, value) => { delete value.creation; delete value.offerSubmission; delete value.supplierRejection; return value }
})

module.exports = mongoose.model('QuoteRequest', QuoteRequestSchema)
