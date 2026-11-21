// Real standalone MongoDB; no project dotenv/original data/provider requests.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs'), os = require('os'), path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-r2-integration-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'r2-synthetic-integration-secret-with-no-original-accounts',
  UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'), MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original',
  DISABLE_REDIS: '1', CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const mongoose = require('mongoose'), request = require('supertest'), { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), fixtures = require('./helpers/tradeFixtures')
const RFQ = require('../models/QuoteRequest'), Thread = require('../models/MessageThread'), Notification = require('../models/Notification')
const Product = require('../models/Product'), Supplier = require('../models/Supplier'), Offer = require('../models/QuoteOffer')
const { recoverPendingCreations, createCreationRecovery } = require('../services/rfqCreation')
const { agreementHash } = require('../services/commercialAgreement')
jest.setTimeout(120000)
let mongo, f, serial = 0, writes = []
const key = () => 'r2-create-attempt-' + (++serial).toString().padStart(12, '0')
const body = (extra = {}) => ({ productId: String(f.product._id), quantity: 20, buyerPhone: '+212600000001', buyerCity: 'الرباط', notes: 'R2_SYNTHETIC_REQUEST', ...extra })
const auth = (who = 'buyer') => ({ Authorization: 'Bearer ' + f.tokens[who] })
const post = (identity, data = body(), who = 'buyer') => { const call = request(app).post('/api/rfq').set(auth(who)); if (identity !== undefined) call.set('Idempotency-Key', identity); return call.send(data) }
const retry = (id, who = 'buyer') => request(app).post('/api/rfq/' + id + '/creation/retry').set(auth(who)).send({})
const fail = () => new Error('R2 synthetic write acknowledgement failure')
async function counts(id) { return { rfqs: await RFQ.countDocuments(), threads: await Thread.countDocuments({ rfqId: id }), notices: await Notification.countDocuments({ resourceId: id, type: 'rfq_created' }) } }
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger', dbName: 'r2_integration' } })
  await mongoose.connect(mongo.getUri('r2_integration'), { monitorCommands: true })
  const hello = await mongoose.connection.db.admin().command({ hello: 1 }); expect(hello.setName).toBeUndefined()
  mongoose.connection.getClient().on('commandStarted', event => { if (['insert', 'update'].includes(event.commandName) && event.command.writeConcern) writes.push({ command: event.commandName, writeConcern: event.command.writeConcern }) })
  f = await fixtures(); await Promise.all([RFQ.init(), Thread.init(), Notification.init()])
})
beforeEach(async () => {
  jest.restoreAllMocks(); await Promise.all([RFQ.deleteMany({}), Thread.deleteMany({}), Notification.deleteMany({}), Offer.deleteMany({}),
    Supplier.updateOne({ _id: f.buyer._id }, { $set: { isActive: true } }), Product.updateOne({ _id: f.product._id }, { $set: { isDraft: false, inStock: true, name: f.product.name } })])
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => {
  fs.writeFileSync(path.resolve(__dirname, '../../reports/phase-r2-evidence/mongo-write-concern.json'), JSON.stringify({ standalone: true, writes, journaled: writes.some(w => w.writeConcern.w === 1 && w.writeConcern.j === true) }, null, 2))
  await mongoose.disconnect(); if (mongo) await mongo.stop({ doCleanup: false })
})

test('identical retries return one RFQ, conversation, first message and supplier notification', async () => {
  const identity = key(), first = await post(identity), replay = await post(identity)
  expect(first.status).toBe(201); expect(replay.status).toBe(201)
  expect(replay.body.rfq._id).toBe(first.body.rfq._id); expect(replay.body.threadId).toBe(first.body.threadId)
  expect(replay.body.creation).toMatchObject({ phase: 'completed', replayed: true })
  expect(await counts(first.body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
  expect((await Thread.findOne()).messages).toHaveLength(1)
  expect(JSON.stringify(first.body.rfq)).not.toContain('creation')
  const list = await request(app).get('/api/rfq/buyer').set(auth())
  expect(JSON.stringify(list.body)).not.toContain(identity)
})
test('twelve concurrent identical attempts create one of every required document', async () => {
  const identity = key(), results = await Promise.all(Array.from({ length: 12 }, () => post(identity)))
  expect(results.every(result => result.status === 201)).toBe(true)
  expect(new Set(results.map(result => result.body.rfq._id)).size).toBe(1)
  expect(await counts(results[0].body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test('different content under one key conflicts, including a concurrent race', async () => {
  const identity = key(), responses = await Promise.all([post(identity), post(identity, body({ quantity: 30 }))])
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]); expect(await RFQ.countDocuments()).toBe(1)
})
test('accepted input is canonical and caller-controlled ownership/status/journal has no authority', async () => {
  const identity = key(), first = await post(identity, body({ quantity: '20', buyerId: String(f.otherBuyer._id), creation: { key: 'forged' }, status: 'accepted' }))
  expect(first.status).toBe(201); expect(first.body.rfq.buyerId).toBe(String(f.buyer._id)); expect(first.body.rfq.status).toBe('pending')
  const replay = await post(identity, { notes: ' R2_SYNTHETIC_REQUEST ', buyerCity: 'الرباط', buyerPhone: '+212600000001', quantity: 20, productId: String(f.product._id) })
  expect(replay.status).toBe(201); expect(replay.body.rfq._id).toBe(first.body.rfq._id)
  expect((await post(identity, body({ buyerPhone: '+212600000002' }))).status).toBe(409)
})
test('thread failure after RFQ insertion is explicit202 and blocks negotiation until recovery', async () => {
  const identity = key(); jest.spyOn(Thread, 'updateOne').mockRejectedValueOnce(fail())
  const initial = await post(identity), id = initial.body.rfq._id
  expect(initial.status).toBe(202); expect(initial.body.processing).toBe(true); expect(initial.body.threadId).toBeUndefined()
  expect(initial.body.rfq.status).toBe('creating'); expect(await counts(id)).toEqual({ rfqs: 1, threads: 0, notices: 0 })
  expect((await request(app).get('/api/rfq/supplier').set(auth('supplier'))).body.data).toHaveLength(0)
  expect((await request(app).put('/api/rfq/' + id + '/respond').set(auth('supplier')).send({ unitPrice: 12 })).status).toBe(409)
  expect((await request(app).post('/api/rfq/' + id + '/messages').set(auth()).send({ content: 'blocked' })).status).toBe(409)
  const thread = await request(app).get('/api/rfq/' + id + '/thread').set(auth()); expect(thread.status).toBe(202); expect(thread.body.thread).toBeNull()
  const resumed = await post(identity); expect(resumed.status).toBe(201); expect(resumed.body.rfq._id).toBe(id)
  expect(await counts(id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test('thread write committed but acknowledgement lost is recovered without another initial message', async () => {
  const original = Thread.updateOne.bind(Thread)
  jest.spyOn(Thread, 'updateOne').mockImplementationOnce(async (...args) => { await original(...args); throw fail() })
  const identity = key(), first = await post(identity)
  expect(first.status).toBe(202); expect((await Thread.findOne()).messages).toHaveLength(1)
  expect((await post(identity)).status).toBe(201); expect((await Thread.findOne()).messages).toHaveLength(1)
  expect(await counts(first.body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test.each(['before', 'after'])('notification failure %s its write resumes once and preserves readAt', async phase => {
  const original = Notification.updateOne.bind(Notification)
  jest.spyOn(Notification, 'updateOne').mockImplementationOnce(async (...args) => { if (phase === 'after') await original(...args); throw fail() })
  const identity = key(), first = await post(identity), id = first.body.rfq._id
  expect(first.status).toBe(202); expect(first.body.rfq.status).toBe('creating')
  expect((await counts(id)).notices).toBe(phase === 'after' ? 1 : 0)
  const readAt = new Date('2026-10-22T00:00:00Z')
  if (phase === 'after') await Notification.updateMany({}, { $set: { readAt } })
  expect((await retry(id)).status).toBe(201)
  expect(await counts(id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
  if (phase === 'after') expect((await Notification.findOne()).readAt).toEqual(readAt)
})
test.each(['before', 'after'])('RFQ insert acknowledgement failure %s persistence reuses the same attempt', async phase => {
  const original = RFQ.prototype.save
  jest.spyOn(RFQ.prototype, 'save').mockImplementationOnce(async function (...args) { if (phase === 'after') await original.apply(this, args); throw fail() })
  const identity = key(), first = await post(identity)
  expect(first.status).toBe(phase === 'after' ? 201 : 500)
  expect(await RFQ.countDocuments()).toBe(phase === 'after' ? 1 : 0)
  const resumed = await post(identity); expect(resumed.status).toBe(201)
  expect(await counts(resumed.body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test.each(['before', 'after'])('final readiness write failure %s persistence cannot duplicate effects or claim premature readiness', async phase => {
  const original = RFQ.updateOne.bind(RFQ); let armed = true
  jest.spyOn(RFQ, 'updateOne').mockImplementation(async (...args) => {
    if (armed && args[1].$set?.status === 'pending') { armed = false; if (phase === 'after') await original(...args); throw fail() }
    return original(...args)
  })
  const identity = key(), first = await post(identity)
  expect(first.status).toBe(phase === 'after' ? 201 : 202)
  const again = await post(identity); expect(again.status).toBe(201)
  expect(await counts(again.body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test('buyer key namespace and recovery endpoints never disclose another buyer request', async () => {
  const identity = key(), first = await post(identity), other = await post(identity, body(), 'otherBuyer')
  expect(other.status).toBe(201); expect(other.body.rfq._id).not.toBe(first.body.rfq._id)
  expect(other.body.rfq.buyerId).toBe(String(f.otherBuyer._id))
  expect((await retry(first.body.rfq._id, 'otherBuyer')).status).toBe(403)
  expect((await retry(first.body.rfq._id, 'supplier')).status).toBe(403)
  expect((await request(app).get('/api/rfq/' + first.body.rfq._id).set(auth('otherBuyer'))).status).toBe(403)
})
test('live session revocation blocks replay; no private data leaks in error responses', async () => {
  const identity = key(); await post(identity)
  await Supplier.updateOne({ _id: f.buyer._id }, { $set: { isActive: false } })
  const denied = await post(identity); expect(denied.status).toBe(401); expect(denied.body.rfq).toBeUndefined()
  expect(await RFQ.countDocuments()).toBe(1)
})
test('background recovery ignores historical orphan requests and completes only the durable R2 intent', async () => {
  const legacy = await RFQ.create({ productId: f.product._id, supplierId: f.supplier._id, buyerId: f.buyer._id,
    buyerName: f.buyer.name, buyerPhone: f.buyer.phone, quantity: 20, status: 'pending' })
  jest.spyOn(Thread, 'updateOne').mockRejectedValueOnce(fail())
  const first = await post(key()); expect(first.status).toBe(202)
  await Product.updateOne({ _id: f.product._id }, { $set: { isDraft: true, name: 'R2 later edited' } })
  const result = await recoverPendingCreations({ now: new Date(Date.now() + 100000) })
  expect(result).toEqual({ processed: 1, completed: 1, pending: 0 })
  expect(await Thread.exists({ rfqId: legacy._id })).toBeNull()
  expect((await retry(legacy._id)).status).toBe(409)
  expect((await Thread.findOne({ rfqId: first.body.rfq._id })).subject).toBe(f.product.name)
})
test('two recovery runners safely reconcile one partial intent and stop cleanly', async () => {
  jest.spyOn(Thread, 'updateOne').mockRejectedValueOnce(fail())
  const created = await post(key()); expect(created.status).toBe(202)
  await RFQ.updateOne({ _id: created.body.rfq._id }, { $unset: { 'creation.nextAttemptAt': 1 } })
  const a = createCreationRecovery(), b = createCreationRecovery()
  await Promise.all([a.runOnce(), b.runOnce()]); await Promise.all([a.stop(), b.stop()])
  expect(await counts(created.body.rfq._id)).toEqual({ rfqs: 1, threads: 1, notices: 1 })
})
test('completed create replay preserves Phase B negotiation, acceptance and immutable agreement', async () => {
  const identity = key(), created = await post(identity), id = created.body.rfq._id
  const responded = await request(app).put('/api/rfq/' + id + '/respond').set(auth('supplier')).send({ unitPrice: 100, deliveryDays: 4, paymentTerms: 'R2 synthetic terms' })
  expect(responded.status).toBe(200)
  const accepted = await request(app).put('/api/rfq/' + id + '/action').set(auth()).send({ action: 'accept', offerId: responded.body.offer._id })
  expect(accepted.status).toBe(200); expect(accepted.body.rfq.status).toBe('accepted')
  const hash = accepted.body.rfq.decision.agreementHash
  expect(agreementHash(accepted.body.rfq.decision.agreement)).toBe(hash)
  const replay = await post(identity)
  expect(replay.status).toBe(201); expect(replay.body.rfq.status).toBe('accepted'); expect(replay.body.rfq.decision.agreementHash).toBe(hash)
  expect((await Thread.findOne()).status).toBe('closed'); expect((await Thread.findOne()).messages).toHaveLength(3)
  expect((await counts(id)).notices).toBe(1)
})
test('new operation keys create distinct RFQs, while legacy clients retain basic compatibility', async () => {
  expect((await post(key())).status).toBe(201); expect((await post(key())).status).toBe(201)
  expect((await post(undefined)).status).toBe(201); expect(await RFQ.countDocuments()).toBe(3)
  expect((await post('short')).status).toBe(400)
})
test('keyed creation fails closed when its uniqueness index is missing', async () => {
  const index = (await RFQ.collection.indexes()).find(x => x.name === 'rfq_creation_buyer_key')
  await RFQ.collection.dropIndex(index.name)
  try { expect((await post(key())).status).toBe(503); expect(await RFQ.countDocuments()).toBe(0) }
  finally { await RFQ.collection.createIndex(index.key, { name: index.name, unique: true, partialFilterExpression: index.partialFilterExpression }) }
})
