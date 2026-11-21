const mongoose = require('mongoose')

const StoreSchema = new mongoose.Schema({
  supplierId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  name:           { type: String, required: true, trim: true },
  slug:           { type: String, trim: true, lowercase: true },
  description:    { type: String, trim: true, default: '' },
  city:           { type: String, default: 'الدار البيضاء' },
  address:        { type: String, default: '' },
  phone:          String,
  logoUrl:        String,
  bannerUrl:      String,
  categories:     [{ type: String }],
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  reviewStatus:   { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewReason:   { type: String, default: '' },
  reviewedAt:     Date,
  reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  isActive:       { type: Boolean, default: false },
  adminSuspended: { type: Boolean, default: false },
  isVerified:     { type: Boolean, default: false },
  rating:         { type: Number, default: 0 },
  views:          { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now }
})

StoreSchema.index({ supplierId: 1, slug: 1 }, { unique: true })

module.exports = mongoose.model('Store', StoreSchema)
