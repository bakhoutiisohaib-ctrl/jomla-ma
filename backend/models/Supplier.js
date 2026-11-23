const mongoose = require('mongoose')

const SupplierSchema = new mongoose.Schema({
  name:               { type: String, required: true },
  profilePending:     { type: Boolean, default: false },
  gender:             { type: String, enum: ['female', 'male', 'undisclosed'], default: 'undisclosed', select: false },
  city:               String,
  phone:              String,
  description:        String,
  avatar:             String,
  products:           [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  email:              { type: String, unique: true, required: true, trim: true, lowercase: true },
  password:           { type: String, required: true, select: false },
  role:               { type: String, enum: ['supplier', 'admin', 'buyer', 'staff'], default: 'supplier' },
  organization:       { type: String, default: '' }, // اسم الشركة أو المنظمة
  permissions:        [{ type: String }],            // صلاحيات الموظف (manage_products, manage_rfq, etc.)
  parentSupplierId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' }, // للموظف التابع لمنظمة مورد
  organizationId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  tokenVersion:       { type: Number, default: 0, select: false },
  passwordResetHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  passwordResetVersion: { type: Number, select: false },
  passwordResetSentAt: { type: Date, select: false },
  isActive:           { type: Boolean, default: true },
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
