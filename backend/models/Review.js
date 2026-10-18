const mongoose = require('mongoose')

const ReviewSchema = new mongoose.Schema({
  productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  userName:   String,
  stars:      { type: Number, min: 1, max: 5 },
  comment:    String,
  reply: {
    text: String,
    date: Date
  },
  date:       { type: Date, default: Date.now }
})

module.exports = mongoose.model('Review', ReviewSchema)
