const mongoose = require('mongoose')

// A promotion references catalog media; it never owns files or grants access.
const schema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, immutable: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160 },
  description: { type: String, maxlength: 2000, default: '' },
  terms: { type: String, maxlength: 2000, default: '' },
  price: { type: Number, required: true, min: 0.01, max: 1000000000 },
  currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
  unit: { type: String, required: true, maxlength: 50 },
  moq: { type: Number, required: true, min: 1, max: 1000000000, validate: Number.isSafeInteger },
  priceTiers: { type: [new mongoose.Schema({
    minQty: { type: Number, required: true }, maxQty: Number, price: { type: Number, required: true }
  }, { _id: false })], default: [] },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['draft', 'published', 'paused'], default: 'draft', required: true },
  revision: { type: Number, default: 0 },
  creationReceipt: { type: new mongoose.Schema({
    actorId: mongoose.Schema.Types.ObjectId, keyHash: String, inputHash: String
  }, { _id: false }), select: false, immutable: true }
}, { timestamps: true })

schema.index({ status: 1, expiresAt: 1, _id: 1 })
schema.index({ supplierId: 1, createdAt: -1 })
module.exports = mongoose.model('WholesaleOpportunity', schema)
