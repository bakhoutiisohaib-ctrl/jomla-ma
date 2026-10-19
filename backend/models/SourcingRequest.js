const mongoose = require('mongoose')

const SourcingRequestSchema = new mongoose.Schema({
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
  createdAt:   { type: Date, default: Date.now }
})

SourcingRequestSchema.index({ status: 1, createdAt: -1 })
SourcingRequestSchema.index({ category: 1, buyerCity: 1 })

module.exports = mongoose.model('SourcingRequest', SourcingRequestSchema)
