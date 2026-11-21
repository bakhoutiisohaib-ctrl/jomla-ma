const mongoose = require('mongoose')
const RFQ = require('../models/QuoteRequest')
const Offer = require('../models/QuoteOffer')
const Thread = require('../models/MessageThread')
const Notification = require('../models/Notification')

const KIND = 'supplier_rejection'
const OPEN_OFFERS = ['pending', 'committing', 'aborting']
const CONTENT = 'تم رفض طلب عرض السعر'
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }
const same = (a, b) => a != null && b != null && String(a) === String(b)
const pointer = value => String(value || '')
const fail = (status, message, code = 'RFQ_SUPPLIER_REJECTION_RETRY') => Object.assign(new Error(message), { status, code })
const conflict = () => fail(409, 'سجل رفض المورد يحتاج مراجعة؛ لم يُفرض قرار نهائي', 'RFQ_SUPPLIER_REJECTION_CONFLICT')
const unavailable = () => fail(503, 'تعذر تأكيد رفض الطلب؛ أعد استكمال الطلب نفسه لاحقاً')
const load = id => RFQ.findById(id).select('+supplierRejection +offerSubmission')

function authorize(req, rfq) {
  if (!rfq) throw fail(404, 'طلب عرض السعر غير موجود')
  const actor = req.supplier
  if (!['supplier', 'admin', 'staff'].includes(actor.role) || !same(actor.ownerId || actor.id, rfq.supplierId) ||
      (actor.role === 'staff' && !actor.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))) {
    throw fail(403, 'لا تملك هذا الطلب')
  }
}

function validate(rfq) {
  const j = rfq?.supplierRejection
  if (!j || j.kind !== KIND || j.version !== 1 || !mongoose.isValidObjectId(j.id) ||
      !same(j.rfqId, rfq._id) || !same(j.supplierId, rfq.supplierId) || !same(j.buyerId, rfq.buyerId) ||
      !same(j.actor?.ownerId, j.supplierId) || !mongoose.isValidObjectId(j.actor?.id) ||
      !['supplier', 'admin', 'staff'].includes(j.actor?.role) || !j.actor?.name?.trim() ||
      (j.actor.role !== 'staff' && !same(j.actor.id, j.supplierId)) ||
      !mongoose.isValidObjectId(j.threadId) || !['pending', 'responded'].includes(j.previousStatus) ||
      !Number.isSafeInteger(j.claimedRevision) || !j.decidedAt || !Number.isFinite(new Date(j.decidedAt).getTime()) ||
      pointer(rfq.currentOfferId) !== pointer(j.previousOfferId) || rfq.decision ||
      OPEN_OFFERS.includes(rfq.offerSubmission?.phase)) throw conflict()
  if (j.phase === 'completed' && rfq.status === 'rejected' && rfq.revision === j.claimedRevision + 1) return j
  if (j.phase !== 'pending' || rfq.status !== 'deciding' || rfq.revision !== j.claimedRevision) throw conflict()
  return j
}

const fence = (id, j) => ({ _id: id, supplierId: j.supplierId, buyerId: j.buyerId, status: 'deciding', revision: j.claimedRevision,
  decision: { $exists: false }, 'offerSubmission.phase': { $nin: OPEN_OFFERS },
  'supplierRejection.kind': KIND, 'supplierRejection.version': 1, 'supplierRejection.id': j.id,
  'supplierRejection.rfqId': id, 'supplierRejection.supplierId': j.supplierId, 'supplierRejection.buyerId': j.buyerId,
  'supplierRejection.phase': 'pending', currentOfferId: j.previousOfferId || null })

// Recheck the persistent intent/owners before each projection. No in-memory lock
// is needed for correctness; a second completer may finish between checkpoints.
async function checkpoint(id, expected) {
  const rfq = await load(id), j = validate(rfq)
  if (!same(j.id, expected.id) || !same(j.threadId, expected.threadId) ||
      !same(j.supplierId, expected.supplierId) || !same(j.buyerId, expected.buyerId) ||
      !same(j.actor.ownerId, expected.actor.ownerId) || j.actor.role !== expected.actor.role ||
      j.previousStatus !== expected.previousStatus || j.claimedRevision !== expected.claimedRevision ||
      pointer(j.previousOfferId) !== pointer(expected.previousOfferId) ||
      !same(j.actor.id, expected.actor.id) || j.actor.name !== expected.actor.name ||
      new Date(j.decidedAt).getTime() !== new Date(expected.decidedAt).getTime()) throw conflict()
  return rfq
}

