const mongoose = require('mongoose')
const crypto = require('crypto')
const Sourcing = require('../models/SourcingRequest')
const Notification = require('../models/Notification')
const { logWarn } = require('../middleware/logger')
const Supplier = require('../models/Supplier')
const { load, MAX_BSON, HEADROOM, busy } = require('./sourcingOfferSubmission')
const { sourcingDto, quoteDto } = require('./sourcingDto')
const KIND = 'sourcing_decision', WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000, runValidators: true }
const same = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase()
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
const conflict = () => fail(409, 'SOURCING_DECISION_CONFLICT', 'تعارض في بيانات القرار؛ يلزم فحص تشغيلي آمن')
const unavailable = () => fail(503, 'SOURCING_DECISION_UNCONFIRMED', 'تعذر تأكيد القرار؛ أعد القرار نفسه أو استكمل عمليته')
const opposite = () => fail(409, 'SOURCING_DECISION_ACTION_CONFLICT', 'ثُبت إجراء آخر لهذا العرض؛ لا يمكن عكسه')
function canonical(v) {
  if (v == null) return v
  if (v instanceof Date) return v.toISOString()
  if (v.toHexString) return v.toHexString()
  if (Array.isArray(v)) return v.map(canonical)
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]))
  return v
}
const digest = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const state = s => ({ buyerId: s.buyerId, productName: s.productName, category: s.category, quantity: s.quantity, unit: s.unit,
  buyerCity: s.buyerCity, targetPrice: s.targetPrice, imageUrl: s.imageUrl, notes: s.notes, status: s.status, quotesCount: s.quotesCount, quotes: s.quotes })
const terms = q => ({ supplierId: q.supplierId, actorId: q.actorId, supplierName: q.supplierName, unitPrice: q.unitPrice,
  currency: q.currency, deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms || '', notes: q.notes || '' })
function checkSnapshot(s, q, snap) {
  if (!snap || snap.version !== 1 || !same(snap.request?.id, s._id) || !same(snap.request?.buyerId, s.buyerId) ||
      !Number.isFinite(new Date(snap.pricedAt).getTime()) || !Number.isFinite(snap.request.quantity) || snap.request.quantity < 1 ||
      !mongoose.isValidObjectId(q.supplierId) || !mongoose.isValidObjectId(q.actorId) || !q.supplierName ||
      !Number.isFinite(q.unitPrice) || q.unitPrice < 0.01 || q.currency !== 'MAD' || !Number.isInteger(q.deliveryDays) || q.deliveryDays < 1 ||
      !Number.isFinite(q.unitPrice * snap.request.quantity) || digest(snap.offer) !== digest({ ...terms(q), totalPrice: q.unitPrice * snap.request.quantity })) throw conflict()
  return snap
}
function snapshot(s, q, startedAt) {
  if (q.commercialSnapshot) return { source: 's2_commercial_snapshot', commercialSnapshot: checkSnapshot(s, q, q.commercialSnapshot) }
  const snap = { version: 1, pricedAt: startedAt, request: { id: s._id, buyerId: s.buyerId,
    productName: s.productName, category: s.category, quantity: s.quantity, unit: s.unit, buyerCity: s.buyerCity,
    targetPrice: s.targetPrice, imageUrl: s.imageUrl, notes: s.notes }, offer: { ...terms(q), totalPrice: s.quantity * q.unitPrice } }
  return { source: 'legacy_sourcing_quote_at_decision', commercialSnapshot: checkSnapshot(s, q, snap) }
}
const hash = j => digest({ version: 1, parentId: j.parentId, buyerId: j.buyerId, supplierId: j.supplierId,
  quoteId: j.quoteId, action: j.action, source: j.source, commercialSnapshot: j.commercialSnapshot })
const agreement = j => ({ version: 1, quoteId: j.quoteId, source: j.source, agreedAt: j.startedAt, snapshot: j.commercialSnapshot })
const receiptFor = j => ({ version: 1, id: j.id, buyerId: j.buyerId, quoteId: j.quoteId, notificationId: j.notificationId,
  action: j.action, decidedAt: j.startedAt, source: j.source, hash: j.hash, commercialSnapshot: j.commercialSnapshot })
