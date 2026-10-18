const mongoose = require('mongoose')

const SupplierSchema = new mongoose.Schema({
  name:        String,
  city:        String,
  phone:       String,
  description: String,
  products:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  email:       { type: String, unique: true },
  password:    String
})

module.exports = mongoose.model('Supplier', SupplierSchema)
