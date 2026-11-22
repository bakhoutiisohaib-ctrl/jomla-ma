const crypto = require('crypto')
const mongoose = require('mongoose')
const QuoteRequest = require('../models/QuoteRequest')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const Product = require('../models/Product')
const Store = require('../models/Store')
const { logWarn } = require('../middleware/logger')
const Supplier = require('../models/Supplier')
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000 }
const INDEX = 'rfq_creation_buyer_key'
const error = (status, message, code = 'RFQ_CREATION_RETRY') => Object.assign(new Error(message), { status, code })
const conflict = () => error(409, 'سجل إنشاء الطلب يحتاج مراجعة؛ لم تُنشأ بيانات بديلة', 'RFQ_CREATION_CONFLICT')
const same = (a, b) => a != null && b != null && String(a) === String(b)
const text = (value, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const load = id => QuoteRequest.findById(id).select('+creation')
const pending = rfq => rfq?.status === 'creating' && rfq.creation?.version === 1 && rfq.creation.phase === 'pending'
const publicRfq = record => { const out = record.toObject ? record.toObject({ transform: false }) : { ...record }; delete out.creation; return out }

function inputIdentity(req) {
  const supplied = req.get('Idempotency-Key')
  if (supplied !== undefined && !/^[A-Za-z0-9_-]{16,128}$/.test(supplied)) throw error(400, 'معرف محاولة إرسال الطلب غير صالح')
  const body = req.body || {}
  if (!mongoose.isValidObjectId(body.productId) || !Number.isSafeInteger(Number(body.quantity)) || Number(body.quantity) < 1 ||
      (body.targetPrice != null && body.targetPrice !== '' && (!Number.isFinite(Number(body.targetPrice)) || Number(body.targetPrice) < 0))) throw error(400, 'معرف المنتج أو الكمية أو السعر المستهدف غير صحيح')
  const buyerPhone = text(body.buyerPhone, 30)
  if (!/^[+0-9\s\-()]{8,20}$/.test(buyerPhone)) throw error(400, 'رقم الهاتف غير صحيح')
  // A fixed accepted-field order and normalized primitive values form canonical
  // input; caller-supplied identity/status/creation fields have no authority.
  const input = { productId: String(body.productId).toLowerCase(), quantity: Number(body.quantity), buyerPhone,
    buyerCity: text(body.buyerCity, 200), targetPrice: body.targetPrice == null || body.targetPrice === '' ? null : Number(body.targetPrice), notes: text(body.notes) }
  // Keep the canonical identity of all pre-W1 attempts byte-for-byte compatible.
  if (body.opportunityId != null) {
    if (typeof body.opportunityId !== 'string' || !/^[a-f0-9]{24}$/i.test(body.opportunityId) || !supplied) throw error(400, 'معرف الفرصة ومحاولة RFQ مطلوبان')
    input.opportunityId = body.opportunityId.toLowerCase()
  }
  return { input, key: supplied || 'legacy_' + crypto.randomUUID(),
    hash: crypto.createHash('sha256').update(JSON.stringify({ buyerId: req.supplier.id, input })).digest('hex') }
}

async function requireIndex() {
  try {
    await QuoteRequest.init()
    const index = (await QuoteRequest.collection.indexes()).find(item => item.name === INDEX)
    const keys = Object.keys(index?.key || {})
    const partial = index?.partialFilterExpression
    if (!index?.unique || keys.length !== 2 || index.key.buyerId !== 1 || index.key['creation.key'] !== 1 ||
        Object.keys(partial || {}).length !== 1 || Object.keys(partial['creation.key'] || {}).length !== 1 || partial['creation.key'].$type !== 'string' ||
        index.sparse || (index.collation && index.collation.locale !== 'simple')) throw new Error('Index unavailable')
  } catch { throw error(503, 'تعذر تأكيد حماية إنشاء الطلب؛ استكمل لاحقاً بنفس المعرف') }
}

async function recordCreation(req) {
  const { input, key, hash } = inputIdentity(req), buyerId = req.supplier.id
  await requireIndex()
  const filter = { buyerId, 'creation.key': key }
  let rfq = await QuoteRequest.findOne(filter).select('+creation')
  let replayed = Boolean(rfq)
  if (!rfq) {
    const product = await Product.findById(input.productId)
    if (!product || product.isDraft !== false || product.inStock !== true || product.availability !== 'in_stock' ||
        product.availabilityConfirmed !== true || product.moderationStatus === 'hidden' || !product.supplierId) throw error(404, 'المنتج غير متاح لطلبات عروض الأسعار')
    const [store, supplier] = await Promise.all([
      product.storeId && Store.findOne({ _id: product.storeId, supplierId: product.supplierId, isActive: true, reviewStatus: 'approved' }),
      Supplier.findOne({ _id: product.supplierId, role: 'supplier', isActive: { $ne: false } })
    ])
    if (!store || !supplier) throw error(404, 'المتجر غير متاح لطلبات عروض الأسعار')
    if (input.quantity < product.moq) throw error(400, 'الكمية أقل من الحد الأدنى للطلب')
    const wholesaleOpportunity = input.opportunityId
      ? await require('./wholesaleOpportunities').snapshot(input.opportunityId, input.productId, input.quantity) : undefined
    const now = new Date()
    rfq = new QuoteRequest({ ...input, targetPrice: input.targetPrice == null ? undefined : input.targetPrice,
      supplierId: product.supplierId, buyerId, buyerName: req.supplier.name, currency: product.currency, wholesaleOpportunity,
      // Ready RFQs retain Phase B's original revision0; -1 fences only the new
      // intermediate state against late UI reads during creation recovery.
      status: 'creating', revision: -1, createdAt: now, creation: { version: 1, key, hash, phase: 'pending',
        threadId: new mongoose.Types.ObjectId(), notificationId: new mongoose.Types.ObjectId(),
        subject: product.name || 'طلب عرض سعر', initialContent: input.notes || 'الكمية المطلوبة: ' + input.quantity + ' ' + product.unit,
        attempts: 0, nextAttemptAt: now } })
    try { await rfq.save({ ...WRITE }) }
    catch (failure) {
      // Covers duplicate-key races AND insert-committed/acknowledgement-lost.
      const saved = await QuoteRequest.findOne(filter).select('+creation')
      if (!saved) throw failure
      rfq = saved; replayed = true
    }
  }
  if (rfq.creation?.hash !== hash) throw error(409, 'استُخدم معرف المحاولة مع محتوى مختلف؛ استكمل الطلب الأصلي أولاً', 'RFQ_CREATION_KEY_CONFLICT')
  return { rfq, replayed }
}

async function completeCreation(id) {
  const rfq = await load(id)
  if (rfq?.creation?.version !== 1) throw conflict()
  const c = rfq.creation
  if (c.phase === 'completed' && rfq.status !== 'creating') return rfq
  if (!pending(rfq) || !c.threadId || !c.notificationId || !c.subject || !c.initialContent || rfq.decision) throw conflict()
  await QuoteRequest.updateOne({ _id: id, status: 'creating', 'creation.version': 1, 'creation.phase': 'pending' }, { $inc: { 'creation.attempts': 1 } }, { ...WRITE })
  // Stable _ids are part of the initial RFQ insert. Upserts never reopen a
  // conversation or replace messages/readAt when another completer wins.
  try {
    await MessageThread.updateOne({ _id: c.threadId }, { $setOnInsert: {
      rfqId: rfq._id, productId: rfq.productId, supplierId: rfq.supplierId, buyerId: rfq.buyerId,
      buyerName: rfq.buyerName, buyerPhone: rfq.buyerPhone, subject: c.subject, status: 'open',
      createdAt: rfq.createdAt, lastMessageAt: rfq.createdAt,
      messages: [{ _id: c.threadId, senderId: rfq.buyerId, senderRole: 'buyer', senderName: rfq.buyerName, content: c.initialContent, sentAt: rfq.createdAt }]
    } }, { ...WRITE, upsert: true, runValidators: true })
  } catch (failure) { if (failure.code !== 11000) throw failure }
  if (!await MessageThread.exists({ _id: c.threadId, rfqId: id, buyerId: rfq.buyerId, supplierId: rfq.supplierId,
    productId: rfq.productId, 'messages._id': c.threadId })) throw conflict()
  try {
    await Notification.updateOne({ _id: c.notificationId }, { $setOnInsert: {
      userId: rfq.supplierId, type: 'rfq_created', resourceType: 'rfq', resourceId: rfq._id, createdAt: rfq.createdAt, readAt: null
    } }, { ...WRITE, upsert: true, runValidators: true })
  } catch (failure) { if (failure.code !== 11000) throw failure }
  if (!await Notification.exists({ _id: c.notificationId, userId: rfq.supplierId, type: 'rfq_created', resourceType: 'rfq', resourceId: id })) throw conflict()
  // Readiness is published LAST. Phase B sees an ordinary pending RFQ only
  // after every required creation effect is persisted and verified.
  await QuoteRequest.updateOne({ _id: id, status: 'creating', 'creation.version': 1, 'creation.phase': 'pending' }, {
    $set: { status: 'pending', 'creation.phase': 'completed', 'creation.completedAt': new Date() },
    $unset: { 'creation.nextAttemptAt': 1, 'creation.lastErrorCode': 1 }, $inc: { revision: 1 }
  }, { ...WRITE, runValidators: true })
  const current = await load(id)
  if (current?.creation?.phase !== 'completed' || current.status === 'creating') throw conflict()
  return current
}

async function postpone(id, failure) {
  const rfq = await load(id)
  const delay = Math.min(60000, 1000 * 2 ** Math.min(rfq?.creation?.attempts || 0, 6))
  await QuoteRequest.updateOne({ _id: id, status: 'creating', 'creation.version': 1, 'creation.phase': 'pending' }, { $set: {
    'creation.nextAttemptAt': new Date(Date.now() + delay), 'creation.lastErrorCode': failure.code === 'RFQ_CREATION_CONFLICT' ? failure.code : 'RFQ_CREATION_RETRY'
  } }, { ...WRITE })
}

async function resumeCreation(id) {
  const held = await load(id)
  if (held?.creation?.phase === 'dead') return { rfq: held, processing: true }
  try { return { rfq: await completeCreation(id), processing: false } }
  catch (failure) {
    const current = await load(id)
    if (current?.creation?.version === 1 && current.creation.phase === 'completed' && current.status !== 'creating') return { rfq: current, processing: false }
    if (!pending(current)) throw failure
    try { await postpone(id, failure) } catch { logWarn('RFQ_CREATION_POSTPONE_FAILED') }
    return { rfq: current, processing: true }
  }
}

async function createRfq(req) {
  const { rfq, replayed } = await recordCreation(req)
  return { ...await resumeCreation(rfq._id), replayed }
}

async function retryCreation(id, buyerId) {
  const rfq = await load(id)
  if (!rfq) throw error(404, 'الطلب غير موجود')
  if (!same(rfq.buyerId, buyerId)) throw error(403, 'لا يمكنك استكمال طلب مشترٍ آخر')
  if (rfq.creation?.version !== 1) throw error(409, 'هذا سجل سابق لا يحمل محاولة إنشاء قابلة للاستكمال')
  if (rfq.creation.phase === 'dead') await QuoteRequest.updateOne({ _id: id, buyerId, status: 'creating', 'creation.phase': 'dead' }, { $set: { 'creation.phase': 'pending', 'creation.attempts': 0 }, $unset: { 'creation.lastErrorCode': 1 } }, WRITE)
  return { ...await resumeCreation(id), replayed: true }
}

function creationResponse(result) {
  return { message: result.rfq.creation.phase === 'dead' ? 'توقفت المحاولات الآلية. استكمل المحاولة نفسها دون إنشاء طلب بديل.' : result.processing ? 'حُفظ طلبك وجارٍ استكمال المحادثة والإشعار؛ لم يكتمل الإرسال بعد.' : 'تم إرسال طلب عرض السعر',
    rfq: publicRfq(result.rfq), processing: result.processing, ...(!result.processing ? { threadId: result.rfq.creation.threadId } : {}),
    creation: { version: 1, phase: result.rfq.creation.phase, replayed: result.replayed } }
}

async function recoverPendingCreations({ limit = 25, now = new Date(), onError } = {}) {
  const stopped = await QuoteRequest.updateMany({ status: 'creating', 'creation.version': 1, 'creation.phase': 'pending', 'creation.attempts': { $gte: 5 } }, { $set: { 'creation.phase': 'dead', 'creation.lastErrorCode': 'RFQ_CREATION_MANUAL_RETRY' }, $unset: { 'creation.nextAttemptAt': 1 } }, WRITE)
  if (stopped.modifiedCount) logWarn('RFQ_CREATION_RETRY_LIMIT_REACHED')
  const rows = await QuoteRequest.find({ status: 'creating', 'creation.version': 1, 'creation.phase': 'pending',
    $or: [{ 'creation.nextAttemptAt': { $lte: now } }, { 'creation.nextAttemptAt': { $exists: false } }] })
    .sort({ 'creation.nextAttemptAt': 1, _id: 1 }).limit(Math.min(100, Math.max(1, limit))).select('_id').lean()
  const result = { processed: rows.length, completed: 0, pending: 0 }
  for (const row of rows) {
    try {
      const resumed = await resumeCreation(row._id); result[resumed.processing ? 'pending' : 'completed']++
      if (resumed.processing) onError?.({ code: resumed.rfq.creation.lastErrorCode || 'RFQ_CREATION_RETRY', rfqId: String(row._id) })
    }
    catch { result.pending++; onError?.({ code: 'RFQ_CREATION_RETRY', rfqId: String(row._id) }) }
  }
  return result
}

function createCreationRecovery({ pollMs = 5000, onError } = {}) {
  let timer, running, stopped = false, started = false
  const runOnce = () => {
    if (stopped) return Promise.resolve({ processed: 0, completed: 0, pending: 0 })
    if (!running) running = recoverPendingCreations({ onError }).finally(() => { running = null })
    return running
  }
  async function tick() {
    try { await runOnce() } catch { onError?.({ code: 'RFQ_CREATION_UNAVAILABLE' }) }
    if (!stopped) { timer = setTimeout(tick, pollMs); timer.unref?.() }
  }
  return { runOnce, start() { if (!started) { started = true; tick() } return this }, async stop({ graceMs = 15000 } = {}) {
    stopped = true; clearTimeout(timer); let timeout
    try { await Promise.race([running || Promise.resolve(), new Promise(resolve => { timeout = setTimeout(resolve, graceMs) })]) }
    finally { clearTimeout(timeout) }
  } }
}

module.exports = { createRfq, retryCreation, creationResponse, completeCreation, recoverPendingCreations, createCreationRecovery }
