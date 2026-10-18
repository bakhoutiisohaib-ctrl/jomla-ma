const mongoose = require('mongoose')

const OfferSchema = new mongoose.Schema({
  unitPrice:    { type: Number, min: 0 },
  totalPrice:   { type: Number, min: 0 },
  deliveryDays: { type: Number, min: 1 },
  notes:        { type: String, trim: true },
  respondedAt:  { type: Date, default: Date.now }
}, { _id: false })

const QuoteRequestSchema = new mongoose.Schema({
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  supplierId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  buyerName:   { type: String, required: true, trim: true },
  buyerPhone:  { type: String, required: true, trim: true },
  buyerCity:   { type: String, trim: true },
  quantity:    { type: Number, required: true, min: 1 },
  targetPrice: { type: Number, min: 0 }, // السعر المستهدف المقترح من المشتري
  notes:       { type: String, trim: true }, // متطلبات خاصة (ألوان، قياسات، تغليف)
  status: {
    type: String,
    enum: ['pending', 'responded', 'accepted', 'rejected'],
    default: 'pending'
  },
  offer:       OfferSchema,
  createdAt:   { type: Date, default: Date.now }
})

QuoteRequestSchema.index({ supplierId: 1, status: 1, createdAt: -1 })

module.exports = mongoose.model('QuoteRequest', QuoteRequestSchema)
