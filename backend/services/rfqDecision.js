const mongoose = require('mongoose')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const { buildAgreement, agreementHash, conflict } = require('./commercialAgreement')
// Do not acknowledge durable intent/final state before the standalone journal
// has been synced. No replica-set transaction or retryable write is assumed.
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }

const same = (a, b) => a != null && b != null && String(a) === String(b)
const targetStatus = decision => decision.action === 'accept' ? 'accepted' : 'rejected'
const pending = rfq => rfq?.status === 'deciding' && rfq.decision?.version === 1 && rfq.decision.phase === 'pending'
const matches = (decision, action, offerId) => decision && decision.action === action && same(decision.offerId, offerId)

async function recordDecisionOnce({ rfqId, buyerId, actor, action, offerId }) {
  let rfq = await QuoteRequest.findById(rfqId)
  if (!rfq) throw Object.assign(new Error('طلب عرض السعر غير موجود'), { status: 404 })
  if (!same(rfq.buyerId, buyerId)) throw Object.assign(new Error('هذا الطلب لمشترٍ آخر'), { status: 403 })
  if (rfq.decision) {
    if (!matches(rfq.decision, action, offerId)) throw conflict('حُفظ قرار مختلف لهذا الطلب؛ لا يمكن استبداله')
    return rfq
  }
  if (rfq.status !== 'responded' || !same(rfq.currentOfferId, offerId)) throw conflict('العرض لم يعد فعالاً')
  const offer = await QuoteOffer.findOne({ _id: offerId, rfqId, supplierId: rfq.supplierId, status: 'active' })
  if (!offer) throw conflict('العرض لم يعد فعالاً')
  const decidedAt = new Date()
  if (offer.validUntil && offer.validUntil <= decidedAt) throw conflict('انتهت صلاحية العرض')
  if (!await MessageThread.exists({ rfqId, status: { $in: ['open', 'closed'] }, decisionId: { $exists: false } })) {
    throw conflict('سجل المحادثة غير متاح؛ يلزم التحقق منه قبل القرار')
  }
  const agreement = action === 'accept' ? await buildAgreement(rfq, offer, decidedAt) : undefined
  const decision = { id: new mongoose.Types.ObjectId(), version: 1, action, offerId: offer._id,
    actor: { id: actor.id, role: 'buyer', name: actor.name }, decidedAt, phase: 'pending',
    ...(agreement ? { agreement, agreementHash: agreementHash(agreement) } : {}), attempts: 0, nextAttemptAt: decidedAt }
  try {
    const saved = await QuoteRequest.findOneAndUpdate({ _id: rfqId, buyerId, status: 'responded',
      currentOfferId: offer._id, revision: rfq.revision, decision: { $exists: false } },
    { $set: { status: 'deciding', decision }, $inc: { revision: 1 } }, { ...WRITE, returnDocument: 'after', runValidators: true })
    if (saved) return saved
  } catch (error) {
    // An acknowledged error does not prove that a single-document write failed.
    // Re-read before deciding whether the durable intent needs replay.
    rfq = await QuoteRequest.findById(rfqId)
    if (matches(rfq?.decision, action, offerId)) return rfq
    throw error
  }
  rfq = await QuoteRequest.findById(rfqId)
  if (matches(rfq?.decision, action, offerId)) return rfq
  throw conflict('تغير العرض أو حُفظ قرار آخر؛ حدّث الصفحة')
}

async function recordDecision(input) {
  try { return await recordDecisionOnce(input) }
  catch (error) {
    if (error.status !== 409) throw error
    // Another delivery may advance the offer/thread after our initial RFQ read.
    // Only an owner-scoped, identical durable receipt supersedes that conflict;
    // opposite actions, different offers and absent receipts remain conflicts.
    const current = await QuoteRequest.findOne({ _id: input.rfqId, buyerId: input.buyerId }).read('primary')
    if (matches(current?.decision, input.action, input.offerId)) return current
    throw error
  }
}

