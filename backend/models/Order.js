const mongoose = require('mongoose')

const OrderSchema = new mongoose.Schema({
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  supplierId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  buyerName:   String,
  buyerPhone:  String,
  quantity:    { type: Number, default: 1 },
  totalPrice:  Number,
  status:      { type: String, default: 'pending' }, // pending, confirmed, shipped, delivered, cancelled
  createdAt:   { type: Date, default: Date.now }
})

module.exports = mongoose.model('Order', OrderSchema)
