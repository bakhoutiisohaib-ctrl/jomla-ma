const mongoose = require('mongoose')

const OrganizationSchema = new mongoose.Schema({
  ownerSupplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 3000 },
  country: { type: String, default: 'MA', uppercase: true, match: /^[A-Z]{2}$/ },
  city: { type: String, default: '', maxlength: 100 }
}, { timestamps: true })

module.exports = mongoose.model('Organization', OrganizationSchema)