async function record(req) {
  let rfq = await load(req.params.id)
  authorize(req, rfq)
  if (rfq.supplierRejection) { validate(rfq); return rfq }
  if (!['pending', 'responded'].includes(rfq.status) || rfq.decision || OPEN_OFFERS.includes(rfq.offerSubmission?.phase)) {
    throw fail(409, 'الطلب مغلق أو قيد استكمال قرار آخر')
  }
  const thread = await Thread.findOne({ rfqId: rfq._id, supplierId: rfq.supplierId, buyerId: rfq.buyerId,
    status: 'open', decisionId: { $exists: false } }).select('_id').lean()
  const joinConcurrent = async () => {
    const current = await load(req.params.id)
    authorize(req, current)
    if (!current.supplierRejection) throw conflict()
    validate(current)
    return current
  }
  if (!thread) return joinConcurrent()
  if (rfq.currentOfferId && !await Offer.exists({ _id: rfq.currentOfferId, rfqId: rfq._id, supplierId: rfq.supplierId,
    status: { $in: ['active', 'expired'] }, decisionId: { $exists: false } })) return joinConcurrent()
  const now = new Date(), j = { kind: KIND, version: 1, id: new mongoose.Types.ObjectId(), rfqId: rfq._id,
    supplierId: rfq.supplierId, buyerId: rfq.buyerId, threadId: thread._id, previousStatus: rfq.status,
    previousOfferId: rfq.currentOfferId, claimedRevision: rfq.revision + 1,
    actor: { id: req.supplier.id, ownerId: req.supplier.ownerId || req.supplier.id, role: req.supplier.role, name: req.supplier.name },
    decidedAt: now, phase: 'pending', attempts: 0, nextAttemptAt: now }
  let failure
  try {
    const saved = await RFQ.findOneAndUpdate({ _id: rfq._id, supplierId: rfq.supplierId, buyerId: rfq.buyerId,
      status: rfq.status, revision: rfq.revision, currentOfferId: rfq.currentOfferId || null,
      decision: { $exists: false }, supplierRejection: { $exists: false }, 'offerSubmission.phase': { $nin: OPEN_OFFERS } },
    { $set: { status: 'deciding', supplierRejection: j }, $inc: { revision: 1 } },
    { ...WRITE, returnDocument: 'after', runValidators: true }).select('+supplierRejection +offerSubmission')
    if (saved) return saved
  } catch (error) { failure = error }
  // A lost acknowledgement can mean this CAS already committed. An authorized
  // concurrent refusal joins the one saved intent, never replaces its actor/id.
  rfq = await load(req.params.id)
  authorize(req, rfq)
  if (rfq.supplierRejection) { validate(rfq); return rfq }
  if (failure) throw unavailable()
  throw fail(409, 'تم تحديث الطلب؛ حدّث الصفحة قبل اتخاذ قرار جديد')
}

async function completeRejection(id) {
  let rfq = await load(id)
  const j = validate(rfq)
  if (j.phase === 'completed') return rfq
  await RFQ.updateOne(fence(id, j), { $inc: { 'supplierRejection.attempts': 1 } }, WRITE)
  rfq = await checkpoint(id, j)
  if (rfq.supplierRejection.phase === 'completed') return rfq
  const offerIdentity = { _id: j.previousOfferId, rfqId: id, supplierId: j.supplierId }
  if (j.previousOfferId) {
    await Offer.updateOne({ ...offerIdentity, status: { $in: ['active', 'expired'] }, decisionId: { $exists: false } },
      { $set: { status: 'rejected', decisionId: j.id } }, { ...WRITE, runValidators: true })
    if (!await Offer.exists({ ...offerIdentity, status: 'rejected', decisionId: j.id })) throw conflict()
  }
  rfq = await checkpoint(id, j)
  if (rfq.supplierRejection.phase === 'completed') return rfq
  const threadIdentity = { _id: j.threadId, rfqId: id, supplierId: j.supplierId, buyerId: j.buyerId }
  const message = { _id: j.id, senderId: j.actor.id, senderName: j.actor.name, senderRole: 'supplier', content: CONTENT, sentAt: j.decidedAt }
  const closedThread = { ...threadIdentity, status: 'closed', decisionId: j.id, messages: { $elemMatch: message } }
  await Thread.updateOne({ ...threadIdentity, status: 'open', decisionId: { $exists: false }, 'messages._id': { $ne: j.id } }, {
    $push: { messages: message }, $set: { status: 'closed', decisionId: j.id }, $max: { lastMessageAt: j.decidedAt }
  }, { ...WRITE, runValidators: true })
  if (!await Thread.exists(closedThread)) throw conflict()
  rfq = await checkpoint(id, j)
  if (rfq.supplierRejection.phase === 'completed') return rfq
  const noticeIdentity = { _id: j.id, userId: j.buyerId, type: 'offer_decision', resourceType: 'rfq', resourceId: id, decisionId: j.id }
  try {
    await Notification.updateOne({ _id: j.id }, { $setOnInsert: { ...noticeIdentity, createdAt: j.decidedAt, readAt: null } },
      { ...WRITE, upsert: true, runValidators: true })
  } catch (error) { if (error.code !== 11000) throw error }
  if (!await Notification.exists(noticeIdentity)) throw conflict()
  rfq = await checkpoint(id, j)
  if (rfq.supplierRejection.phase === 'completed') return rfq
  // Re-verify every required projection, then publish the terminal RFQ LAST.
  if ((j.previousOfferId && !await Offer.exists({ ...offerIdentity, status: 'rejected', decisionId: j.id })) ||
      !await Thread.exists(closedThread) || !await Notification.exists(noticeIdentity)) throw conflict()
  await RFQ.updateOne(fence(id, j), { $set: { status: 'rejected', 'supplierRejection.phase': 'completed', 'supplierRejection.completedAt': new Date() },
    $unset: { 'supplierRejection.nextAttemptAt': 1, 'supplierRejection.lastErrorCode': 1 }, $inc: { revision: 1 } }, { ...WRITE, runValidators: true })
  rfq = await checkpoint(id, j)
  if (rfq.supplierRejection.phase !== 'completed') throw conflict()
  return rfq
}

