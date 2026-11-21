process.env.JWT_SECRET = 's2-synthetic-isolated-test-secret'
const request = require('supertest'), mongoose = require('mongoose'), crypto = require('crypto'), express = require('express')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), S = require('../models/SourcingRequest'), N = require('../models/Notification')
const Supplier = require('../models/Supplier'), Membership = require('../models/Membership')
const { generateToken } = require('../middleware/auth')
const { definition } = require('../services/sourcingCreationIndex')
const service = require('../services/sourcingOfferSubmission'), { recover, createSourcingRecovery } = require('../services/sourcingRecovery')
let mongo, f
const key = () => crypto.randomUUID(), auth = who => ({ Authorization: 'Bearer ' + f.tokens[who] })
const input = { unitPrice: 12, deliveryDays: 3, paymentTerms: 'الدفع حسب الاتفاق', notes: 'بيانات اصطناعية' }
async function create() {
  const result = await request(app).post('/api/sourcing').set(auth('buyer')).set('Idempotency-Key', key()).send({ productName: 'طلب S2 اصطناعي', buyerPhone: '+212655443322', quantity: 100, unit: 'زوج', notes: 'المواصفات الأصلية' })
  expect(result.status).toBe(201); return result.body.sourcing._id
}
const send = (id, attempt = key(), data = input, who = 'supplier', server = app) => request(server).post('/api/sourcing/' + id + '/quote').set(auth(who)).set('Idempotency-Key', attempt).send(data)
const read = (id, who = 'buyer') => request(app).get('/api/sourcing/' + id).set(auth(who))
const retry = (id, op, who = 'supplier') => request(app).post('/api/sourcing/' + id + '/operations/' + op + '/retry').set(auth(who)).send({})
const decide = (id, q, action = 'accept', who = 'buyer') => request(app).put('/api/sourcing/' + id + '/quotes/' + q + '/action').set(auth(who)).send({ action })
const raw = id => S.findById(id).select('+creationReceipt').lean()
const notices = id => N.find({ resourceId: id, type: 'sourcing_offer' }).lean()
function fault(target, method, predicate, after = false, once = false) {
  const real = target[method].bind(target); let fired = false
  return jest.spyOn(target, method).mockImplementation(async (...args) => {
    if (predicate(...args) && (!once || !fired)) { fired = true; if (after) await real(...args); throw new Error('Synthetic S2 write acknowledgement failure') }
    return real(...args)
  })
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri(), { autoIndex: false })
  await S.collection.createIndex(definition.key, definition.options)
  f = await require('./helpers/tradeFixtures')()
  f.staff2 = await Supplier.create({ name: 'موظف ثان اصطناعي', email: 's2-second-staff@trade.test', password: 'synthetic-password', role: 'staff' })
  f.membership2 = await Membership.create({ organizationId: f.organization._id, userId: f.staff2._id, invitedEmail: f.staff2.email, role: 'staff', permissions: ['manage_rfq'], status: 'active', invitedBy: f.supplier._id })
  f.tokens.staff2 = generateToken(f.staff2)
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })
test.each([null, 'short', 'a'.repeat(129), 'bad key with spaces'])('mandatory offer key %p is rejected without a reservation', async attempt => {
  const id = await create(), call = request(app).post('/api/sourcing/' + id + '/quote').set(auth('supplier'))
  if (attempt) call.set('Idempotency-Key', attempt)
  expect((await call.send(input)).status).toBe(400)
  expect((await raw(id)).operation).toBeUndefined(); expect((await raw(id)).quotes).toHaveLength(0)
  expect(await notices(id)).toHaveLength(0)
})
test('normal submission freezes commercial inputs and emits exactly one notification', async () => {
  const id = await create(), attempt = key(), first = await send(id, attempt)
  expect(first.body).toMatchObject({ processing: false }); expect(first.status).toBe(200)
  expect(first.body.quote.commercialSnapshot).toMatchObject({ request: { quantity: 100, unit: 'زوج', notes: 'المواصفات الأصلية' }, offer: { unitPrice: 12, totalPrice: 1200, currency: 'MAD' } })
  const replay = await send(id, attempt, { ...input, unitPrice: '12', supplierId: f.otherSupplier.id, actorId: f.staff.id })
  expect(replay.status).toBe(200); expect(replay.body.quote._id).toBe(first.body.quote._id)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test.each(['claim', 'notification', 'publication'])('failure BEFORE %s is recoverable with the original key', async stage => {
  const id = await create(), attempt = key()
  const target = stage === 'notification' ? N : S.collection
  const predicate = stage === 'claim' ? (q, u) => Boolean(u.$set?.operation) : stage === 'publication' ? (q, u) => Boolean(u.$unset?.operation) : () => true
  const spy = fault(target, 'updateOne', predicate)
  const first = await send(id, attempt)
  expect(first.status).toBe(stage === 'claim' ? 503 : 202)
  expect((await raw(id)).quotes).toHaveLength(0)
  if (stage !== 'claim') expect((await raw(id)).operation.kind).toBe('sourcing_offer')
  spy.mockRestore()
  expect((await send(id, attempt)).status).toBe(200)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test.each(['claim', 'notification', 'publication'])('lost acknowledgement AFTER %s is read back rather than duplicated', async stage => {
  const id = await create(), attempt = key(), target = stage === 'notification' ? N : S.collection
  const predicate = stage === 'claim' ? (q, u) => Boolean(u.$set?.operation) : stage === 'publication' ? (q, u) => Boolean(u.$unset?.operation) : () => true
  fault(target, 'updateOne', predicate, true, true)
  const first = await send(id, attempt)
  expect(first.status).toBe(200)
  expect((await send(id, attempt)).body.quote._id).toBe(first.body.quote._id)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test('HTTP acknowledgement loss replays without another effect', async () => {
  const id = await create(), attempt = key(), wrapper = express()
  wrapper.use((req, res, next) => { const json = res.json; res.json = function (data) { if (req.path.endsWith('/quote') && this.statusCode === 200) { this.destroy(); return this } return json.call(this, data) }; next() }); wrapper.use(app)
  await expect(send(id, attempt, input, 'supplier', wrapper)).rejects.toThrow()
  expect((await send(id, attempt)).status).toBe(200)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test('eight concurrent requests with one key create one quote and notification', async () => {
  const id = await create(), attempt = key(), results = await Promise.all(Array.from({ length: 8 }, () => send(id, attempt)))
  expect(results.every(r => r.status === 200)).toBe(true)
  expect(new Set(results.map(r => r.body.quote._id)).size).toBe(1)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test('different content with one key is a distinct 409 conflict', async () => {
  const id = await create(), attempt = key(), results = await Promise.all([send(id, attempt), send(id, attempt, { ...input, unitPrice: 13 })])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  expect(results.find(r => r.status === 409).body.code).toBe('SOURCING_OFFER_KEY_CONFLICT')
})
test('same key for two supplier owners is independent and never supersedes a competitor', async () => {
  const id = await create(), attempt = key(), first = await send(id, attempt)
  const second = await send(id, attempt, { ...input, unitPrice: 15 }, 'otherSupplier')
  expect(second.status).toBe(200); expect(second.body.quote._id).not.toBe(first.body.quote._id)
  const stored = await raw(id); expect(stored.quotes.map(q => q.status)).toEqual(['active', 'active']); expect(stored.quotesCount).toBe(2)
})
test('two competing suppliers can retry a lost CAS without erasing each other', async () => {
  const id = await create(), attempts = [key(), key()]
  const results = await Promise.all([send(id, attempts[0]), send(id, attempts[1], { ...input, unitPrice: 19 }, 'otherSupplier')])
  for (let index = 0; index < 2; index++) {
    expect([200, 409]).toContain(results[index].status)
    if (results[index].status === 409) expect((await send(id, attempts[index], index ? { ...input, unitPrice: 19 } : input, index ? 'otherSupplier' : 'supplier')).status).toBe(200)
  }
  const stored = await raw(id); expect(stored.quotes).toHaveLength(2); expect(stored.quotesCount).toBe(2)
  expect(stored.quotes.every(q => q.status === 'active')).toBe(true); expect(await notices(id)).toHaveLength(2)
})
test('two staff of one owner share the receipt and preserve the first authenticated actor', async () => {
  const id = await create(), attempt = key(), results = await Promise.all([send(id, attempt, input, 'staff'), send(id, attempt, input, 'staff2')])
  expect(results.every(r => r.status === 200)).toBe(true)
  const stored = await raw(id); expect(stored.quotes).toHaveLength(1)
  expect([f.staff.id, f.staff2.id]).toContain(String(stored.quotes[0].actorId))
  expect(stored.quotes[0].commercialSnapshot.offer.actorId).toEqual(stored.quotes[0].actorId)
  expect(await notices(id)).toHaveLength(1)
})
test('pending replacement leaves the previous offer and all competitor data intact, and blocks both decisions', async () => {
  const id = await create(), first = await send(id), competitor = await send(id, key(), { ...input, unitPrice: 19 }, 'otherSupplier')
  const before = await raw(id), attempt = key(), spy = fault(S.collection, 'updateOne', (q, u) => Boolean(u.$unset?.operation))
  const pending = await send(id, attempt, { ...input, unitPrice: 11 })
  expect(pending.status).toBe(202); const stored = await raw(id)
  expect(stored.quotes).toEqual(before.quotes); expect(stored.quotesCount).toBe(before.quotesCount)
  for (const action of ['accept', 'reject']) {
    const result = await decide(id, first.body.quote._id, action)
    expect(result.status).toBe(409); expect(result.body.code).toBe('SOURCING_OPERATION_PENDING')
  }
  const other = await send(id, key(), input, 'otherSupplier')
  expect(other.status).toBe(409); expect(other.body.code).toBe('SOURCING_OPERATION_PENDING')
  expect((await read(id)).body.operation).toEqual({ kind: 'sourcing_offer', phase: 'pending' })
  spy.mockRestore(); expect((await send(id, attempt, { ...input, unitPrice: 11 })).status).toBe(200)
  const completed = await raw(id)
  expect(completed.operation).toBeUndefined(); expect(completed.quotesCount).toBe(2)
  expect(completed.quotes.find(q => String(q._id) === first.body.quote._id).status).toBe('superseded')
  expect(completed.quotes.find(q => String(q._id) === competitor.body.quote._id)).toEqual(before.quotes[1])
})
test('readAt survives notification retries; completed retries perform no writes', async () => {
  const id = await create(), attempt = key(), spy = fault(S.collection, 'updateOne', (q, u) => Boolean(u.$unset?.operation))
  expect((await send(id, attempt)).status).toBe(202)
  const notice = (await notices(id))[0]
  expect((await request(app).put('/api/notifications/' + notice._id + '/read').set(auth('buyer'))).status).toBe(200)
  const readAt = (await N.findById(notice._id)).readAt
  spy.mockRestore(); expect((await send(id, attempt)).status).toBe(200)
  const nSpy = jest.spyOn(N, 'updateOne'), sSpy = jest.spyOn(S, 'updateOne')
  expect((await send(id, attempt)).status).toBe(200)
  expect(nSpy).not.toHaveBeenCalled(); expect(sSpy).not.toHaveBeenCalled()
  expect((await N.findById(notice._id)).readAt).toEqual(readAt); expect(await notices(id)).toHaveLength(1)
})
test('old receipts replay superseded and accepted quotes before closed-state rejection', async () => {
  const id = await create(), oldKey = key(), first = await send(id, oldKey), newKey = key(), second = await send(id, newKey, { ...input, unitPrice: 10 })
  expect((await send(id, oldKey)).body.quote.status).toBe('superseded')
  expect((await decide(id, second.body.quote._id)).status).toBe(200)
  const before = await raw(id)
  expect((await send(id, newKey, { ...input, unitPrice: 10 })).body.quote.status).toBe('accepted')
  expect((await send(id, oldKey)).body.quote._id).toBe(first.body.quote._id)
  expect((await send(id, key())).status).toBe(409)
  expect(await raw(id)).toEqual(before); expect(await notices(id)).toHaveLength(2)
})
test('replaying an older completed receipt does not resume or modify a newer pending operation', async () => {
  const id = await create(), oldKey = key(); await send(id, oldKey)
  const blocker = fault(N, 'updateOne', () => true); expect((await send(id, key(), { ...input, unitPrice: 11 })).status).toBe(202)
  const before = await raw(id), writes = jest.spyOn(S.collection, 'updateOne')
  expect((await send(id, oldKey)).status).toBe(200); expect(writes).not.toHaveBeenCalled()
  expect(await raw(id)).toEqual(before); blocker.mockRestore()
  expect((await retry(id, before.operation.id)).status).toBe(200)
})
test('same key across separate requests is independent, including uppercase Mongo identifiers', async () => {
  const a = await create(), b = await create(), attempt = key()
  expect((await send(a.toUpperCase(), attempt)).status).toBe(200)
  expect((await send(a, attempt)).status).toBe(200)
  expect((await send(b, attempt)).status).toBe(200)
  expect((await raw(a)).quotes).toHaveLength(1); expect((await raw(b)).quotes).toHaveLength(1)
})
test('commercial snapshot is independent of later request changes', async () => {
  const id = await create(), attempt = key(), first = await send(id, attempt)
  await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { productName: 'اسم تغير لاحقاً', quantity: 999, unit: 'صندوق' } })
  const replay = await send(id, attempt)
  expect(replay.body.quote.commercialSnapshot).toEqual(first.body.quote.commercialSnapshot)
  expect(replay.body.quote.commercialSnapshot.offer.totalPrice).toBe(1200)
})
test('publication preserves unknown historical quote fields instead of recasting them away', async () => {
  const id = await create(), first = await send(id)
  await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { 'quotes.0.historicalExtra': { contractCode: 'synthetic-legacy-field', values: [1, 2] } } })
  const before = (await raw(id)).quotes[0]
  expect((await send(id, key(), { ...input, unitPrice: 11 })).status).toBe(200)
  expect((await raw(id)).quotes[0]).toEqual({ ...before, status: 'superseded' })
  expect((await read(id, 'supplier')).text).not.toContain('historicalExtra')
  expect(first.status).toBe(200)
})
test('DTOs hide receipts/journal/fingerprints/competitor inputs and enforce recovery ownership', async () => {
  const id = await create(), competitor = await send(id, key(), { ...input, notes: 'competitor-secret' }, 'otherSupplier')
  const attempt = key(), spy = fault(N, 'updateOne', () => true)
  const pending = await send(id, attempt, { ...input, notes: 'owner-pending-secret' }, 'staff')
  expect(pending.status).toBe(202); const stored = await raw(id), op = stored.operation
  const buyer = await read(id), owner = await read(id, 'supplier'), staff = await read(id, 'staff2'), other = await read(id, 'otherSupplier')
  expect(owner.body.offerRecovery.input.notes).toBe('owner-pending-secret'); expect(staff.body.offerRecovery).toEqual(owner.body.offerRecovery)
  expect(buyer.body.offerRecovery).toBeUndefined(); expect(other.body.offerRecovery).toBeUndefined()
  expect(other.text).not.toContain('owner-pending-secret'); expect(owner.text).not.toContain('competitor-secret')
  expect(owner.body.quotes.some(q => q._id === competitor.body.quote._id)).toBe(false)
  for (const response of [pending, buyer, owner, staff, other, await request(app).get('/api/sourcing').set(auth('supplier')), await request(app).get('/api/sourcing/buyer').set(auth('buyer'))]) {
    for (const secret of [attempt, op.hash, op.baselineHash, 'submission', 'creationReceipt', 'notificationId', 'expectedVersion']) expect(response.text).not.toContain(secret)
  }
  expect((await retry(id, op.id, 'otherSupplier')).status).toBe(403)
  expect((await retry(id, op.id, 'buyer')).status).toBe(403)
  expect((await read(id, 'otherBuyer')).status).toBe(403)
  spy.mockRestore(); expect((await retry(id, op.id, 'staff2')).status).toBe(200)
  expect(String((await raw(id)).quotes.at(-1).actorId)).toBe(f.staff.id)
})
test('revoked staff cannot read or resume; background recovery does not override revocation', async () => {
  const id = await create(), spy = fault(N, 'updateOne', () => true)
  expect((await send(id, key(), input, 'staff')).status).toBe(202)
  const op = (await raw(id)).operation; spy.mockRestore()
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: [] } })
  try {
    expect((await read(id, 'staff')).status).toBe(403)
    expect((await retry(id, op.id, 'staff')).status).toBe(403)
    const result = await service.resume(id, op.id)
    expect(result.processing).toBe(true); expect((await raw(id)).quotes).toHaveLength(0)
  } finally { await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: ['manage_rfq'] } }) }
  expect((await retry(id, op.id, 'supplier')).status).toBe(200)
})
test('changed staff organization ownership cannot be bypassed by the recovery worker', async () => {
  const id = await create(), blocker = fault(N, 'updateOne', () => true)
  await send(id, key(), input, 'staff'); const op = (await raw(id)).operation; blocker.mockRestore()
  const Organization = require('../models/Organization')
  await Organization.updateOne({ _id: f.organization._id }, { $set: { ownerSupplierId: f.otherSupplier._id } })
  try { expect((await service.resume(id, op.id)).processing).toBe(true); expect((await raw(id)).quotes).toHaveLength(0) }
  finally { await Organization.updateOne({ _id: f.organization._id }, { $set: { ownerSupplierId: f.supplier._id } }) }
  expect((await retry(id, op.id)).status).toBe(200)
})
test('capacity preflight includes unknown/hidden stored data and never deletes history', async () => {
  const id = await create(); await send(id)
  await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { legacyPadding: 'x'.repeat(service.MAX_BSON - 100 * 1024) } })
  const before = await raw(id), result = await send(id)
  expect(result.status).toBe(413); expect(result.body.code).toBe('SOURCING_DOCUMENT_CAPACITY')
  expect((await raw(id)).operation).toBeUndefined(); expect((await raw(id)).quotes).toEqual(before.quotes)
  expect((await read(id)).text).not.toContain('legacyPadding'); expect(await notices(id)).toHaveLength(1)
})
test('a large document with headroom can reserve and publish within the BSON limit', async () => {
  const id = await create()
  await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { legacyPadding: 'x'.repeat(service.MAX_BSON - 1024 * 1024) } })
  expect((await send(id)).status).toBe(200)
  expect(mongoose.mongo.BSON.calculateObjectSize(await raw(id))).toBeLessThan(service.MAX_BSON - service.HEADROOM)
})
test('recovery uses bounded batches/backoff and cleanly stops scheduling', async () => {
  const ids = [await create(), await create(), await create()], spy = fault(N, 'updateOne', () => true)
  for (const id of ids) expect((await send(id)).status).toBe(202)
  expect((await recover({ limit: 1 })).processed).toBe(0)
  spy.mockRestore()
  const result = await recover({ limit: 1, now: new Date(Date.now() + 600000) })
  expect(result.processed).toBe(1); expect(result.completed).toBe(1)
  const runner = createSourcingRecovery()
  expect(await runner.stop()).toEqual({ drained: true }); expect((await runner.runOnce()).processed).toBe(0)
  for (const id of ids) { const s = await raw(id); if (s.operation) expect((await retry(id, s.operation.id)).status).toBe(200) }
})
test.each(['userId', 'type', 'resourceId', 'resourceType', 'createdAt'])('a conflicting notification %s keeps the operation pending instead of forcing publication', async field => {
  const id = await create(), spy = fault(S.collection, 'updateOne', (q, u) => Boolean(u.$unset?.operation))
  expect((await send(id)).status).toBe(202); const op = (await raw(id)).operation; spy.mockRestore()
  const notice = await N.findById(op.notificationId).lean()
  const wrong = { userId: f.otherBuyer._id, type: 'rfq_created', resourceId: f.product._id, resourceType: 'rfq', createdAt: new Date(0) }[field]
  await N.collection.updateOne({ _id: op.notificationId }, { $set: { [field]: wrong } })
  const result = await retry(id, op.id)
  expect(result.status).toBe(202); expect(result.body.code).toBe('SOURCING_OFFER_CONFLICT')
  expect((await raw(id)).quotes).toHaveLength(0)
  await N.collection.updateOne({ _id: op.notificationId }, { $set: { [field]: notice[field] } })
  expect((await retry(id, op.id)).status).toBe(200); expect(await notices(id)).toHaveLength(1)
})
test.each(['buyerId', 'price', 'supplierId'])('changed %s during pending is held for review, never overwritten', async field => {
  const id = await create(), spy = fault(N, 'updateOne', () => true)
  await send(id); const original = await raw(id), op = original.operation; spy.mockRestore()
  const name = field === 'price' ? 'operation.input.unitPrice' : field === 'supplierId' ? 'operation.supplierId' : 'buyerId'
  const wrong = field === 'price' ? 500 : field === 'supplierId' ? f.otherSupplier._id : f.otherBuyer._id
  await S.collection.updateOne({ _id: original._id }, { $set: { [name]: wrong } })
  const outcome = await service.resume(id, op.id)
  expect(outcome.processing).toBe(true); expect((await raw(id)).quotes).toHaveLength(0)
  if (field !== 'price') {
    expect((await read(id, 'supplier')).body.offerRecovery).toBeUndefined()
    expect((await read(id, 'otherSupplier')).body.offerRecovery).toBeUndefined()
  }
  await S.collection.updateOne({ _id: original._id }, { $set: { [name]: field === 'price' ? op.input.unitPrice : field === 'supplierId' ? op.supplierId : original.buyerId } })
  expect((await retry(id, op.id)).status).toBe(200)
})
test('read outage after final publication does not create another quote on retry', async () => {
  const id = await create(), attempt = key(), update = S.collection.updateOne.bind(S.collection), find = S.findById.bind(S); let published = false
  jest.spyOn(S.collection, 'updateOne').mockImplementation(async (...args) => { const r = await update(...args); if (args[1].$unset?.operation) published = true; return r })
  const reader = jest.spyOn(S, 'findById').mockImplementation((...args) => { if (published) throw new Error('Synthetic final read outage'); return find(...args) })
  expect((await send(id, attempt)).status).toBe(503); reader.mockRestore()
  expect((await send(id, attempt)).status).toBe(200)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test('a decision that wins the version race prevents reserving a replacement', async () => {
  const id = await create(), first = await send(id), update = S.updateOne.bind(S)
  let release, entered; const waiting = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  jest.spyOn(S, 'updateOne').mockImplementation(async (...args) => { if (args[1].$set?.operation?.kind === 'sourcing_offer') { entered(); await gate } return update(...args) })
  const replacing = send(id, key(), { ...input, unitPrice: 10 }).then(r => r); await waiting
  expect((await decide(id, first.body.quote._id)).status).toBe(200); release()
  expect((await replacing).status).toBe(409)
  const s = await raw(id); expect(s.status).toBe('fulfilled'); expect(s.quotes).toHaveLength(1); expect(s.quotes[0].status).toBe('accepted')
})
test('a reservation that wins the race fences out a stale buyer decision CAS', async () => {
  const id = await create(), first = await send(id), update = S.updateOne.bind(S)
  let release, entered; const waiting = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  jest.spyOn(S, 'updateOne').mockImplementation(async (...args) => { if (args[1].$set?.operation?.kind === 'sourcing_decision') { entered(); await gate } return update(...args) })
  const choosing = decide(id, first.body.quote._id).then(r => r); await waiting
  const faulting = fault(N, 'updateOne', () => true)
  expect((await send(id, key(), { ...input, unitPrice: 10 })).status).toBe(202)
  release(); const choice = await choosing
  expect(choice.status).toBe(409); expect(choice.body.code).toBe('SOURCING_OPERATION_PENDING')
  faulting.mockRestore(); const op = (await raw(id)).operation
  expect((await retry(id, op.id)).status).toBe(200)
  expect((await raw(id)).status).toBe('open')
})
test('bounded shutdown leaves a durable intent when an effect is still in flight', async () => {
  const id = await create(), blocker = fault(N, 'updateOne', () => true)
  await send(id); blocker.mockRestore(); await S.updateOne({ _id: id }, { $set: { 'operation.nextAttemptAt': new Date(0) } })
  const update = N.updateOne.bind(N); let release, entered
  const waiting = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  jest.spyOn(N, 'updateOne').mockImplementationOnce(async (...args) => { entered(); await gate; return update(...args) })
  const runner = createSourcingRecovery(), working = runner.runOnce(); await waiting
  expect(await runner.stop({ graceMs: 10 })).toEqual({ drained: false })
  expect((await raw(id)).operation).toBeDefined(); release(); expect((await working).completed).toBe(1)
  expect((await runner.runOnce()).processed).toBe(0)
})
test('shutdown drains even when the in-flight database scan fails', async () => {
  jest.spyOn(S, 'find').mockImplementationOnce(() => { throw new Error('Synthetic scan outage') })
  const runner = createSourcingRecovery(), running = runner.runOnce(), stopping = runner.stop()
  await expect(running).rejects.toThrow('Synthetic scan outage')
  expect(await stopping).toEqual({ drained: true })
})

// Real independent Node processes. No project .env is copied into the test
// workspace; the URI is explicit, temporary and checked inside each child.
const childSource = `const p=require('path'),m=require(p.join(process.env.S2_BACKEND,'node_modules/mongoose'));const address=new URL(process.env.S2_URI);if(address.protocol!=='mongodb:'||address.hostname!=='127.0.0.1'||!address.port||['27017','27018'].includes(address.port))throw Error('Unsafe test URI');process.env.MONGODB_URI=process.env.S2_URI;process.on('message',message=>{if(message==='shutdown')process.emit('SIGTERM')});(async()=>{if(['api','worker'].includes(process.env.S2_MODE)){require(p.join(process.env.S2_BACKEND,process.env.S2_MODE==='api'?'start.js':'workers/worker.js'))[process.env.S2_MODE==='worker'?'main':'unused']?.();return}await m.connect(process.env.S2_URI,{autoIndex:false});const S=require(p.join(process.env.S2_BACKEND,'models/SourcingRequest')),service=require(p.join(process.env.S2_BACKEND,'services/sourcingOfferSubmission'));if(process.env.S2_MODE==='crash'){const target=process.env.S2_STAGE==='notification'?require(p.join(process.env.S2_BACKEND,'models/Notification')):process.env.S2_STAGE==='publication'?S.collection:S;const update=target.updateOne.bind(target);target.updateOne=async(...args)=>{const result=await update(...args);if(process.env.S2_STAGE==='notification'||(process.env.S2_STAGE==='publication'?args[1].$unset?.operation:args[1].$set?.operation))process.exit(0);return result};await service.submit({params:{id:process.env.S2_PARENT},get:()=>process.env.S2_KEY,body:JSON.parse(process.env.S2_INPUT),supplier:JSON.parse(process.env.S2_ACTOR)})}else if(process.env.S2_MODE==='replay'){const result=await service.submit({params:{id:process.env.S2_PARENT},get:()=>process.env.S2_KEY,body:JSON.parse(process.env.S2_INPUT),supplier:JSON.parse(process.env.S2_ACTOR)});if(result.processing)throw Error('Incomplete replay');await m.disconnect();process.exit(0)}else{const s=await service.load(process.env.S2_PARENT),op=s.operation?.id;if(!op)throw Error('Missing pending operation');process.send('ready');await new Promise(resolve=>process.once('message',resolve));const r=await service.resume(s._id,op);if(r.processing)throw Error('Still pending');await m.disconnect();process.exit(0)}})().catch(()=>process.exit(1))`
function child(mode, id, attempt = key(), port = 0, stage = 'claim') {
  const cp = require('child_process'), path = require('path'), fs = require('fs')
  const actor = { id: f.supplier.id, ownerId: f.supplier.id, role: 'supplier', name: f.supplier.name, permissions: ['all'] }
  const env = { ...process.env, S2_BACKEND: path.resolve(__dirname, '..'), S2_URI: mongo.getUri(), S2_MODE: mode, S2_PARENT: id,
    S2_KEY: attempt, S2_STAGE: stage, S2_INPUT: JSON.stringify(input), S2_ACTOR: JSON.stringify(actor), JOB_WORKER_MODE: 'external', PORT: String(port), DISABLE_REDIS: '1' }
  const log = fs.openSync(path.join(process.env.R41_OUTPUT, 'results', 'node-' + mode + '-' + crypto.randomUUID() + '.log'), 'wx')
  const processChild = cp.spawn(process.execPath, ['-e', childSource], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', log, log, 'ipc'] })
  const exited = new Promise(resolve => processChild.once('exit', code => { fs.closeSync(log); resolve(code) }))
  return { process: processChild, exited }
}
async function waitFor(predicate, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw Error('Isolated recovery did not finish before deadline')
}
test('Node exit after reservation survives restart and two independent completers publish once', async () => {
  const id = await create(), attempt = key(), writer = child('crash', id, attempt)
  expect(await writer.exited).toBe(0); expect((await raw(id)).operation).toBeDefined(); expect((await raw(id)).quotes).toHaveLength(0)
  const one = child('barrier', id), two = child('barrier', id)
  await Promise.all([one, two].map(c => new Promise(resolve => c.process.once('message', resolve))))
  one.process.send('go'); two.process.send('go')
  expect(await one.exited).toBe(0); expect(await two.exited).toBe(0)
  expect((await send(id, attempt)).status).toBe(200)
  expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1)
})
test.each(['notification', 'publication'])('a real Node exit immediately after %s is recovered without another effect', async stage => {
  const id = await create(), attempt = key(), writer = child('crash', id, attempt, 0, stage)
  expect(await writer.exited).toBe(0)
  expect((await raw(id)).quotes).toHaveLength(stage === 'publication' ? 1 : 0)
  const notice = (await notices(id))[0], readAt = new Date()
  await N.updateOne({ _id: notice._id }, { $set: { readAt } })
  const replay = child('replay', id, attempt)
  expect(await replay.exited).toBe(0)
  expect((await raw(id)).operation).toBeUndefined(); expect((await raw(id)).quotes).toHaveLength(1)
  expect(await notices(id)).toHaveLength(1); expect((await N.findById(notice._id)).readAt).toEqual(readAt)
})
test.each(['api', 'worker'])('the real %s entry point resumes a persisted operation and shuts down safely', async mode => {
  const id = await create(), blocker = fault(N, 'updateOne', () => true)
  expect((await send(id)).status).toBe(202); blocker.mockRestore()
  await S.updateOne({ _id: id }, { $set: { 'operation.nextAttemptAt': new Date(0) } })
  const port = await new Promise(resolve => { const server = require('net').createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) }) })
  const running = child(mode, id, key(), port)
  try { await waitFor(async () => !(await raw(id)).operation); expect((await raw(id)).quotes).toHaveLength(1); expect(await notices(id)).toHaveLength(1) }
  finally {
    if (running.process.connected) running.process.send('shutdown')
    let timer
    const result = await Promise.race([running.exited, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 20000) })]); clearTimeout(timer)
    if (result === 'timeout') running.process.kill()
    expect(result).toBe(0)
  }
})
