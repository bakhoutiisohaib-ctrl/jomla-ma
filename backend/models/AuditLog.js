const mongoose = require('mongoose')

const AuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'SUPPLIER_VERIFIED',
      'SUPPLIER_REJECTED',
      'SUPPLIER_VERIFICATION_SUBMITTED',
      'PRODUCT_MODERATED',
      'PRODUCT_DELETED',
      'ADMIN_ROLE_UPDATED'
    ]
  },
  targetType: {
    type: String,
    required: true,
    enum: ['Supplier', 'Product', 'QuoteRequest', 'User']
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  performedBy: {
    id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    name:  String,
    email: String,
    role:  String
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ targetType: 1, targetId: 1 })

module.exports = mongoose.model('AuditLog', AuditLogSchema)