async function postpone(rfq, error) {
  const j = validate(rfq)
  if (j.phase !== 'pending') return
  await RFQ.updateOne(fence(rfq._id, j), { $set: {
    'supplierRejection.lastErrorCode': error.code === 'RFQ_SUPPLIER_REJECTION_CONFLICT' ? error.code : 'RFQ_SUPPLIER_REJECTION_RETRY',
    'supplierRejection.nextAttemptAt': new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(j.attempts || 0, 6)))
  } }, WRITE)
}
async function resume(id) {
  try { return { rfq: await completeRejection(id), processing: false } }
  catch (error) {
    const rfq = await load(id)
    const j = validate(rfq)
    if (j.phase === 'completed') return { rfq, processing: false }
    try { await postpone(rfq, error) } catch { /* The durable intent stays discoverable. */ }
    return { rfq, processing: true }
  }
}
async function rejectSupplier(req) {
  if (req.get('Idempotency-Key') !== undefined) throw fail(400, 'معرف محاولة العرض لا يُستخدم لرفض الطلب')
  try {
    const rfq = await record(req)
    return await resume(rfq._id)
  } catch (error) {
    if (error.status) throw error
    throw unavailable()
  }
}
function rejectionSummary(rfq) {
  const j = rfq?.supplierRejection
  return j?.kind === KIND && j.version === 1 ? { version: 1, phase: j.phase } : undefined
}
function rejectionResponse(result) {
  return { message: result.processing ? 'حُفظت نية رفض الطلب وجارٍ استكمالها؛ الرفض ليس نهائياً بعد.' : 'تم رفض الطلب',
    rfq: result.rfq, processing: result.processing, rejection: rejectionSummary(result.rfq) }
}
async function recoverPendingRejections({ limit = 25, now = new Date(), onError } = {}) {
  const rows = await RFQ.find({ status: 'deciding', 'supplierRejection.kind': KIND, 'supplierRejection.version': 1, 'supplierRejection.phase': 'pending',
    $or: [{ 'supplierRejection.nextAttemptAt': { $lte: now } }, { 'supplierRejection.nextAttemptAt': { $exists: false } }] })
    .sort({ _id: 1 }).limit(Math.min(100, Math.max(1, limit))).maxTimeMS(10000).select('_id').lean()
  const result = { processed: rows.length, completed: 0, pending: 0 }
  for (const row of rows) {
    try {
      const r = await resume(row._id)
      result[r.processing ? 'pending' : 'completed']++
      if (r.processing) onError?.({ code: r.rfq.supplierRejection.lastErrorCode || 'RFQ_SUPPLIER_REJECTION_RETRY', rfqId: String(row._id) })
    } catch { result.pending++; onError?.({ code: 'RFQ_SUPPLIER_REJECTION_CONFLICT', rfqId: String(row._id) }) }
  }
  return result
}
function createRejectionRecovery({ pollMs = 5000, onError } = {}) {
  let stopped = false, started = false, timer, running
  const report = error => { try { onError?.(error) } catch { /* Logging must not stop recovery. */ } }
  const runOnce = () => stopped ? Promise.resolve({ processed: 0, completed: 0, pending: 0 })
    : (running ||= recoverPendingRejections({ onError: report }).finally(() => { running = null }))
  async function tick() {
    try { await runOnce() } catch { report({ code: 'RFQ_SUPPLIER_REJECTION_UNAVAILABLE' }) }
    if (!stopped) { timer = setTimeout(tick, pollMs); timer.unref?.() }
  }
  return { runOnce, start() { if (!started) { started = true; tick() }; return this }, async stop({ graceMs = 15000 } = {}) {
    stopped = true; clearTimeout(timer); let timeout
    try { await Promise.race([running || Promise.resolve(), new Promise(resolve => { timeout = setTimeout(resolve, graceMs) })]) }
    finally { clearTimeout(timeout) }
  } }
}

module.exports = { rejectSupplier, rejectionResponse, rejectionSummary, completeRejection, recoverPendingRejections, createRejectionRecovery }
