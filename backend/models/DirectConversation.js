const mongoose = require('mongoose')
const oid = mongoose.Schema.Types.ObjectId
const Message = new mongoose.Schema({
  clientId: { type: String, required: true, match: /^[a-f0-9-]{36}$/ },
  role: { type: String, required: true, enum: ['buyer', 'supplier'] },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  sentAt: { type: Date, required: true },
  noticeId: { type: oid, default: undefined },
  noticeReadAt: { type: Date, default: undefined }
}, { _id: false })

// Independent pre-RFQ conversations cannot create offers or trade confirmations.
const schema = new mongoose.Schema({
  _id: { type: oid, required: true },
  buyerId: { type: oid, required: true, immutable: true },
  supplierId: { type: oid, required: true, immutable: true },
  productId: { type: oid, required: true, immutable: true },
  productName: { type: String, required: true, immutable: true, maxlength: 160 },
  buyerName: { type: String, required: true, immutable: true, maxlength: 160 },
  supplierName: { type: String, required: true, immutable: true, maxlength: 160 },
  messages: { type: [Message], required: true, validate: v => v.length >= 1 && v.length <= 200 },
  createdAt: { type: Date, required: true, immutable: true },
  lastMessageAt: { type: Date, required: true }
})
schema.index({ buyerId: 1, lastMessageAt: -1, _id: -1 })
schema.index({ supplierId: 1, lastMessageAt: -1, _id: -1 })
module.exports = mongoose.model('DirectConversation', schema)