async function completeDecision(rfqId) {
  const rfq = await QuoteRequest.findById(rfqId).lean()
  if (!rfq?.decision || rfq.decision.version !== 1) throw conflict('لا يوجد قرار محفوظ يمكن استكماله')
  const d = rfq.decision, status = targetStatus(d)
  if (d.phase === 'completed' && rfq.status === status) return rfq
  if (!pending(rfq) || !['accept', 'reject'].includes(d.action) || !mongoose.isValidObjectId(d.actor?.id) ||
      d.actor?.role !== 'buyer' || !d.actor?.name?.trim() || !same(rfq.currentOfferId, d.offerId) ||
      (d.action === 'accept' && (!d.agreement || agreementHash(d.agreement) !== d.agreementHash))) {
    throw conflict('سجل القرار يحتاج مراجعة؛ لم تُستنتج بيانات بديلة')
  }
  await QuoteRequest.updateOne({ _id: rfqId, status: 'deciding', 'decision.id': d.id, 'decision.phase': 'pending' },
    { $inc: { 'decision.attempts': 1 } }, { ...WRITE })

  // Every projection is idempotent and fenced by the durable decision id.
  await QuoteOffer.updateOne({ _id: d.offerId, rfqId, supplierId: rfq.supplierId,
    $or: [{ status: 'active', decisionId: { $exists: false } }, { status, decisionId: d.id }] },
  { $set: { status, decisionId: d.id } }, { ...WRITE, runValidators: true })
  if (!await QuoteOffer.exists({ _id: d.offerId, rfqId, status, decisionId: d.id })) throw conflict('حالة العرض تعارض القرار المحفوظ')

  await MessageThread.updateOne({ rfqId, status: { $in: ['open', 'closed'] },
    $or: [{ decisionId: { $exists: false } }, { decisionId: d.id }], 'messages._id': { $ne: d.id } }, {
    $push: { messages: { _id: d.id, senderId: d.actor.id, senderRole: 'buyer', senderName: d.actor.name,
      sentAt: d.decidedAt, content: status === 'accepted' ? 'تم قبول عرض السعر' : 'تم رفض عرض السعر' } },
    $set: { status: 'closed', decisionId: d.id, lastMessageAt: d.decidedAt }
  }, { ...WRITE, runValidators: true })
  if (!await MessageThread.exists({ rfqId, status: 'closed', decisionId: d.id, 'messages._id': d.id })) throw conflict('تعذر تثبيت إغلاق سجل المحادثة')

  // _id uniqueness exists on standalone and on legacy collections already.
  // $setOnInsert preserves readAt when a delivered notification is replayed.
  try {
    await Notification.updateOne({ _id: d.id }, { $setOnInsert: {
      userId: rfq.supplierId, type: 'offer_decision', resourceType: 'rfq', resourceId: rfq._id,
      decisionId: d.id, createdAt: d.decidedAt, readAt: null
    } }, { ...WRITE, upsert: true, runValidators: true })
  } catch (error) { if (error.code !== 11000) throw error }
  if (!await Notification.exists({ _id: d.id, userId: rfq.supplierId, resourceId: rfq._id,
    resourceType: 'rfq', type: 'offer_decision', decisionId: d.id })) throw conflict('إشعار القرار يحتاج مراجعة')

  // Publish the final RFQ state LAST. No accepted RFQ is newly exposed while its
  // offer is active or its conversation is open.
  await QuoteRequest.updateOne({ _id: rfqId, status: 'deciding', 'decision.id': d.id, 'decision.phase': 'pending' }, {
    $set: { status, 'decision.phase': 'completed', 'decision.completedAt': new Date() },
    $unset: { 'decision.nextAttemptAt': 1, 'decision.lastErrorCode': 1 }, $inc: { revision: 1 }
  }, { ...WRITE, runValidators: true })
  const completed = await QuoteRequest.findById(rfqId).lean()
  if (completed?.status !== status || completed.decision?.phase !== 'completed' || !same(completed.decision.id, d.id)) throw conflict('لم يكتمل تثبيت القرار')
  return completed
}

async function postpone(rfqId, decisionId, error) {
  const record = await QuoteRequest.findById(rfqId).select('decision.attempts').lean()
  const delay = Math.min(60000, 1000 * 2 ** Math.min(record?.decision?.attempts || 0, 6))
  await QuoteRequest.updateOne({ _id: rfqId, status: 'deciding', 'decision.id': decisionId, 'decision.phase': 'pending' }, {
    $set: { 'decision.nextAttemptAt': new Date(Date.now() + delay),
      'decision.lastErrorCode': error.code === 'RFQ_DECISION_CONFLICT' ? 'RFQ_DECISION_CONFLICT' : 'RFQ_DECISION_RETRY' }
  }, { ...WRITE })
}

async function decide(input) {
  const rfq = await recordDecision(input)
  try { return { rfq: await completeDecision(rfq._id), processing: false } }
  catch (error) {
    // Includes write-succeeded/acknowledgement-lost at the final step.
    const current = await QuoteRequest.findById(rfq._id).lean()
    if (current?.decision?.phase === 'completed' && current.status === targetStatus(current.decision) &&
        matches(current.decision, input.action, input.offerId)) return { rfq: current, processing: false }
    if (!pending(current)) throw error
    try { await postpone(current._id, current.decision.id, error) } catch { /* durable journal is still discoverable */ }
    return { rfq: current, processing: true }
  }
}

async function recoverPendingDecisions({ limit = 25, now = new Date(), onError } = {}) {
  const records = await QuoteRequest.find({ status: 'deciding', 'decision.version': 1, 'decision.phase': 'pending',
    $or: [{ 'decision.nextAttemptAt': { $lte: now } }, { 'decision.nextAttemptAt': { $exists: false } }] })
    .sort({ 'decision.nextAttemptAt': 1, _id: 1 }).limit(Math.min(100, Math.max(1, limit))).select('_id decision.id').lean()
  const result = { processed: records.length, completed: 0, pending: 0 }
  for (const record of records) {
    try { await completeDecision(record._id); result.completed++ }
    catch (error) {
      result.pending++
      try { await postpone(record._id, record.decision.id, error) } catch { /* next scan retries the journal */ }
      if (onError) onError({ code: error.code === 'RFQ_DECISION_CONFLICT' ? 'RFQ_DECISION_CONFLICT' : 'RFQ_DECISION_RETRY', rfqId: String(record._id) })
    }
  }
  return result
}

function createDecisionRecovery({ pollMs = 5000, onError } = {}) {
  let stopped = false, timer, running, started = false
  const runOnce = () => {
    if (stopped) return Promise.resolve({ processed: 0, completed: 0, pending: 0 })
    if (!running) running = recoverPendingDecisions({ onError }).finally(() => { running = null })
    return running
  }
  async function tick() {
    try { await runOnce() } catch { if (onError) onError({ code: 'RFQ_RECOVERY_UNAVAILABLE' }) }
    if (!stopped) { timer = setTimeout(tick, pollMs); timer.unref?.() }
  }
  const api = {
    runOnce,
    start() { if (!started) { started = true; tick() } return api },
    async stop({ graceMs = 15000 } = {}) {
      stopped = true; clearTimeout(timer)
      let timeout
      try { await Promise.race([running || Promise.resolve(), new Promise(resolve => { timeout = setTimeout(resolve, graceMs) })]) }
      finally { clearTimeout(timeout) }
    }
  }
  return api
}

module.exports = { recordDecision, completeDecision, decide, recoverPendingDecisions, createDecisionRecovery }
