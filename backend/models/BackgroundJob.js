const mongoose = require('mongoose')

// Payloads and leases are internal implementation details. Only publicJob() is
// allowed to serialize a job for an HTTP response.
const BackgroundJobSchema = new mongoose.Schema({
  type: { type: String, required: true, match: /^[a-z][a-z0-9_]{0,79}$/ },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
  requiredPermission: { type: String, enum: ['manage_products', 'manage_store', 'manage_rfq'], default: 'manage_products' },
  idempotencyKey: { type: String, required: true, maxlength: 200, select: false },
  payloadHash: { type: String, required: true, select: false },
  payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  status: { type: String, enum: ['pending', 'retry_wait', 'running', 'succeeded', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0, min: 0 },
  maxAttempts: { type: Number, default: 3, min: 1, max: 10 },
  timeoutMs: { type: Number, default: 120000, min: 10, max: 900000 },
  backoffMs: { type: Number, default: 1000, min: 0, max: 60000 },
  nextRunAt: { type: Date, default: Date.now },
  workerId: { type: String, select: false },
  leaseToken: { type: String, select: false },
  leaseExpiresAt: { type: Date, select: false },
  attemptDeadline: { type: Date, select: false },
  startedAt: Date,
  finishedAt: Date,
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { code: String, message: String }
}, { timestamps: true, minimize: false })

BackgroundJobSchema.index({ ownerId: 1, type: 1, idempotencyKey: 1 }, { unique: true })
BackgroundJobSchema.index({ status: 1, type: 1, nextRunAt: 1, createdAt: 1 })
BackgroundJobSchema.index({ status: 1, leaseExpiresAt: 1 })
BackgroundJobSchema.index({ ownerId: 1, createdAt: -1, _id: -1 })

module.exports = mongoose.model('BackgroundJob', BackgroundJobSchema)
