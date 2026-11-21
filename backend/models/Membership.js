const mongoose = require('mongoose')

const STAFF_PERMISSIONS = ['manage_products', 'manage_store', 'manage_rfq']
const MembershipSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  invitedEmail: { type: String, required: true, trim: true, lowercase: true },
  role: { type: String, enum: ['owner', 'staff'], required: true },
  permissions: [{ type: String, enum: STAFF_PERMISSIONS }],
  status: { type: String, enum: ['invited', 'active', 'revoked'], default: 'invited' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  invitationExpiresAt: Date,
  invitationTokenHash: { type: String, select: false },
  acceptedAt: Date
}, { timestamps: true, optimisticConcurrency: true })

MembershipSchema.index({ organizationId: 1, invitedEmail: 1 }, { unique: true })
MembershipSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'active', userId: { $type: 'objectId' } } })
MembershipSchema.statics.STAFF_PERMISSIONS = STAFF_PERMISSIONS

module.exports = mongoose.model('Membership', MembershipSchema)
