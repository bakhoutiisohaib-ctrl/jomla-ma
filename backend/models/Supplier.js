const mongoose = require('mongoose')

const SupplierSchema = new mongoose.Schema({
  name:               { type: String, required: true },
  city:               String,
  phone:              String,
  description:        String,
  avatar:             String,
  products:           [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  email:              { type: String, unique: true, required: true },
  password:           { type: String, required: true },
  role:               { type: String, enum: ['supplier', 'admin'], default: 'supplier' },
  isVerified:         { type: Boolean, default: false },
  verificationStatus: { type: String, enum: ['unverified', 'pending', 'verified', 'rejected'], default: 'unverified' },
  iceNumber:          { type: String, default: '' }, // المعرف الموحد للمقاولة ICE
  tradeRegistry:      { type: String, default: '' }, // رقم السجل التجاري RC
  verificationDoc:    { type: String, default: '' }, // رابط وثيقة الترخيص أو السجل
  verifiedAt:         { type: Date },
  rejectionReason:    { type: String, default: '' },
  createdAt:          { type: Date, default: Date.now }
})

module.exports = mongoose.model('Supplier', SupplierSchema)

