const mongoose = require('mongoose')

// A bounded, local feature vector, not a learned semantic embedding (e.g. CLIP).
// Documents are internal and must never be returned directly by an API.
const VisualEmbeddingSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
  imageUrl: { type: String, default: '', maxlength: 2048 },
  sourceFingerprint: { type: String, required: true },
  version: { type: String, required: true },
  status: { type: String, enum: ['indexed', 'unindexed'], required: true },
  reason: { type: String, maxlength: 80 },
  sha256: { type: String, match: /^[a-f0-9]{64}$/ },
  perceptualHash: { type: String, match: /^[a-f0-9]{16}$/ },
  vector: { type: [Number], default: undefined, select: false },
  format: String,
  width: Number,
  height: Number,
  indexedAt: { type: Date, default: Date.now },
  indexedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' }
}, { versionKey: false })

VisualEmbeddingSchema.index({ version: 1, status: 1 })
module.exports = mongoose.model('VisualEmbedding', VisualEmbeddingSchema)
