const mongoose = require('mongoose')

const QuoteOfferSchema = new mongoose.Schema({
  rfqId:          { type: mongoose.Schema.Types.ObjectId, ref: 'QuoteRequest', required: true },
  supplierId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  unitPrice:      { type: Number, required: true, min: 0 },
  totalPrice:     { type: Number, required: true, min: 0 },
  quantity:       { type: Number, required: true, min: 1 },
  deliveryDays:   { type: Number, default: 3, min: 1 },
  validUntil:     { type: Date },
  paymentTerms:   { type: String, default: 'دفع عند الاستلام أو تحويل بنكي' },
  notes:          { type: String, trim: true, default: '' },
  status:         { type: String, enum: ['active', 'accepted', 'rejected', 'expired'], default: 'active' },
  createdAt:      { type: Date, default: Date.now }
})

QuoteOfferSchema.index({ rfqId: 1, supplierId: 1, createdAt: -1 })

module.exports = mongoose.model('QuoteOffer', QuoteOfferSchema)
