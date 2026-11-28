const mongoose = require('mongoose')

const MessageItemSchema = new mongoose.Schema({
  senderRole:  { type: String, enum: ['buyer', 'supplier', 'admin'], required: true },
  senderName:  { type: String, required: true },
  senderPhone: { type: String },
  senderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  content:     { type: String, required: true, trim: true, maxlength: 5000 },
  attachment:  { type: String },
  sentAt:      { type: Date, default: Date.now },
  delivery: { type: new mongoose.Schema({
    version: { type: Number, enum: [1], required: true },
    hash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    recipientId: { type: mongoose.Schema.Types.ObjectId, required: true },
    phase: { type: String, enum: ['pending','completed'], required: true },
    attempts: { type: Number, min: 0, default: 0 },
    nextAttemptAt: Date
  }, { _id: false }), default: undefined }
}, { _id: true })

const MessageThreadSchema = new mongoose.Schema({
  rfqId:        { type: mongoose.Schema.Types.ObjectId, ref: 'QuoteRequest', required: true },
  productId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  supplierId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  buyerName:    { type: String, required: true },
  buyerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  buyerPhone:   { type: String, required: true },
  subject:      { type: String, default: 'محادثة تفاوض حول عرض السعر' },
  status:       { type: String, enum: ['open', 'closed', 'archived'], default: 'open' },
  decisionId:   { type: mongoose.Schema.Types.ObjectId },
  messages:     [MessageItemSchema],
  lastMessageAt:{ type: Date, default: Date.now },
  createdAt:    { type: Date, default: Date.now }
})

MessageThreadSchema.index({ rfqId: 1 }, { unique: true })
MessageThreadSchema.index({ 'messages.delivery.nextAttemptAt': 1 }, { sparse: true })

module.exports = mongoose.model('MessageThread', MessageThreadSchema)
