const mongoose = require('mongoose')

const ReviewSchema = new mongoose.Schema({
  productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  buyerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  userName:   { type: String, required: true },
  stars:      { type: Number, min: 1, max: 5, required: true, validate: Number.isInteger },
  comment:    { type: String, trim: true, maxlength: 500, default: '' },
  reply: {
    text: String,
    date: Date
  },
  date:       { type: Date, default: Date.now }
})

// Legacy reviews remain readable; authenticated accounts get one review per supplier.
ReviewSchema.index({ supplierId: 1, buyerId: 1 }, { unique: true, partialFilterExpression: { buyerId: { $type: 'objectId' } } })

module.exports = mongoose.model('Review', ReviewSchema)