function checkedReceipt(s, q) {
  const r = q?.decisionReceipt
  if (!r || r.version !== 1 || !['accept', 'reject'].includes(r.action) || ![r.id, r.buyerId, r.quoteId, r.notificationId].every(mongoose.isValidObjectId) ||
      !same(r.buyerId, s.buyerId) || !same(r.quoteId, q._id) || !Number.isFinite(new Date(r.decidedAt).getTime()) ||
      !['s2_commercial_snapshot', 'legacy_sourcing_quote_at_decision'].includes(r.source) ||
      (q.commercialSnapshot ? r.source !== 's2_commercial_snapshot' || digest(r.commercialSnapshot) !== digest(q.commercialSnapshot) : r.source !== 'legacy_sourcing_quote_at_decision') ||
      r.hash !== hash({ ...r, parentId: s._id, supplierId: q.supplierId }) || q.status !== (r.action === 'accept' ? 'accepted' : 'rejected')) throw conflict()
  checkSnapshot(s, q, r.commercialSnapshot)
  if (r.action === 'accept' && (s.status !== 'fulfilled' || (s.quotes || []).filter(x => x.status === 'accepted').length !== 1 ||
      digest(q.agreement) !== digest(agreement({ ...r, startedAt: r.decidedAt })))) throw conflict()
  return { sourcing: s, quote: q, processing: false, replayed: true }
}
function publication(s, j) {
  const quotes = s.quotes.map(q => same(q._id, j.quoteId) ? { ...q, status: j.action === 'accept' ? 'accepted' : 'rejected',
    decisionReceipt: receiptFor(j), ...(j.action === 'accept' ? { agreement: agreement(j) } : {}) }
    : j.action === 'accept' && q.status === 'active' ? { ...q, status: 'superseded' } : q)
  return { quotes, status: j.action === 'accept' ? 'fulfilled' : j.previousStatus, quotesCount: quotes.filter(q => q.status === 'active').length }
}
function capacity(s, j) {
  const pending = { ...s, operation: j, __v: j.expectedVersion }, final = { ...pending, ...publication(s, j), __v: j.expectedVersion + 1 }
  if (Math.max(mongoose.mongo.BSON.calculateObjectSize(pending), mongoose.mongo.BSON.calculateObjectSize(final)) > MAX_BSON - HEADROOM)
    throw fail(413, 'SOURCING_DOCUMENT_CAPACITY', 'سجل التوريد لا يتسع لتثبيت القرار بأمان؛ يلزم فحص تشغيلي')
}
function identity(s, j, operationId) {
  return j?.kind === KIND && j.version === 1 && j.phase === 'pending' && same(j.id, operationId) && same(j.parentId, s._id) &&
    same(j.buyerId, s.buyerId) && same(j.actor?.id, j.buyerId) && same(j.actor?.ownerId, j.buyerId) && j.actor?.role === 'buyer' &&
    [j.id, j.buyerId, j.supplierId, j.quoteId, j.notificationId].every(mongoose.isValidObjectId) && ['accept', 'reject'].includes(j.action)
}
function validate(s, operationId) {
  const j = s?.operation, q = s?.quotes?.find(x => same(x._id, j?.quoteId))
  if (!s || !identity(s, j, operationId) || !q || q.status !== 'active' || q.decisionReceipt || q.agreement || !same(q.supplierId, j.supplierId) ||
      !['open', 'quoted'].includes(s.status) || s.status !== j.previousStatus || s.quotes.some(x => x.status === 'accepted') ||
      !Number.isSafeInteger(j.expectedVersion) || s.__v !== j.expectedVersion || !Number.isFinite(new Date(j.startedAt).getTime()) ||
      digest(state(s)) !== j.baselineHash || hash(j) !== j.hash || digest(snapshot(s, q, j.startedAt)) !== digest({ source: j.source, commercialSnapshot: j.commercialSnapshot })) throw conflict()
  return j
}
const fence = (s, j) => ({ _id: s._id, buyerId: j.buyerId, __v: j.expectedVersion, status: j.previousStatus,
  'operation.id': j.id, 'operation.kind': KIND, 'operation.version': 1, 'operation.phase': 'pending', 'operation.parentId': s._id,
  'operation.buyerId': j.buyerId, 'operation.supplierId': j.supplierId, 'operation.actor.id': j.buyerId,
  'operation.quoteId': j.quoteId, 'operation.action': j.action, 'operation.hash': j.hash, 'operation.baselineHash': j.baselineHash,
  'operation.notificationId': j.notificationId })
