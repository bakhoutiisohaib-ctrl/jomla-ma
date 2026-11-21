const crypto = require('crypto')
const mongoose = require('mongoose')
const RFQ = require('../models/QuoteRequest')
const Offer = require('../models/QuoteOffer')
const Thread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const { captureOfferContext, agreementHash } = require('./commercialAgreement')
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }
const OPEN = ['pending', 'committing', 'aborting']
const INDEX = 'rfq_offer_submission_key'
const same = (a, b) => a != null && b != null && String(a) === String(b)
const fail = (status, message, code = 'RFQ_OFFER_RETRY') => Object.assign(new Error(message), { status, code })
const conflict = () => fail(409, 'سجل العرض يحتاج مراجعة؛ لم يُستبدل العرض السابق', 'RFQ_OFFER_CONFLICT')
const clean = (v, max = 5000) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const load = id => RFQ.findById(id).select('+offerSubmission')
const receipt = (rfq, key) => Offer.findOne({ rfqId: rfq._id, supplierId: rfq.supplierId, 'submission.key': key }).select('+submission')
const terminal = o => ['completed', 'expired'].includes(o?.submission?.phase)
function authorize(req, rfq) {
  if (!rfq) throw fail(404, 'طلب عرض السعر غير موجود')
  const a = req.supplier
  if (!['supplier', 'admin', 'staff'].includes(a.role) || !same(a.ownerId || a.id, rfq.supplierId) ||
      (a.role === 'staff' && !a.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))) throw fail(403, 'ليس لديك تفويض لهذا الطلب')
}
function identity(req, rfq) {
  const supplied = req.get('Idempotency-Key')
  if (supplied !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(supplied)) throw fail(400, 'معرف محاولة العرض غير صالح')
  const b = req.body || {}, unitPrice = Number(b.unitPrice), deliveryDays = b.deliveryDays == null ? 3 : Number(b.deliveryDays)
  const quantity = b.quantity == null ? rfq.quantity : Number(b.quantity), currency = b.currency == null ? rfq.currency : b.currency
  const until = b.validUntil == null || b.validUntil === '' ? null : new Date(b.validUntil)
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isSafeInteger(deliveryDays) || deliveryDays < 1 ||
      !Number.isSafeInteger(quantity) || quantity < 1 || quantity !== rfq.quantity || !Number.isFinite(unitPrice * quantity) ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || currency !== rfq.currency || (until && !Number.isFinite(until.getTime()))) throw fail(400, 'السعر أو الكمية أو العملة أو المهلة غير صحيحة')
  const input = { unitPrice, quantity, currency, deliveryDays, paymentTerms: clean(b.paymentTerms, 2000), notes: clean(b.notes), validUntil: until?.toISOString() || null }
  return { key: supplied || 'legacy_' + crypto.randomUUID(), input, hash: agreementHash({ rfqId: String(rfq._id), supplierId: String(rfq.supplierId), input }) }
}
async function requireIndex() {
  try {
    await Offer.init()
    const i = (await Offer.collection.indexes()).find(x => x.name === INDEX), p = i?.partialFilterExpression
    if (!i?.unique || Object.keys(i.key || {}).length !== 3 || i.key.rfqId !== 1 || i.key.supplierId !== 1 || i.key['submission.key'] !== 1 ||
        Object.keys(p || {}).length !== 1 || Object.keys(p['submission.key'] || {}).length !== 1 || p['submission.key'].$type !== 'string' ||
        i.sparse || (i.collation && i.collation.locale !== 'simple')) throw Error('Index unavailable')
  } catch { throw fail(503, 'تعذر تأكيد حماية إرسال العرض؛ استكمل بنفس المعرف لاحقاً') }
}
async function record(req) {
  let rfq = await load(req.params.id); authorize(req, rfq)
  const { key, input, hash } = identity(req, rfq)
  await requireIndex()
  let offer = await receipt(rfq, key)
  const check = value => { if (value !== hash) throw fail(409, 'استُخدم معرف العرض مع بيانات مختلفة', 'RFQ_OFFER_KEY_CONFLICT') }
  if (offer) { check(offer.submission.hash); if (terminal(offer) && !(rfq.offerSubmission?.key === key && OPEN.includes(rfq.offerSubmission.phase))) return { rfq, offer, replayed: true } }
  if (rfq.offerSubmission?.key === key) { check(rfq.offerSubmission.hash); return { rfq, replayed: true } }
  if (offer || OPEN.includes(rfq.offerSubmission?.phase)) throw conflict()
  if (!['pending', 'responded'].includes(rfq.status) || rfq.decision) throw fail(409, 'لا يمكن تقديم عرض بعد القرار أو أثناء استكمال عملية أخرى')
  if (input.validUntil && new Date(input.validUntil) <= new Date()) throw fail(400, 'انتهت صلاحية العرض الجديد')
  if (!await Thread.exists({ rfqId: rfq._id, buyerId: rfq.buyerId, supplierId: rfq.supplierId, status: 'open', decisionId: { $exists: false } })) throw conflict()
  const data = { ...input, totalPrice: input.unitPrice * input.quantity, ...(await captureOfferContext(rfq)) }, now = new Date()
  const journal = { version: 1, key, hash, offerId: new mongoose.Types.ObjectId(), phase: 'pending',
    previousStatus: rfq.status, previousOfferId: rfq.currentOfferId, actor: { id: req.supplier.id, name: req.supplier.name },
    data, dataHash: agreementHash(data), startedAt: now, attempts: 0, nextAttemptAt: now }
  let failure
  try {
    const saved = await RFQ.findOneAndUpdate({ _id: rfq._id, supplierId: rfq.supplierId, revision: rfq.revision,
      status: rfq.status, decision: { $exists: false }, 'offerSubmission.phase': { $nin: OPEN } },
    { $set: { status: 'offering', offerSubmission: journal }, $inc: { revision: 1 } }, { ...WRITE, returnDocument: 'after', runValidators: true }).select('+offerSubmission')
    if (saved) return { rfq: saved, replayed: false }
  } catch (error) { failure = error }
  // Both failed-before-write and committed/ack-lost are possible. A different
  // caller cannot replace this journal until its receipt has become terminal.
  rfq = await load(rfq._id)
  if (rfq?.offerSubmission?.key === key) { check(rfq.offerSubmission.hash); return { rfq, replayed: true } }
  offer = rfq && await receipt(rfq, key)
  if (offer) { check(offer.submission.hash); if (terminal(offer)) return { rfq, offer, replayed: true } }
  if (failure) throw failure
  throw conflict()
}
const fence = (id, j, phases) => ({ _id: id, 'offerSubmission.version': 1, 'offerSubmission.offerId': j.offerId, 'offerSubmission.phase': { $in: phases } })
async function finish(id, j) {
  let rfq = await load(id)
  if (!same(rfq?.offerSubmission?.offerId, j.offerId)) {
    const old = rfq && await receipt(rfq, j.key)
    if (terminal(old)) return { rfq, offer: old }
    throw conflict()
  }
  const phase = rfq.offerSubmission.phase
  if (['completed', 'expired'].includes(phase)) {
    const offer = await receipt(rfq, j.key)
    if (!terminal(offer)) throw conflict()
    return { rfq, offer }
  }
  if (phase === 'committing') {
    // Core effects are durable and the replacement intent has committed. Keep
    // status=offering until retirement + receipt are verified. Phase B cannot
    // accept either offer during a partially applied replacement.
    if (j.previousOfferId) {
      await Offer.updateOne({ _id: j.previousOfferId, rfqId: id, supplierId: rfq.supplierId, status: 'active', decisionId: { $exists: false } }, { $set: { status: 'superseded' } }, { ...WRITE })
      if (!await Offer.exists({ _id: j.previousOfferId, rfqId: id, status: 'superseded' })) throw conflict()
    }
    await Offer.updateOne({ _id: j.offerId, 'submission.hash': j.hash, 'submission.phase': 'pending' }, { $set: { 'submission.phase': 'completed' } }, { ...WRITE })
    if (!terminal(await receipt(rfq, j.key))) throw conflict()
    await RFQ.updateOne({ ...fence(id, j, ['committing']), status: 'offering', decision: { $exists: false } }, {
      $set: { status: 'responded', currentOfferId: j.offerId, offer: { unitPrice: j.data.unitPrice, totalPrice: j.data.totalPrice,
        deliveryDays: j.data.deliveryDays, notes: j.data.notes, productSnapshot: j.data.productSnapshot, respondedAt: j.startedAt },
        'offerSubmission.phase': 'completed', 'offerSubmission.completedAt': new Date() },
      $unset: { 'offerSubmission.nextAttemptAt': 1, 'offerSubmission.lastErrorCode': 1 }, $inc: { revision: 1 }
    }, { ...WRITE, runValidators: true })
  } else if (phase === 'aborting') {
    // Effects were persisted before the atomic expired outcome. Late concurrent
    // completers only encounter those same effect IDs; no new effects appear.
    await Offer.updateOne({ _id: j.offerId, 'submission.hash': j.hash, status: { $in: ['preparing', 'active', 'expired'] }, decisionId: { $exists: false } },
      { $set: { status: 'expired', 'submission.phase': 'expired' } }, { ...WRITE })
    if (!await Offer.exists({ _id: j.offerId, status: 'expired', 'submission.phase': 'expired' })) throw conflict()
    await RFQ.updateOne({ ...fence(id, j, ['aborting']), status: 'offering', decision: { $exists: false } },
      { $set: { status: j.previousStatus, 'offerSubmission.phase': 'expired', 'offerSubmission.completedAt': new Date() },
        $unset: { 'offerSubmission.nextAttemptAt': 1, 'offerSubmission.lastErrorCode': 1 }, $inc: { revision: 1 } }, { ...WRITE, runValidators: true })
  } else throw conflict()
  rfq = await load(id)
  const offer = await receipt(rfq, j.key)
  if (!terminal(offer) || (same(rfq.offerSubmission?.offerId, j.offerId) && OPEN.includes(rfq.offerSubmission.phase))) throw conflict()
  return { rfq, offer }
}
async function completeSubmission(id, key) {
  const rfq = await load(id), j = rfq?.offerSubmission
  if (key && j?.key !== key) {
    const old = rfq && await receipt(rfq, key)
    if (terminal(old)) return { rfq, offer: old }
    throw conflict()
  }
  if (j?.version !== 1 || !j.offerId || !j.actor?.id || !j.actor.name || !j.data || agreementHash(j.data) !== j.dataHash) throw conflict()
  if (j.phase !== 'pending') return finish(id, j)
  if (rfq.status !== 'offering' || rfq.decision || !['pending', 'responded'].includes(j.previousStatus) ||
      String(rfq.currentOfferId || '') !== String(j.previousOfferId || '')) throw conflict()
  await RFQ.updateOne(fence(id, j, ['pending']), { $inc: { 'offerSubmission.attempts': 1 } }, { ...WRITE })
  try {
    await Offer.updateOne({ _id: j.offerId }, { $setOnInsert: { ...j.data, validUntil: j.data.validUntil || undefined,
      rfqId: id, supplierId: rfq.supplierId, status: 'preparing', createdAt: j.startedAt,
      submission: { version: 1, key: j.key, hash: j.hash, dataHash: j.dataHash, phase: 'pending' } } }, { ...WRITE, upsert: true, runValidators: true })
  } catch (error) { if (error.code !== 11000) throw error }
  const saved = await receipt(rfq, j.key)
  if (!same(saved?._id, j.offerId) || saved.submission.dataHash !== j.dataHash || saved.submission.hash !== j.hash) throw conflict()
  const threadIdentity = { rfqId: id, buyerId: rfq.buyerId, supplierId: rfq.supplierId }
  await Thread.updateOne({ ...threadIdentity, status: 'open', decisionId: { $exists: false }, 'messages._id': { $ne: j.offerId } }, {
    $push: { messages: { _id: j.offerId, senderId: j.actor.id, senderRole: 'supplier', senderName: j.actor.name, sentAt: j.startedAt,
      content: `عرض سعر: ${j.data.unitPrice} ${j.data.currency}؛ التسليم ${j.data.deliveryDays} أيام. ${j.data.notes}`.slice(0, 5000) } },
    $max: { lastMessageAt: j.startedAt }
  }, { ...WRITE, runValidators: true })
  // A later decision may have closed the thread after another completer won.
  // Verification preserves that closure; it never reopens or rewrites it.
  if (!await Thread.exists({ ...threadIdentity, 'messages._id': j.offerId })) throw conflict()
  try {
    await Notification.updateOne({ _id: j.offerId }, { $setOnInsert: { userId: rfq.buyerId, type: 'offer_received', resourceType: 'rfq', resourceId: id,
      createdAt: j.startedAt, readAt: null } }, { ...WRITE, upsert: true, runValidators: true })
  } catch (error) { if (error.code !== 11000) throw error }
  if (!await Notification.exists({ _id: j.offerId, userId: rfq.buyerId, type: 'offer_received', resourceType: 'rfq', resourceId: id })) throw conflict()
  await Offer.updateOne({ _id: j.offerId, status: 'preparing', 'submission.hash': j.hash, 'submission.phase': 'pending' }, { $set: { status: 'active' } }, { ...WRITE })
  // One RFQ write chooses commit OR expiry. $$NOW is Mongo's clock. Before this
  // commitment the old offer is untouched. After commitment recovery must finish
  // that choice; an offer expiring later still cannot pass Phase B's expiry check.
  await RFQ.updateOne({ ...fence(id, j, ['pending']), status: 'offering', decision: { $exists: false },
    $expr: { $or: [{ $eq: [{ $ifNull: ['$offerSubmission.data.validUntil', null] }, null] },
      { $gt: [{ $toDate: '$offerSubmission.data.validUntil' }, '$$NOW'] }] } }, {
    $set: { 'offerSubmission.phase': 'committing' }
  }, { ...WRITE, runValidators: true })
  await RFQ.updateOne({ ...fence(id, j, ['pending']), status: 'offering', decision: { $exists: false },
    $expr: { $and: [{ $ne: [{ $ifNull: ['$offerSubmission.data.validUntil', null] }, null] }, { $lte: [{ $toDate: '$offerSubmission.data.validUntil' }, '$$NOW'] }] } },
    { $set: { 'offerSubmission.phase': 'aborting' } }, { ...WRITE })
  return finish(id, j)
}
async function resume(id, key) {
  const start = await load(id)
  if (key && start?.offerSubmission?.key !== key) {
    const old = start && await receipt(start, key)
    if (terminal(old)) return { rfq: start, offer: old, processing: false }
    throw conflict()
  }
  try { return { ...await completeSubmission(id, key), processing: false } }
  catch (error) {
    const rfq = await load(id), j = rfq?.offerSubmission
    if (key && j?.key !== key) {
      const old = rfq && await receipt(rfq, key)
      if (terminal(old)) return { rfq, offer: old, processing: false }
      throw error
    }
    if (!j || j.version !== 1) throw error
    if (!OPEN.includes(j.phase)) {
      const offer = await receipt(rfq, j.key)
      if (!terminal(offer)) throw error
      return { rfq, offer, processing: false }
    }
    try { await RFQ.updateOne(fence(id, j, OPEN), { $set: { 'offerSubmission.lastErrorCode': error.code === 'RFQ_OFFER_CONFLICT' ? error.code : 'RFQ_OFFER_RETRY',
      'offerSubmission.nextAttemptAt': new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(j.attempts || 0, 6))) } }, { ...WRITE }) } catch { /* Intent remains discoverable. */ }
    return { rfq, processing: true }
  }
}
async function submitOffer(req) {
  const recorded = await record(req)
  if (terminal(recorded.offer)) return { ...recorded, processing: false }
  return { ...await resume(recorded.rfq._id, recorded.rfq.offerSubmission.key), replayed: recorded.replayed }
}
async function retryOffer(req) {
  const rfq = await load(req.params.id); authorize(req, rfq)
  if (req.body?.offerId !== undefined) {
    if (!mongoose.isValidObjectId(req.body.offerId)) throw fail(400, 'معرف العرض غير صحيح')
    const old = await Offer.findOne({ _id: req.body.offerId, rfqId: rfq._id, supplierId: rfq.supplierId, 'submission.version': 1 }).select('+submission')
    if (terminal(old) && !(same(rfq.offerSubmission?.offerId, old._id) && OPEN.includes(rfq.offerSubmission.phase))) return { rfq, offer: old, processing: false, replayed: true }
    if (!same(rfq.offerSubmission?.offerId, req.body.offerId)) throw conflict()
  }
  if (rfq.offerSubmission?.version !== 1) throw conflict()
  await requireIndex()
  return { ...await resume(rfq._id, rfq.offerSubmission.key), replayed: true }
}
function submissionSummary(rfq) {
  const j = rfq?.offerSubmission
  if (j?.version !== 1 || !OPEN.includes(j.phase)) return undefined
  const d = j.data
  return { version: 1, phase: 'pending', offerId: j.offerId,
    input: { unitPrice: d.unitPrice, quantity: d.quantity, currency: d.currency, deliveryDays: d.deliveryDays, paymentTerms: d.paymentTerms, notes: d.notes, validUntil: d.validUntil } }
}
function offerResponse(result) {
  return { message: result.processing ? 'حُفظت محاولة العرض وجارٍ استكمالها؛ لم يتأكد إرسال العرض بعد.' : 'اكتملت معالجة محاولة العرض',
    rfq: result.rfq, ...(result.offer ? { offer: result.offer } : {}), processing: result.processing,
    submission: { version: 1, phase: result.processing ? 'pending' : result.offer?.submission?.phase || result.rfq.offerSubmission?.phase,
      replayed: result.replayed, offerId: result.offer?._id || result.rfq.offerSubmission?.offerId } }
}
async function recoverPendingOffers({ limit = 25, now = new Date(), onError } = {}) {
  const rows = await RFQ.find({ 'offerSubmission.version': 1, 'offerSubmission.phase': { $in: OPEN },
    $or: [{ 'offerSubmission.nextAttemptAt': { $lte: now } }, { 'offerSubmission.nextAttemptAt': { $exists: false } }] })
    .sort({ 'offerSubmission.nextAttemptAt': 1, _id: 1 }).limit(Math.min(100, Math.max(1, limit))).select('_id').lean()
  const result = { processed: rows.length, completed: 0, pending: 0 }
  for (const row of rows) {
    try { const r = await resume(row._id); result[r.processing ? 'pending' : 'completed']++; if (r.processing) onError?.({ code: 'RFQ_OFFER_RETRY', rfqId: String(row._id) }) }
    catch { result.pending++; onError?.({ code: 'RFQ_OFFER_UNAVAILABLE', rfqId: String(row._id) }) }
  }
  return result
}
function createOfferRecovery({ pollMs = 5000, onError } = {}) {
  let stopped = false, started = false, timer, running
  const runOnce = () => stopped ? Promise.resolve({ processed: 0, completed: 0, pending: 0 }) : (running ||= recoverPendingOffers({ onError }).finally(() => { running = null }))
  async function tick() { try { await runOnce() } catch { onError?.({ code: 'RFQ_OFFER_UNAVAILABLE' }) }; if (!stopped) { timer = setTimeout(tick, pollMs); timer.unref?.() } }
  return { runOnce, start() { if (!started) { started = true; tick() }; return this }, async stop({ graceMs = 15000 } = {}) {
    stopped = true; clearTimeout(timer); let timeout
    try { await Promise.race([running || Promise.resolve(), new Promise(resolve => { timeout = setTimeout(resolve, graceMs) })]) } finally { clearTimeout(timeout) }
  } }
}
module.exports = { submitOffer, retryOffer, offerResponse, submissionSummary, completeSubmission, recoverPendingOffers, createOfferRecovery }
