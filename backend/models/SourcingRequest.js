const mongoose = require('mongoose')
const optional = schema => ({ type: schema, default: undefined })
const objectId = { type: mongoose.Schema.Types.ObjectId, required: true }
const InputSchema = new mongoose.Schema({ unitPrice: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, enum: ['MAD'] }, deliveryDays: { type: Number, required: true, min: 1 },
  paymentTerms: { type: String, maxlength: 2000, required: false }, notes: { type: String, maxlength: 5000, required: false } }, { _id: false })
const SnapshotSchema = new mongoose.Schema({ version: { type: Number, enum: [1], required: true }, pricedAt: { type: Date, required: true },
  request: { id: objectId, buyerId: objectId, productName: String, category: String, quantity: Number, unit: String, buyerCity: String,
    targetPrice: Number, imageUrl: String, notes: String },
  offer: { supplierId: objectId, actorId: objectId, supplierName: String, unitPrice: Number, totalPrice: Number,
    currency: String, deliveryDays: Number, paymentTerms: String, notes: String } }, { _id: false })
const OperationSchema = new mongoose.Schema({ version: { type: Number, required: true, enum: [1] },
  kind: { type: String, enum: ['sourcing_offer', 'sourcing_decision'], required: true }, phase: { type: String, enum: ['pending'], required: true },
  id: objectId, parentId: objectId, buyerId: objectId, supplierId: objectId, quoteId: objectId, notificationId: objectId,
  actor: { id: objectId, ownerId: objectId, role: { type: String, enum: ['supplier', 'admin', 'staff', 'buyer'] }, name: String },
  key: { type: String, required() { return this.kind === 'sourcing_offer' } }, hash: { type: String, required: true }, baselineHash: { type: String, required: true },
  input: { type: InputSchema, required() { return this.kind === 'sourcing_offer' } }, commercialSnapshot: { type: SnapshotSchema, required: true },
  action: { type: String, enum: ['accept', 'reject'] }, source: { type: String, enum: ['s2_commercial_snapshot', 'legacy_sourcing_quote_at_decision'] },
  expectedVersion: { type: Number, required: true }, previousStatus: String, startedAt: { type: Date, required: true },
  recoveryPausedAt: Date, expiresAt: Date, attempts: Number, nextAttemptAt: Date, lastErrorCode: { type: String, maxlength: 64 } }, { _id: false })

const SourcingRequestSchema = new mongoose.Schema({
  operation: optional(OperationSchema),
  creationReceipt: { type: new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    key: { type: String, required: true },
    hash: { type: String, required: true }
  }, { _id: false }), required: false, default: undefined, select: false },
  buyerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  buyerName:   { type: String, required: true, trim: true },
  buyerPhone:  { type: String, required: true, trim: true },
  buyerCity:   { type: String, trim: true },
  productName: { type: String, required: true, trim: true },
  category:    { type: String, trim: true },
  quantity:    { type: Number, required: true, min: 1 },
  unit:        { type: String, default: 'قطعة' },
  targetPrice: { type: Number, min: 0 }, // السعر المستهدف للوحدة بالدرهم
  imageUrl:    { type: String, trim: true },
  notes:       { type: String, trim: true },
  status: {
    type: String,
    enum: ['open', 'quoted', 'fulfilled', 'closed'],
    default: 'open'
  },
  quotesCount: { type: Number, default: 0 },
  quotes: [{
    decisionReceipt: optional(new mongoose.Schema({ version: { type: Number, enum: [1], required: true },
      id: objectId, buyerId: objectId, quoteId: objectId, notificationId: objectId,
      action: { type: String, enum: ['accept', 'reject'], required: true }, decidedAt: { type: Date, required: true },
      source: { type: String, required: true }, hash: { type: String, required: true }, commercialSnapshot: { type: SnapshotSchema, required: true } }, { _id: false })),
    agreement: optional(new mongoose.Schema({ version: { type: Number, enum: [1], required: true }, quoteId: objectId,
      source: { type: String, required: true }, agreedAt: { type: Date, required: true }, snapshot: { type: SnapshotSchema, required: true } }, { _id: false })),
    submission: optional(new mongoose.Schema({ version: { type: Number, required: true, enum: [1] },
      id: objectId, key: { type: String, required: true }, hash: { type: String, required: true }, notificationId: objectId }, { _id: false })),
    commercialSnapshot: optional(SnapshotSchema),
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: 'MAD' },
    deliveryDays: { type: Number, required: true, min: 1 },
    paymentTerms: { type: String, trim: true, maxlength: 2000, default: '' },
    notes: { type: String, trim: true, maxlength: 5000, default: '' },
    status: { type: String, enum: ['active', 'accepted', 'rejected', 'superseded'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt:   { type: Date, default: Date.now }
}, { optimisticConcurrency: true })

SourcingRequestSchema.index({ status: 1, createdAt: -1 })
SourcingRequestSchema.index({ category: 1, buyerCity: 1 })

// Strip explicitly selected receipts and newly created documents as well.
const hideReceipt = (doc, result) => {
  delete result.creationReceipt; delete result.operation
  for (const quote of result.quotes || []) {
    delete quote.submission
    delete quote.decisionReceipt
    if (quote.commercialSnapshot?.request) delete quote.commercialSnapshot.request.buyerId
    if (quote.agreement?.snapshot?.request) delete quote.agreement.snapshot.request.buyerId
  }
  return result
}
SourcingRequestSchema.set('toJSON', { transform: hideReceipt })
SourcingRequestSchema.set('toObject', { transform: hideReceipt })
module.exports = mongoose.model('SourcingRequest', SourcingRequestSchema)
