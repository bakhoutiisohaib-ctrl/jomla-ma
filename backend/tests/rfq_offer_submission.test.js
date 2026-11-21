jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs'), os = require('os'), path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-r3-tests-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'r3-synthetic-secret-never-original-accounts', UPLOADS_DIR: path.join(root, 'uploads'),
  LOG_DIR: path.join(root, 'logs'), MONGODB_URI: 'mongodb://127.0.0.1:1/original-disabled', DISABLE_REDIS: '1',
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const mongoose = require('mongoose'), request = require('supertest'), { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), fixtures = require('./helpers/tradeFixtures')
const R = require('../models/QuoteRequest'), O = require('../models/QuoteOffer'), T = require('../models/MessageThread'), N = require('../models/Notification')
const Product = require('../models/Product'), Membership = require('../models/Membership'), Supplier = require('../models/Supplier')
const { recoverPendingOffers, createOfferRecovery } = require('../services/rfqOfferSubmission')
jest.setTimeout(120000)
let mongo, f, id, serial = 0, writes = []
const key = () => 'r3-offer-attempt-' + (++serial).toString().padStart(12, '0')
const auth = (who = 'supplier') => ({ Authorization: 'Bearer ' + f.tokens[who] })
const payload = (extra = {}) => ({ unitPrice: 99, deliveryDays: 4, paymentTerms: 'شروط R3 الأصلية', notes: 'عرض اصطناعي', ...extra })
const send = (identity, body = payload(), who = 'supplier') => { const call = request(app).put('/api/rfq/' + id + '/respond').set(auth(who)); if (identity !== undefined) call.set('Idempotency-Key', identity); return call.send(body) }
const retry = (who = 'supplier') => request(app).post('/api/rfq/' + id + '/offers/retry').set(auth(who)).send({})
const decide = offerId => request(app).put('/api/rfq/' + id + '/action').set(auth('buyer')).send({ action: 'accept', offerId })
const load = () => R.findById(id).select('+offerSubmission')
const fail = () => Error('R3 synthetic write acknowledgement failure')
function fault(model, method, predicate, after = false, always = false) {
  const original = model[method].bind(model)
  let used = false
  return jest.spyOn(model, method).mockImplementation((...args) => {
    if (predicate(...args) && (always || !used)) {
      used = true
      const promise = (async () => { if (after) await original(...args); throw fail() })()
      promise.select = () => promise
      return promise
    }
    return original(...args)
  })
}
async function unique(offerId) {
  expect(await O.countDocuments({ rfqId: id })).toBe(1)
  const t = await T.findOne({ rfqId: id }); expect(t.messages.filter(m => String(m._id) === String(offerId))).toHaveLength(1)
  expect(await N.countDocuments({ resourceId: id, type: 'offer_received' })).toBe(1)
  const r = await load(); expect(String(r.currentOfferId)).toBe(String(offerId)); expect(r.status).toBe('responded'); expect(r.offerSubmission.phase).toBe('completed')
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger', dbName: 'r3_tests' } })
  await mongoose.connect(mongo.getUri('r3_tests'), { monitorCommands: true })
  expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toBeUndefined()
  mongoose.connection.getClient().on('commandStarted', e => { if (e.commandName === 'update' && e.command.writeConcern) writes.push({ collection: e.command.update, writeConcern: e.command.writeConcern }) })
  f = await fixtures(); await Promise.all([R.init(), O.init(), T.init(), N.init()])
})
beforeEach(async () => {
  jest.restoreAllMocks()
  await Promise.all([R.deleteMany({}), O.deleteMany({}), T.deleteMany({}), N.deleteMany({}),
    Membership.updateOne({ _id: f.membership._id }, { $set: { status: 'active', permissions: ['manage_rfq'] } }),
    Supplier.updateOne({ _id: f.supplier._id }, { $set: { isActive: true } }),
    Product.updateOne({ _id: f.product._id }, { $set: { name: f.product.name, unit: 'زوج', isDraft: false } })])
  const created = await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key', key()).send({ productId: String(f.product._id), quantity: 20, buyerPhone: '+212600000001' })
  expect(created.status).toBe(201); id = created.body.rfq._id
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => {
  fs.mkdirSync(path.resolve(__dirname, '../../reports/phase-r3-evidence'), { recursive: true })
  fs.writeFileSync(path.resolve(__dirname, '../../reports/phase-r3-evidence/mongo-write-concern.json'), JSON.stringify({ standalone: true, writes }, null, 2))
  await mongoose.disconnect(); if (mongo) await mongo.stop({ doCleanup: false })
})
test('identical and twelve concurrent retries have one offer, message, notification, frozen terms', async () => {
  const identity = key(), results = await Promise.all(Array.from({ length: 12 }, () => send(identity)))
  expect(results.map(r => r.status)).toEqual(Array(12).fill(200))
  const offer = results[0].body.offer
  expect(new Set(results.map(r => r.body.offer._id)).size).toBe(1)
  expect(offer).toMatchObject({ unitPrice: 99, totalPrice: 1980, quantity: 20, currency: 'MAD', deliveryDays: 4, paymentTerms: payload().paymentTerms, productSnapshot: { name: f.product.name, unit: 'زوج' } })
  await unique(offer._id)
  const original = await O.findById(offer._id).lean()
  expect(JSON.stringify(results.map(result => result.body))).not.toContain(identity)
  await N.updateOne({ _id: offer._id }, { $set: { readAt: new Date() } })
  expect((await send(identity)).body.submission.replayed).toBe(true)
  expect((await N.findById(offer._id)).readAt).toBeTruthy(); expect(await O.findById(offer._id).lean()).toEqual(original)
})
test.each(['price', 'quantity', 'terms', 'expiry', 'currency'])('rejects changed %s under same key without affecting original', async field => {
  const identity = key(); expect((await send(identity)).status).toBe(200)
  const changed = { price: { unitPrice: 1 }, quantity: { quantity: 21 }, terms: { paymentTerms: 'different' }, expiry: { validUntil: new Date(Date.now() + 600000).toISOString() }, currency: { currency: 'EUR' } }[field]
  expect([400, 409]).toContain((await send(identity, payload(changed))).status); expect(await O.countDocuments({ rfqId: id })).toBe(1)
})
test('same-key different payload race conflicts; distinct concurrent offers serialize through RFQ revision', async () => {
  const identity = key(), results = await Promise.all([send(identity), send(identity, payload({ unitPrice: 88 }))])
  expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect(await O.countDocuments({ rfqId: id })).toBe(1)
  const next = await Promise.all([send(key(), payload({ unitPrice: 80 })), send(key(), payload({ unitPrice: 75 }))])
  expect(next.every(r => [200, 409].includes(r.status))).toBe(true)
  const r = await load(), active = await O.find({ rfqId: id, status: 'active' })
  expect(active).toHaveLength(1); expect(String(active[0]._id)).toBe(String(r.currentOfferId))
})
test.each([false, true])('RFQ reservation failure afterWrite=%s recovers same identity', async after => {
  const identity = key(), spy = fault(R, 'findOneAndUpdate', (_f, u) => u.$set?.status === 'offering', after)
  const first = await send(identity); spy.mockRestore()
  expect(first.status).toBe(after ? 200 : 500)
  const resumed = await send(identity); expect(resumed.status).toBe(200); await unique(resumed.body.offer._id)
})
test.each([false, true])('offer insert failure afterWrite=%s leaves a recoverable intent, never an acceptable offer', async after => {
  const identity = key(), spy = fault(O, 'updateOne', (_f, u) => Boolean(u.$setOnInsert), after)
  expect((await send(identity)).status).toBe(202); expect((await load()).status).toBe('offering')
  const o = await O.findOne({ rfqId: id }); if (o) expect((await decide(String(o._id))).status).toBe(409)
  spy.mockRestore(); const done = await send(identity); expect(done.status).toBe(200); await unique(done.body.offer._id)
})
test.each([['message', false], ['message', true], ['notification', false], ['notification', true], ['commit', false], ['commit', true], ['publish', false], ['publish', true]])('%s persistence afterWrite=%s can resume without duplicate effects', async (stage, after) => {
  const identity = key()
  const model = stage === 'message' ? T : stage === 'notification' ? N : R
  const predicate = (_f, u) => stage === 'message' ? Boolean(u.$push?.messages) : stage === 'notification' ? u.$setOnInsert?.type === 'offer_received' : stage === 'commit' ? u.$set?.['offerSubmission.phase'] === 'committing' : u.$set?.['offerSubmission.phase'] === 'completed'
  const spy = fault(model, 'updateOne', predicate, after)
  const first = await send(identity)
  expect(first.status).toBe(stage === 'publish' && after ? 200 : 202)
  if (first.status === 202) expect((await load()).status).toBe('offering')
  spy.mockRestore(); const done = await retry(); expect(done.status).toBe(200); await unique(done.body.offer._id)
})
test('replacement failure preserves old offer and pointer; buyer is fenced until all effects and retirement finish', async () => {
  const previous = (await send(key(), payload({ unitPrice: 105 }))).body.offer
  const identity = key(), spy = fault(T, 'updateOne', (_f, u) => Boolean(u.$push?.messages), false, true)
  expect((await send(identity)).status).toBe(202)
  let r = await load(); expect(String(r.currentOfferId)).toBe(previous._id); expect(r.offer.unitPrice).toBe(105); expect((await O.findById(previous._id)).status).toBe('active')
  expect((await decide(previous._id)).status).toBe(409)
  expect((await send(key(), payload({ unitPrice: 77 }))).status).toBe(409)
  spy.mockRestore()
  const retire = fault(O, 'updateOne', (_f, u) => u.$set?.status === 'superseded', false, true)
  expect((await retry()).status).toBe(202)
  r = await load(); expect(String(r.currentOfferId)).toBe(previous._id); expect(r.status).toBe('offering')
  expect((await decide(String(r.offerSubmission.offerId))).status).toBe(409)
  const view = await request(app).get('/api/rfq/' + id + '/thread').set(auth('buyer'))
  expect(view.body.offers.find(o => o._id === String(r.offerSubmission.offerId)).status).toBe('preparing')
  retire.mockRestore(); const done = await retry(); expect(done.status).toBe(200)
  expect((await O.findById(previous._id)).status).toBe('superseded'); expect((await decide(previous._id)).status).toBe(409)
  expect((await decide(done.body.offer._id)).status).toBe(200)
})
test('expiry before commitment preserves previous pointer and active offer, with one expired attempt receipt', async () => {
  const previous = (await send(key(), payload({ unitPrice: 105 }))).body.offer
  const identity = key(), until = new Date(Date.now() + 1200).toISOString()
  const spy = fault(T, 'updateOne', (_f, u) => Boolean(u.$push?.messages), false, true)
  expect((await send(identity, payload({ validUntil: until }))).status).toBe(202); spy.mockRestore()
  await new Promise(resolve => setTimeout(resolve, 1250))
  const done = await retry(); expect(done.status).toBe(200); expect(done.body.submission.phase).toBe('expired')
  expect(done.body.rfq.currentOfferId).toBe(previous._id); expect(done.body.rfq.status).toBe('responded')
  expect((await O.findById(previous._id)).status).toBe('active'); expect(done.body.offer.status).toBe('expired')
  expect((await decide(done.body.offer._id)).status).toBe(409)
  const count = await N.countDocuments({ resourceId: id }), replay = await send(identity, payload({ validUntil: until }))
  expect(replay.body.offer._id).toBe(done.body.offer._id); expect(await N.countDocuments({ resourceId: id })).toBe(count)
  expect((await decide(previous._id)).status).toBe(200)
})
test('expiry after the durable commitment never makes an expired replacement acceptable', async () => {
  const identity = key(), until = new Date(Date.now() + 1000).toISOString()
  const spy = fault(R, 'updateOne', (_f, u) => u.$set?.['offerSubmission.phase'] === 'completed', false, true)
  expect((await send(identity, payload({ validUntil: until }))).status).toBe(202); spy.mockRestore()
  await new Promise(resolve => setTimeout(resolve, 1050))
  const done = await retry(); expect(done.status).toBe(200); expect((await decide(done.body.offer._id)).status).toBe(409)
})
test('replays after replacement and final agreement perform no new writes and cannot reopen negotiation', async () => {
  const identity = key(), original = (await send(identity)).body.offer
  const replacement = (await send(key(), payload({ unitPrice: 90 }))).body.offer
  await Product.updateOne({ _id: f.product._id }, { $set: { name: 'catalog changed', unit: 'صندوق' } })
  const accepted = await decide(replacement._id); expect(accepted.status).toBe(200)
  expect(accepted.body.rfq.decision.agreement).toMatchObject({ unitPrice: 90, quantity: 20, totalPrice: 1800, unit: 'زوج', product: { name: f.product.name }, paymentTerms: payload().paymentTerms })
  const before = writes.length, replay = await send(identity)
  expect(replay.status).toBe(200); expect(replay.body.offer._id).toBe(original._id); expect(replay.body.rfq.status).toBe('accepted'); expect(writes.length).toBe(before)
  expect((await T.findOne({ rfqId: id })).status).toBe('closed'); expect((await send(key())).status).toBe(409)
})
test('a pending replacement resumes the originally captured commercial context after catalog changes', async () => {
  const identity = key(), spy = fault(O, 'updateOne', (_f, u) => Boolean(u.$setOnInsert), false, true)
  expect((await send(identity)).status).toBe(202); spy.mockRestore()
  await Product.updateOne({ _id: f.product._id }, { $set: { name: 'changed during outage', unit: 'صندوق' } })
  const done = await retry(); expect(done.status).toBe(200)
  expect(done.body.offer.productSnapshot).toMatchObject({ name: f.product.name, unit: 'زوج' })
  const accepted = await decide(done.body.offer._id); expect(accepted.status).toBe(200)
  expect(accepted.body.rfq.decision.agreement).toMatchObject({ unit: 'زوج', product: { name: f.product.name }, paymentTerms: payload().paymentTerms })
})
test('legacy missing conversations are not fabricated', async () => {
  await T.deleteMany({ rfqId: id }); expect((await send(key())).status).toBe(409)
  expect(await O.countDocuments({ rfqId: id })).toBe(0); expect(await T.countDocuments({ rfqId: id })).toBe(0)
  expect((await load()).offerSubmission).toBeUndefined()
})
test('forged ownership, status, snapshots and receipt fields have no authority', async () => {
  const result = await send(key(), payload({ supplierId: f.otherSupplier._id, buyerId: f.otherBuyer._id, status: 'accepted',
    productSnapshot: { name: 'forged', unit: 'forged' }, supplierSnapshot: { name: 'forged' }, submission: { phase: 'completed', key: 'forged' } }), 'staff')
  expect(result.status).toBe(200)
  expect(result.body.offer).toMatchObject({ supplierId: String(f.supplier._id), status: 'active', productSnapshot: { name: f.product.name, unit: 'زوج' }, supplierSnapshot: { id: String(f.supplier._id) } })
  expect(result.body.rfq.buyerId).toBe(String(f.buyer._id))
  expect((await T.findOne({ rfqId: id })).messages.at(-1).senderId.toString()).toBe(String(f.staff._id))
})
test('supplier submission races buyer decision: exactly one reservation wins', async () => {
  const previous = (await send(key())).body.offer
  const results = await Promise.all([send(key(), payload({ unitPrice: 88 })), decide(previous._id)])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const r = await load()
  if (r.status === 'accepted') { expect(String(r.currentOfferId)).toBe(previous._id); expect(await O.countDocuments({ rfqId: id })).toBe(1) }
  else { expect(r.status).toBe('responded'); expect(String(r.currentOfferId)).not.toBe(previous._id); expect((await O.findById(previous._id)).status).toBe('superseded') }
})
test('authorization, revoked membership, account isolation, key syntax, journal redaction', async () => {
  for (const who of ['otherSupplier', 'buyer', 'otherBuyer']) { expect((await send(key(), payload(), who)).status).toBe(403); expect((await retry(who)).status).toBe(403) }
  expect((await request(app).put('/api/rfq/' + id + '/respond').send(payload())).status).toBe(401)
  expect((await send('bad-key')).status).toBe(400)
  const identity = key(), sent = await send(identity, payload(), 'staff'); expect(sent.status).toBe(200)
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: [] } })
  expect((await send(identity, payload(), 'staff')).status).toBe(403); expect((await retry('staff')).status).toBe(403)
  expect((await send(identity)).body.offer._id).toBe(sent.body.offer._id)
  const view = await request(app).get('/api/rfq/' + id + '/thread').set(auth('buyer'))
  expect(JSON.stringify(view.body)).not.toMatch(/submission|dataHash|offerSubmission|r3-offer-attempt/)
})
test('recovery scans only explicit new journals; concurrent workers and module reload resume durable effects', async () => {
  const spy = fault(N, 'updateOne', (_f, u) => u.$setOnInsert?.type === 'offer_received', true, true)
  expect((await send(key())).status).toBe(202); spy.mockRestore()
  await R.updateOne({ _id: id }, { $unset: { 'offerSubmission.nextAttemptAt': 1 } })
  const run = createOfferRecovery(), results = await Promise.all([run.runOnce(), recoverPendingOffers()])
  expect(results.every(r => r.pending === 0)).toBe(true); await run.stop()
  await unique((await load()).currentOfferId)
  const legacy = await R.create({ buyerId: f.buyer._id, supplierId: f.supplier._id, productId: f.product._id, buyerName: f.buyer.name, buyerPhone: f.buyer.phone, quantity: 20 })
  expect((await recoverPendingOffers()).processed).toBe(0); expect(await T.exists({ rfqId: legacy._id })).toBeNull()
})
test('missing or incorrectly configured unique index fails closed, without reserving the RFQ', async () => {
  await O.collection.dropIndex('rfq_offer_submission_key')
  try { expect((await send(key())).status).toBe(503); expect((await load()).status).toBe('pending'); expect(await O.countDocuments()).toBe(0) }
  finally { await O.createIndexes() }
})
