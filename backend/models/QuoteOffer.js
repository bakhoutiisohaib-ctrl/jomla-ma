const mongoose = require('mongoose')

const QuoteOfferSchema = new mongoose.Schema({
  rfqId:          { type: mongoose.Schema.Types.ObjectId, ref: 'QuoteRequest', required: true },
  supplierId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  unitPrice:      { type: Number, required: true, min: 0 },
  totalPrice:     { type: Number, required: true, min: 0 },
  quantity:       { type: Number, required: true, min: 1 },
  deliveryDays:   { type: Number, default: 3, min: 1 },
  validUntil:     { type: Date },
  paymentTerms:   { type: String, trim: true, maxlength: 2000, default: '' },
  currency:       { type: String, default: 'MAD' },
  notes:          { type: String, trim: true, default: '' },
  // New offers describe the product as quoted, independent of later catalog
  // edits/deletion. No defaults: old offers are not silently backfilled.
  productSnapshot: { type: mongoose.Schema.Types.Mixed, immutable: true },
  supplierSnapshot: { type: mongoose.Schema.Types.Mixed, immutable: true },
  decisionId: { type: mongoose.Schema.Types.ObjectId },
  status:         { type: String, enum: ['preparing', 'active', 'accepted', 'rejected', 'expired', 'superseded'], default: 'active' },
  // Receipt retained after later replacements: old keys can never create a new
  // offer when the RFQ's single current journal has moved on.
  submission: { type: new mongoose.Schema({
    version: { type: Number, enum: [1], required: true },
    key: { type: String, required: true }, hash: { type: String, required: true },
    dataHash: { type: String, required: true },
    phase: { type: String, enum: ['pending', 'completed', 'expired'], required: true }
  }, { _id: false }), select: false, default: undefined },
  createdAt:      { type: Date, default: Date.now }
})

QuoteOfferSchema.index({ rfqId: 1, supplierId: 1, createdAt: -1 })
QuoteOfferSchema.index({ rfqId: 1, supplierId: 1, 'submission.key': 1 }, {
  name: 'rfq_offer_submission_key', unique: true,
  partialFilterExpression: { 'submission.key': { $type: 'string' } }
})
for (const format of ['toJSON', 'toObject']) QuoteOfferSchema.set(format, {
  transform: (_document, value) => { delete value.submission; return value }
})

module.exports = mongoose.model('QuoteOffer', QuoteOfferSchema)
