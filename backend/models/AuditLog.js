const mongoose = require('mongoose')

const AuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'SUPPLIER_VERIFIED',
      'SUPPLIER_REJECTED',
      'SUPPLIER_VERIFICATION_SUBMITTED', 'SUPPLIER_BUSINESS_TYPES_UPDATED',
      'PRODUCT_MODERATED',
      'PRODUCT_DELETED',
      'ADMIN_ROLE_UPDATED', 'ACCOUNT_REGISTERED', 'ACCOUNT_PROFILE_UPDATED',
      'ACCOUNT_PASSWORD_UPDATED', 'ACCOUNT_SESSIONS_REVOKED', 'ACCOUNT_STATUS_UPDATED',
      'ORGANIZATION_UPDATED', 'STAFF_INVITED', 'STAFF_INVITATION_ACCEPTED', 'MEMBERSHIP_UPDATED',
      'STORE_CREATED', 'STORE_UPDATED', 'STORE_REVIEWED', 'STORE_STATUS_UPDATED',
      'REPORT_SUBMITTED', 'REPORT_DISMISSED', 'REPORT_RESOLVED', 'ADMIN_BOOTSTRAPPED',
      'REVIEW_DELETED', 'REVIEW_REPLIED'
    ]
  },
  targetType: {
    type: String,
    required: true,
    enum: ['Supplier', 'Product', 'QuoteRequest', 'User', 'Store', 'Organization', 'Membership', 'Report', 'Review']
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
  phase: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  completedAt: Date,
  failure: { type: String, maxlength: 1000 },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ targetType: 1, targetId: 1 })

module.exports = mongoose.model('AuditLog', AuditLogSchema)
