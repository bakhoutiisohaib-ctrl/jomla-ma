const mongoose = require('mongoose')

// Upload ownership is established once, before a product exists. Attaching or
// transferring a product never changes ownership of the original bytes.
const immutable = (type, options = {}) => ({ type, immutable: true, ...options })
const MediaAssetSchema = new mongoose.Schema({
  filename: immutable(String, { required: true, unique: true, match: /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/ }),
  imageUrl: immutable(String, { required: true, unique: true, match: /^\/uploads\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/ }),
  ownerSupplierId: immutable(mongoose.Schema.Types.ObjectId, { ref: 'Supplier', required: true, index: true }),
  organizationId: immutable(mongoose.Schema.Types.ObjectId, { ref: 'Organization', default: null }),
  uploadedBy: immutable(mongoose.Schema.Types.ObjectId, { ref: 'Supplier', required: true }),
  mimetype: immutable(String, { required: true, enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }),
  size: immutable(Number, { required: true, min: 20, max: 10 * 1024 * 1024 }),
  sha256: immutable(String, { required: true, match: /^[a-f0-9]{64}$/ })
}, { timestamps: true })

module.exports = mongoose.model('MediaAsset', MediaAssetSchema)
