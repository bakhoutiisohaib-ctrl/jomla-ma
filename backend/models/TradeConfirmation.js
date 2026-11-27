const mongoose = require('mongoose')
const id = () => ({ type: mongoose.Schema.Types.ObjectId, required: true, immutable: true })
const schema = new mongoose.Schema({
  kind: { type: String, enum: ['rfq', 'sourcing'], required: true, immutable: true },
  sourceId: id(), offerId: id(), decisionId: id(), buyerId: id(), supplierId: id(),
  productId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  decisionHash: { type: String, required: true, immutable: true },
  buyerConfirmedAt: Date, supplierConfirmedAt: Date
})
schema.index({ buyerId: 1, supplierId: 1 })
module.exports = mongoose.model('TradeConfirmation', schema)
