const crypto = require('crypto')
const mongoose = require('mongoose')
const Report = require('../models/Report')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const AuditLog = require('../models/AuditLog')
const fail = (status, message) => Object.assign(new Error(message), { status })

async function resolveReport(id, input, actor) {
  const intent = { action: input.action, resolutionNotes: input.resolutionNotes.trim(), moderationAction: input.moderationAction || 'none' }
  const hash = crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex')
  const original = await Report.findById(id)
  if (!original) throw fail(404, 'البلاغ غير موجود')
  if (['resolved', 'dismissed'].includes(original.status)) throw fail(409, 'تم اتخاذ قرار في هذا البلاغ مسبقاً')
  if ((intent.moderationAction === 'hide_product' && original.targetType !== 'product') ||
      (intent.moderationAction === 'suspend_supplier' && original.targetType !== 'supplier')) throw fail(400, 'إجراء الإشراف لا يطابق نوع البلاغ')
  if (original.targetType === 'trade_confirmation') await require('./tradeConfirmationDispute').requireSubmitted(original)
  if (intent.moderationAction !== 'none') {
    const target = intent.moderationAction === 'hide_product' ? await Product.exists({ _id: original.targetId })
      : await Supplier.exists({ _id: original.targetId, role: 'supplier' })
    if (!target) throw fail(404, 'الهدف المبلغ عنه لم يعد موجوداً')
  }
  const token = crypto.randomUUID(), now = new Date(), auditId = original.resolutionClaim?.auditId ||
    new mongoose.Types.ObjectId(crypto.createHash('sha256').update('report-resolution:' + id).digest('hex').slice(0, 24))
  const report = await Report.findOneAndUpdate({ _id: id, status: { $in: ['pending', 'investigating'] }, $or: [
    { resolutionClaim: { $exists: false } },
    { 'resolutionClaim.hash': hash, 'resolutionClaim.leaseUntil': { $lte: now } }
  ] }, { $set: { resolutionClaim: { ...intent, hash, token, auditId, actorId: actor.id, leaseUntil: new Date(Date.now() + 60000) } } }, { returnDocument: 'after' })
  if (!report) throw fail(409, 'معالجة البلاغ جارية أو مرتبطة بقرار مختلف؛ استكمل القرار نفسه لاحقاً')
  // Intent survives failure. Only the identical decision can resume after lease.
  // Effects are idempotent; a stale worker cannot publish through a new token.
  const session = process.env.REPORTS_TRANSACTIONS === '1' ? await mongoose.startSession() : null
  const execute = async () => {
    const options = session ? { session } : {}
    const fence = { _id: id, 'resolutionClaim.token': token, 'resolutionClaim.hash': hash }
    if (!await Report.exists(fence).session(session)) throw fail(409, 'تغيرت معالجة البلاغ')
    await AuditLog.updateOne({ _id: auditId }, { $setOnInsert: {
      action: intent.action === 'dismissed' ? 'REPORT_DISMISSED' : 'REPORT_RESOLVED', targetType: 'Report', targetId: report._id,
      performedBy: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
      details: { ...intent, targetType: report.targetType, targetId: report.targetId }, phase: 'pending'
    } }, { ...options, upsert: true, runValidators: true })
    const targetAuditId = new mongoose.Types.ObjectId(crypto.createHash('sha256').update('report-moderation:' + id).digest('hex').slice(0, 24))
    if (intent.moderationAction !== 'none') await AuditLog.updateOne({ _id: targetAuditId }, { $setOnInsert: {
      action: intent.moderationAction === 'hide_product' ? 'PRODUCT_MODERATED' : 'ACCOUNT_STATUS_UPDATED',
      targetType: intent.moderationAction === 'hide_product' ? 'Product' : 'Supplier', targetId: report.targetId,
      performedBy: { id: actor.id, role: actor.role, name: actor.name }, details: { reportId: report._id, reason: intent.resolutionNotes, moderationAction: intent.moderationAction }, phase: 'pending'
    } }, { ...options, upsert: true, runValidators: true })
    if (intent.moderationAction === 'hide_product') {
      await Product.updateOne({ _id: report.targetId }, { $set: { moderationStatus: 'hidden', moderationReason: intent.resolutionNotes,
        moderatedAt: now, moderatedBy: actor.id } }, { ...options, runValidators: true })
    } else if (intent.moderationAction === 'suspend_supplier') {
      // Replaying a partial suspension must not repeatedly advance sessions.
      await Supplier.updateOne({ _id: report.targetId, role: 'supplier', isActive: { $ne: false } }, { $set: { isActive: false }, $inc: { tokenVersion: 1 } }, options)
      await Store.updateMany({ supplierId: report.targetId }, { $set: { isActive: false, adminSuspended: true } }, options)
    }
    if (intent.moderationAction !== 'none') await AuditLog.updateOne({ _id: targetAuditId }, { $set: { phase: 'completed', completedAt: new Date() } }, options)
    await AuditLog.updateOne({ _id: auditId }, { $set: { phase: 'completed', completedAt: new Date() } }, options)
    const done = await Report.findOneAndUpdate(fence, { $set: { status: intent.action, resolutionNotes: intent.resolutionNotes,
      moderationAction: intent.moderationAction, resolvedBy: actor.id, resolvedAt: new Date() }, $unset: { resolutionClaim: 1 } }, { ...options, returnDocument: 'after', runValidators: true })
    if (!done) throw fail(409, 'تغيرت معالجة البلاغ؛ تحقق من نتيجته')
    return done
  }
  try { return session ? await session.withTransaction(execute) : await execute() }
  finally { if (session) await session.endSession() }
}
module.exports = { resolveReport }
