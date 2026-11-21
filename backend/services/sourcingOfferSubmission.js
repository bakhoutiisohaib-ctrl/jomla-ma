const mongoose = require('mongoose')
const crypto = require('crypto')
const Sourcing = require('../models/SourcingRequest')
const Notification = require('../models/Notification')
const Supplier = require('../models/Supplier')
const Membership = require('../models/Membership')
const Organization = require('../models/Organization')
const { sourcingDto, quoteDto } = require('./sourcingDto')
const KIND = 'sourcing_offer'
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000, runValidators: true }
const MAX_BSON = 16 * 1024 * 1024, HEADROOM = 256 * 1024
const same = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase()
const fail = (status, code, message) => Object.assign(new Error(message), { status, code })
const conflict = () => fail(409, 'SOURCING_OFFER_CONFLICT', 'تعارض في بيانات عملية التوريد؛ يلزم فحصها دون فرض نتيجة')
const unavailable = () => fail(503, 'SOURCING_OFFER_UNCONFIRMED', 'تعذر تأكيد إرسال العرض؛ استكمل المحاولة نفسها')
const busy = () => fail(409, 'SOURCING_OPERATION_PENDING', 'توجد عملية توريد قيد الاستكمال؛ أعد المحاولة نفسها لاحقاً')
function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (value?.toHexString) return value.toHexString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]))
  return value
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const hash = (parentId, supplierId, input) => digest({ version: 1, parentId: String(parentId).toLowerCase(), supplierId: String(supplierId).toLowerCase(), input })
const load = id => Sourcing.findById(id).select('+creationReceipt').read('primary').lean().maxTimeMS(10000)
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function inputFrom(body = {}) {
  const input = { unitPrice: Number(body?.unitPrice), currency: 'MAD', deliveryDays: body?.deliveryDays == null ? 3 : Number(body.deliveryDays),
    paymentTerms: text(body?.paymentTerms, 2000), notes: text(body?.notes, 5000) }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0.01 || !Number.isInteger(input.deliveryDays) || input.deliveryDays < 1) {
    throw fail(400, 'SOURCING_OFFER_INPUT_INVALID', 'السعر ومدة التسليم غير صحيحين')
  }
  return input
}
function keyFrom(req) {
  const key = req.get('Idempotency-Key')
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw fail(400, 'SOURCING_OFFER_KEY_REQUIRED', 'مفتاح محاولة إرسال عرض صالح مطلوب')
  return key
}
function authorize(req) {
  const actor = req.supplier
  if (!actor || !['supplier', 'admin', 'staff'].includes(actor.role) ||
      (actor.role === 'staff' && !actor.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))) {
    throw fail(403, 'SOURCING_OFFER_FORBIDDEN', 'ليست لديك صلاحية تقديم عروض التوريد')
  }
  return String(actor.ownerId || actor.id)
}
function commercialState(s) {
  return { buyerId: s.buyerId, productName: s.productName, category: s.category, quantity: s.quantity, unit: s.unit,
    buyerCity: s.buyerCity, targetPrice: s.targetPrice, imageUrl: s.imageUrl, notes: s.notes,
    status: s.status, quotesCount: s.quotesCount, quotes: s.quotes || [] }
}
function snapshot(s, input, actor, startedAt) {
  const totalPrice = s.quantity * input.unitPrice
  if (!Number.isFinite(s.quantity) || s.quantity < 1 || !Number.isFinite(totalPrice)) throw conflict()
  return { version: 1, pricedAt: startedAt,
    request: { id: s._id, buyerId: s.buyerId, productName: s.productName, category: s.category || '', quantity: s.quantity, unit: s.unit || '',
      buyerCity: s.buyerCity || '', targetPrice: s.targetPrice ?? null, imageUrl: s.imageUrl || '', notes: s.notes || '' },
    offer: { supplierId: actor.ownerId, actorId: actor.id, supplierName: actor.name, ...input, totalPrice } }
}
function quoteFor(j) {
  return { _id: j.quoteId, supplierId: j.supplierId, actorId: j.actor.id, supplierName: j.actor.name, ...j.input,
    status: 'active', createdAt: j.startedAt, commercialSnapshot: j.commercialSnapshot,
    submission: { version: 1, id: j.id, key: j.key, hash: j.hash, notificationId: j.notificationId } }
}
function publication(s, j) {
  const quotes = (s.quotes || []).map(q => same(q.supplierId, j.supplierId) && q.status === 'active' ? { ...q, status: 'superseded' } : q)
  quotes.push(quoteFor(j))
  return { quotes, quotesCount: quotes.filter(q => q.status === 'active').length, status: 'open' }
}
function ensureCapacity(s, j) {
  // Count ALL stored fields, including hidden creation receipts and unknown
  // legacy fields. Budget for operation + final quote simultaneously, plus
  // 256 KiB for bounded retry metadata, command framing and numeric growth.
  const pending = { ...s, operation: j, __v: j.expectedVersion }
  const largest = { ...pending, ...publication(s, j), __v: j.expectedVersion + 1 }
  if (Math.max(mongoose.mongo.BSON.calculateObjectSize(pending), mongoose.mongo.BSON.calculateObjectSize(largest)) > MAX_BSON - HEADROOM) {
    throw fail(413, 'SOURCING_DOCUMENT_CAPACITY', 'سجل العروض ممتلئ؛ لا يمكن حجز عرض جديد دون مراجعة تشغيلية')
  }
}
function checkedQuote(q, s) {
  let acceptedInput
  try { acceptedInput = inputFrom(q) } catch { throw conflict() }
  if (!q?.submission || q.submission.version !== 1 || !q.commercialSnapshot ||
      ![q.submission.id, q.submission.notificationId].every(mongoose.isValidObjectId) ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(q.submission.key) || q.commercialSnapshot.version !== 1 ||
      !same(q.commercialSnapshot.request?.id, s._id) || !same(q.commercialSnapshot.request?.buyerId, s.buyerId) ||
      !same(q.commercialSnapshot.offer?.supplierId, q.supplierId) ||
      !same(q.commercialSnapshot.offer?.actorId, q.actorId) ||
      digest({ unitPrice: q.unitPrice, currency: q.currency, deliveryDays: q.deliveryDays, paymentTerms: q.paymentTerms || '', notes: q.notes || '' }) !== digest(acceptedInput) ||
      q.submission.hash !== hash(s._id, q.supplierId, acceptedInput) ||
      digest(q.commercialSnapshot.offer) !== digest({ supplierId: q.supplierId, actorId: q.actorId, supplierName: q.supplierName,
        ...acceptedInput, totalPrice: q.commercialSnapshot.request.quantity * q.unitPrice })) throw conflict()
  return q
}
function receipt(s, supplierId, key) {
  const found = (s.quotes || []).filter(q => same(q.supplierId, supplierId) && q.submission?.key === key)
  if (found.length > 1) throw conflict()
  return found[0] ? checkedQuote(found[0], s) : null
}
function compare(value, expected) {
  if (value !== expected) throw fail(409, 'SOURCING_OFFER_KEY_CONFLICT', 'مفتاح العرض مستخدم لبيانات مختلفة؛ استكمل عرضه الأصلي')
}
function pendingGuard(s) { if (s.operation) throw busy() }
function fence(s, j) {
  return { _id: s._id, buyerId: j.buyerId, __v: j.expectedVersion, status: j.previousStatus,
    'operation.id': j.id, 'operation.kind': KIND, 'operation.version': 1, 'operation.phase': 'pending',
    'operation.parentId': s._id, 'operation.supplierId': j.supplierId, 'operation.buyerId': j.buyerId,
    'operation.key': j.key, 'operation.hash': j.hash, 'operation.baselineHash': j.baselineHash,
    'operation.quoteId': j.quoteId, 'operation.notificationId': j.notificationId }
}
function validate(s, expectedId) {
  const j = s?.operation
  let acceptedInput
  try { acceptedInput = j && inputFrom(j.input) } catch { throw conflict() }
  if (!j || j.version !== 1 || j.kind !== KIND || j.phase !== 'pending' || !same(j.id, expectedId) ||
      !same(j.parentId, s._id) || !same(j.buyerId, s.buyerId) || !same(j.actor?.ownerId, j.supplierId) ||
      !['supplier', 'admin', 'staff'].includes(j.actor?.role) || !j.actor?.name ||
      (j.actor.role !== 'staff' && !same(j.actor.id, j.supplierId)) ||
      ![j.id, j.quoteId, j.notificationId, j.supplierId, j.actor.id].every(mongoose.isValidObjectId) ||
      !Number.isSafeInteger(j.expectedVersion) || s.__v !== j.expectedVersion || s.status !== j.previousStatus ||
      !['open', 'quoted'].includes(s.status) || (s.quotes || []).some(q => q.status === 'accepted') ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(j.key) || !Number.isFinite(new Date(j.startedAt).getTime()) ||
      digest(acceptedInput) !== digest(j.input) || hash(s._id, j.supplierId, j.input) !== j.hash ||
      digest(commercialState(s)) !== j.baselineHash ||
      digest(snapshot(s, j.input, j.actor, j.startedAt)) !== digest(j.commercialSnapshot)) throw conflict()
  return j
}
async function actorStillAuthorized(j) {
  const actor = await Supplier.findById(j.actor.id).read('primary').lean().maxTimeMS(10000)
  if (!actor || actor.isActive === false || actor.role !== j.actor.role) throw conflict()
  if (actor.role !== 'staff') { if (!same(actor._id, j.supplierId)) throw conflict(); return }
  const membership = await Membership.findOne({ userId: actor._id, role: 'staff', status: 'active' }).read('primary').lean().maxTimeMS(10000)
  const org = membership && await Organization.findById(membership.organizationId).read('primary').lean().maxTimeMS(10000)
  if (!org || !same(org.ownerSupplierId, j.supplierId) || !membership.permissions?.some(p => ['all', 'manage_rfq'].includes(p)) ||
      !await Supplier.exists({ _id: j.supplierId, role: 'supplier', isActive: { $ne: false } }).read('primary').maxTimeMS(10000)) throw conflict()
}
async function record(req) {
  const supplierId = authorize(req), key = keyFrom(req), input = inputFrom(req.body)
  const expectedHash = hash(req.params.id, supplierId, input)
  const findExisting = s => {
    const q = receipt(s, supplierId, key)
    if (q) { compare(q.submission.hash, expectedHash); return { sourcing: s, quote: q, processing: false, replayed: true } }
    if (s.operation && same(s.operation.supplierId, supplierId) && s.operation.key === key) {
      compare(s.operation.hash, expectedHash)
      return { sourcing: s, operationId: s.operation.id, processing: true }
    }
    return null
  }
  let s = await load(req.params.id)
  if (!s) throw fail(404, 'SOURCING_NOT_FOUND', 'طلب التوريد غير موجود')
  let existing = findExisting(s)
  if (existing) return existing // Must precede closed/fulfilled checks.
  pendingGuard(s)
  if (!['open', 'quoted'].includes(s.status)) throw fail(409, 'SOURCING_CLOSED', 'طلب التوريد مغلق')
  if ((s.quotes || []).some(q => q.status === 'accepted') || (s.__v !== undefined && !Number.isSafeInteger(s.__v))) throw conflict()
  const startedAt = new Date(), actor = { id: new mongoose.Types.ObjectId(req.supplier.id), ownerId: new mongoose.Types.ObjectId(supplierId), role: req.supplier.role, name: req.supplier.name }
  const j = { version: 1, kind: KIND, phase: 'pending', id: new mongoose.Types.ObjectId(), parentId: s._id, buyerId: s.buyerId,
    supplierId: actor.ownerId, actor, key, hash: expectedHash, input, quoteId: new mongoose.Types.ObjectId(), notificationId: new mongoose.Types.ObjectId(),
    previousStatus: s.status, expectedVersion: (s.__v || 0) + 1, baselineHash: digest(commercialState(s)),
    commercialSnapshot: snapshot(s, input, actor, startedAt), startedAt, attempts: 0, nextAttemptAt: startedAt }
  ensureCapacity(s, j)
  let failure
  try {
    await Sourcing.updateOne({ _id: s._id, buyerId: s.buyerId, status: s.status, __v: s.__v === undefined ? { $exists: false } : s.__v,
      operation: { $exists: false }, quotes: { $not: { $elemMatch: { supplierId: actor.ownerId, 'submission.key': key } } } },
    { $set: { operation: j }, $inc: { __v: 1 } }, WRITE)
  } catch { failure = true }
  s = await load(req.params.id)
  if (!s) throw unavailable()
  existing = findExisting(s)
  if (existing) return existing
  if (s.operation) throw busy()
  if (failure) throw unavailable()
  throw fail(409, 'SOURCING_OFFER_CHANGED', 'تغير الطلب؛ أعد المحاولة نفسها بعد تحديثه')
}
async function checkpoint(id, expected) {
  const s = await load(id)
  const completed = (s?.quotes || []).find(q => same(q.submission?.id, expected.id))
  if (completed) return { sourcing: s, quote: checkedQuote(completed, s), processing: false }
  const j = validate(s, expected.id)
  const immutable = value => { const { attempts, nextAttemptAt, lastErrorCode, ...rest } = value; return rest }
  if (digest(immutable(j)) !== digest(immutable(expected))) throw conflict()
  await actorStillAuthorized(j)
  return { sourcing: s, j, processing: true }
}
async function complete(id, operationId) {
  let s = await load(id)
  const existing = (s?.quotes || []).find(q => same(q.submission?.id, operationId))
  if (existing) return { sourcing: s, quote: checkedQuote(existing, s), processing: false }
  const expected = validate(s, operationId)
  await actorStillAuthorized(expected)
  await Sourcing.updateOne(fence(s, expected), { $inc: { 'operation.attempts': 1 } }, WRITE)
  let current = await checkpoint(id, expected)
  if (!current.processing) return current
  const j = current.j
  const notice = { _id: j.notificationId, userId: j.buyerId, type: 'sourcing_offer', resourceType: 'sourcing', resourceId: s._id, createdAt: j.startedAt }
  try { await Notification.updateOne({ _id: j.notificationId }, { $setOnInsert: { ...notice, readAt: null } }, { ...WRITE, upsert: true }) }
  catch { /* Even write errors/duplicate errors require verifying the actual effect. */ }
  const saved = await Notification.findById(j.notificationId).read('primary').lean().maxTimeMS(10000)
  if (!saved) throw unavailable()
  if (!same(saved.userId, notice.userId) || !same(saved.resourceId, notice.resourceId) || saved.type !== notice.type ||
      saved.resourceType !== notice.resourceType || saved.decisionId || new Date(saved.createdAt).getTime() !== new Date(j.startedAt).getTime()) throw conflict()
  // Notification title/body are virtuals derived solely from type/resourceId;
  // those fields and the recipient/timestamp are checked, not client content.
  current = await checkpoint(id, expected)
  if (!current.processing) return current
  s = current.sourcing
  ensureCapacity(s, current.j)
  // Preserve unknown historical quote fields. Casting a whole legacy array
  // through Mongoose could silently strip them. The new quote/intent were
  // validated above; this single native CAS preserves every existing field.
  await Sourcing.collection.updateOne(fence(s, current.j), { $set: publication(s, current.j), $unset: { operation: 1 }, $inc: { __v: 1 } },
    { writeConcern: WRITE.writeConcern, maxTimeMS: WRITE.maxTimeMS })
  const result = await checkpoint(id, expected)
  if (result.processing) throw unavailable()
  return result
}
async function resume(id, operationId) {
  try { return await complete(id, operationId) }
  catch (error) {
    const s = await load(id)
    const completed = (s?.quotes || []).find(q => same(q.submission?.id, operationId))
    if (completed) return { sourcing: s, quote: checkedQuote(completed, s), processing: false }
    const j = s?.operation
    if (!j || !same(j.id, operationId)) throw unavailable()
    const code = error.code === 'SOURCING_OFFER_CONFLICT' ? error.code : 'SOURCING_OFFER_RETRY'
    try {
      // Operational rescheduling is safe even if the commercial baseline is
      // contradictory. Verify the saved intent type/parent/owner, and change
      // ONLY bounded diagnostic metadata, never prices/ownership or its phase.
      if (j.kind !== KIND || j.version !== 1 || j.phase !== 'pending' || !same(j.parentId, s._id) ||
          !same(j.actor?.ownerId, j.supplierId) || ![j.id, j.supplierId, j.actor?.id].every(mongoose.isValidObjectId) ||
          !['supplier', 'admin', 'staff'].includes(j.actor?.role) || (j.actor.role !== 'staff' && !same(j.actor.id, j.supplierId))) throw conflict()
      await Sourcing.updateOne({ _id: s._id, __v: s.__v, 'operation.id': j.id, 'operation.kind': KIND,
        'operation.version': 1, 'operation.phase': 'pending', 'operation.parentId': s._id,
        'operation.supplierId': j.supplierId, 'operation.actor.id': j.actor.id, 'operation.actor.ownerId': j.actor.ownerId,
        'operation.hash': j.hash }, { $set: { 'operation.lastErrorCode': code,
        'operation.nextAttemptAt': new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(j.attempts || 0, 6))) } }, WRITE)
    } catch { /* Never force a contradictory intent or erase it on a timeout. */ }
    return { sourcing: s, processing: true, operationId: j.id, code }
  }
}
async function submit(req) {
  try {
    const recorded = await record(req)
    return recorded.processing ? { ...await resume(req.params.id, recorded.operationId), replayed: false } : recorded
  } catch (error) { if (error.status) throw error; throw unavailable() }
}
async function retry(req) {
  try {
    const owner = authorize(req), s = await load(req.params.id), operationId = req.params.operationId
    if (!s) throw fail(404, 'SOURCING_NOT_FOUND', 'طلب التوريد غير موجود')
    const q = (s.quotes || []).find(q => same(q.submission?.id, operationId))
    if (q) {
      if (!same(q.supplierId, owner)) throw fail(403, 'SOURCING_OFFER_FORBIDDEN', 'هذه العملية خاصة بمورد آخر')
      return { sourcing: s, quote: checkedQuote(q, s), processing: false, replayed: true }
    }
    if (!s.operation || s.operation.kind !== KIND || s.operation.version !== 1 || s.operation.phase !== 'pending' || !same(s.operation.id, operationId) || !same(s.operation.supplierId, owner)) throw fail(403, 'SOURCING_OFFER_FORBIDDEN', 'هذه العملية خاصة بصاحبها')
    return { ...await resume(s._id, operationId), replayed: true }
  } catch (error) { if (error.status) throw error; throw unavailable() }
}
function response(result, actor) {
  return { message: result.processing ? 'حُفظت محاولة العرض وهي قيد الاستكمال؛ لم يُنشر العرض الجديد بعد' : 'تم حفظ عرض التوريد وإشعار المشتري',
    processing: result.processing, replayed: Boolean(result.replayed), ...(result.code ? { code: result.code } : {}),
    sourcing: sourcingDto(result.sourcing, actor), ...(result.quote ? { quote: quoteDto(result.quote) } : {}) }
}
module.exports = { submit, retry, response, resume, pendingGuard, busy, load, MAX_BSON, HEADROOM }
