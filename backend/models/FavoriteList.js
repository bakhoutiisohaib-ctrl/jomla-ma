const mongoose = require('mongoose')

// One bounded list per authenticated buyer. No product snapshots or contact data.
const FavoriteListSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
}, { versionKey: false })

module.exports = mongoose.model('FavoriteList', FavoriteListSchema)