async function actorAuthorized(j) {
  if (!await Supplier.exists({ _id: j.buyerId, role: 'buyer', isActive: { $ne: false } }).read('primary').maxTimeMS(10000)) throw conflict()
}
const byOperation = (s, id) => s?.quotes?.find(q => same(q.decisionReceipt?.id, id))
async function checkpoint(id, expected) {
  const s = await load(id), done = byOperation(s, expected.id)
  if (done) return checkedReceipt(s, done)
  const j = validate(s, expected.id), immutable = v => { const { attempts, nextAttemptAt, lastErrorCode, recoveryPausedAt, expiresAt, ...rest } = v; return rest }
  if (digest(immutable(j)) !== digest(immutable(expected))) throw conflict()
  await actorAuthorized(j)
  return { sourcing: s, j, processing: true }
}
async function record(req) {
  if (req.supplier.role !== 'buyer') throw fail(403, 'SOURCING_DECISION_FORBIDDEN', 'القرار للمشتري المالك فقط')
  const action = req.body.action, quoteId = req.params.quoteId
  if (!['accept', 'reject'].includes(action) || !mongoose.isValidObjectId(quoteId)) throw fail(400, 'SOURCING_DECISION_INVALID', 'الإجراء غير صحيح')
  function existing(s) {
    if (!s) throw fail(404, 'SOURCING_NOT_FOUND', 'طلب التوريد غير موجود')
    if (!same(s.buyerId, req.supplier.id)) throw fail(403, 'SOURCING_DECISION_FORBIDDEN', 'هذا الطلب لمشترٍ آخر')
    const q = s.quotes.find(x => same(x._id, quoteId))
    if (q?.decisionReceipt) { const r = checkedReceipt(s, q); if (q.decisionReceipt.action !== action) throw opposite(); return r }
    if (s.operation?.kind === KIND && same(s.operation.quoteId, quoteId)) {
      if (!identity(s, s.operation, s.operation.id)) throw conflict()
      if (s.operation.action !== action) throw opposite()
      return { sourcing: s, operationId: s.operation.id, processing: true }
    }
    return null
  }
  let s = await load(req.params.id), result = existing(s)
  if (result) return result
  if (s.operation) throw busy()
  const q = s.quotes.find(x => same(x._id, quoteId))
  // Completed legacy decisions are never guessed into new receipts/effects.
  if (!q || q.status !== 'active' || q.agreement || !['open', 'quoted'].includes(s.status) || s.quotes.some(x => x.status === 'accepted'))
    throw fail(409, 'SOURCING_DECISION_UNAVAILABLE', 'العرض غير فعال أو القرار التاريخي لا يملك إيصالاً قابلاً للإعادة')
  if (s.__v !== undefined && !Number.isSafeInteger(s.__v)) throw conflict()
  const startedAt = new Date(), j = { version: 1, kind: KIND, phase: 'pending', id: new mongoose.Types.ObjectId(), parentId: s._id,
    buyerId: s.buyerId, supplierId: q.supplierId, quoteId: q._id, notificationId: new mongoose.Types.ObjectId(), action,
    actor: { id: s.buyerId, ownerId: s.buyerId, role: 'buyer', name: req.supplier.name }, ...snapshot(s, q, startedAt),
    previousStatus: s.status, expectedVersion: (s.__v || 0) + 1, baselineHash: digest(state(s)), startedAt, expiresAt: new Date(startedAt.getTime() + 3600000), attempts: 0, nextAttemptAt: startedAt }
  j.hash = hash(j); capacity(s, j)
  try { await Sourcing.updateOne({ _id: s._id, buyerId: s.buyerId, status: s.status,
    __v: s.__v === undefined ? { $exists: false } : s.__v, operation: { $exists: false }, quotes: { $elemMatch: { _id: q._id, status: 'active', decisionReceipt: { $exists: false } } } },
    { $set: { operation: j }, $inc: { __v: 1 } }, WRITE) } catch { /* Resolve uncertain write using the saved natural identity. */ }
  s = await load(req.params.id); result = existing(s)
  if (result) return result
  if (s.operation) throw busy()
  throw unavailable()
}
async function complete(id, operationId) {
  let s = await load(id), done = byOperation(s, operationId)
  if (done) return checkedReceipt(s, done)
  const expected = validate(s, operationId)
  await actorAuthorized(expected); capacity(s, expected)
  await Sourcing.updateOne(fence(s, expected), { $inc: { 'operation.attempts': 1 } }, WRITE)
  let current = await checkpoint(id, expected)
  if (!current.processing) return current
  const j = current.j
  // Capacity is checked before the notification as well as before publication.
  capacity(current.sourcing, j)
  const notice = { _id: j.notificationId, userId: j.supplierId, type: 'sourcing_decision', resourceType: 'sourcing', resourceId: j.parentId, createdAt: j.startedAt }
  try { await Notification.updateOne({ _id: j.notificationId }, { $setOnInsert: { ...notice, readAt: null } }, { ...WRITE, upsert: true }) } catch { /* Verify even an acknowledged-error write. */ }
  const saved = await Notification.findById(j.notificationId).read('primary').lean().maxTimeMS(10000)
  if (!saved) throw unavailable()
  if (!same(saved.userId, notice.userId) || saved.type !== notice.type || saved.resourceType !== notice.resourceType || !same(saved.resourceId, notice.resourceId) ||
      saved.decisionId || new Date(saved.createdAt).getTime() !== new Date(j.startedAt).getTime()) throw conflict()
  current = await checkpoint(id, expected)
  if (!current.processing) return current
  s = current.sourcing; capacity(s, current.j)
  await Sourcing.collection.updateOne(fence(s, current.j), { $set: publication(s, current.j), $unset: { operation: 1 }, $inc: { __v: 1 } },
    { writeConcern: WRITE.writeConcern, maxTimeMS: WRITE.maxTimeMS })
  const result = await checkpoint(id, expected)
  if (result.processing) throw unavailable()
  return result
}
async function resume(id, operationId) {
  const held = await load(id)
  if (held?.operation?.recoveryPausedAt && same(held.operation.id, operationId)) return { sourcing: held, processing: true, operationId, code: 'SOURCING_DECISION_MANUAL_RETRY' }
  try { return await complete(id, operationId) } catch (error) {
    const s = await load(id), done = byOperation(s, operationId)
    if (done) return checkedReceipt(s, done)
    const j = s?.operation
    if (!j || !same(j.id, operationId)) throw unavailable()
    const code = error.code === 'SOURCING_DECISION_CONFLICT' ? error.code : 'SOURCING_DECISION_RETRY'
    try { if (!identity(s, j, operationId)) throw conflict()
      await Sourcing.updateOne(fence(s, j), { $set: { 'operation.lastErrorCode': code,
        'operation.nextAttemptAt': new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(j.attempts || 0, 6))) } }, WRITE)
    } catch { logWarn('SOURCING_DECISION_RECOVERY_STATE_FAILED') }
    return { sourcing: s, processing: true, operationId: j.id, code }
  }
}
async function decide(req) {
  try { const r = await record(req); return r.processing ? { ...await resume(req.params.id, r.operationId), replayed: false } : r }
  catch (error) { if (error.status) throw error; throw unavailable() }
}
async function retry(req) {
  try {
    const s = await load(req.params.id), operationId = req.params.operationId
    if (!s) throw fail(404, 'SOURCING_NOT_FOUND', 'طلب التوريد غير موجود')
    if (req.supplier.role !== 'buyer' || !same(s.buyerId, req.supplier.id)) throw fail(403, 'SOURCING_DECISION_FORBIDDEN', 'القرار للمشتري المالك فقط')
    const done = byOperation(s, operationId)
    if (done) return checkedReceipt(s, done)
    if (!identity(s, s.operation, operationId)) throw fail(403, 'SOURCING_DECISION_FORBIDDEN', 'لا توجد عملية قرار مخولة بهذا المعرف')
    if (s.operation.recoveryPausedAt) await Sourcing.updateOne(fence(s, s.operation), { $set: { 'operation.attempts': 0, 'operation.expiresAt': new Date(Date.now() + 3600000) }, $unset: { 'operation.recoveryPausedAt': 1 } }, WRITE)
    return { ...await resume(s._id, operationId), replayed: true }
  } catch (error) { if (error.status) throw error; throw unavailable() }
}
function response(r, actor) {
  return { message: r.processing ? 'حُفظ القرار وهو قيد الاستكمال؛ لم يثبت نهائياً بعد' : 'تم تثبيت قرار عرض التوريد', processing: r.processing,
    replayed: Boolean(r.replayed), ...(r.code ? { code: r.code } : {}), sourcing: sourcingDto(r.sourcing, actor), ...(r.quote ? { quote: quoteDto(r.quote) } : {}) }
}
module.exports = { decide, retry, resume, response, checkedReceipt }
