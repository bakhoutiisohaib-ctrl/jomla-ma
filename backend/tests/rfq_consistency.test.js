// Actual standalone MongoDB + HTTP fault-injection tests. No project dotenv,
// production DB, existing media, provider inference or external service.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs')
const os = require('os')
const path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-phase-b-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'synthetic-phase-b-secret-no-real-accounts',
  UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '',
  BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', DISABLE_REDIS: '1' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Order = require('../models/Order')
const { completeDecision, recoverPendingDecisions, createDecisionRecovery } = require('../services/rfqDecision')
const { agreementHash } = require('../services/commercialAgreement')
const { backupDatabase, restoreDatabase } = require('../services/backup')

jest.setTimeout(120000)
let mongo, f
const stabilityEvidence = []
const auth = (who = 'buyer') => ({ Authorization: 'Bearer ' + f.tokens[who] })
async function ready(price = 100) {
  const created = await request(app).post('/api/rfq').set(auth()).send({ productId: f.product._id,
    quantity: 20, buyerPhone: '+212600000001', buyerCity: 'الرباط', notes: 'تعريف اصطناعي للطلب' })
  expect(created.status).toBe(201)
  const response = await respond(created.body.rfq._id, price)
  expect(response.status).toBe(200)
  return { id: created.body.rfq._id, offer: response.body.offer }
}
const respond = (id, price) => request(app).put('/api/rfq/' + id + '/respond').set(auth('supplier'))
  .send({ unitPrice: price, deliveryDays: 4, paymentTerms: 'شروط اصطناعية ثابتة', notes: 'تسليم دفعة واحدة' })
const action = (record, choice = 'accept', who = 'buyer', extra = {}) => request(app).put('/api/rfq/' + record.id + '/action')
  .set(auth(who)).send({ action: choice, offerId: record.offer._id, ...extra })
async function state(record) {
  return { rfq: await QuoteRequest.findById(record.id).lean(), offer: await QuoteOffer.findById(record.offer._id).lean(),
    thread: await MessageThread.findOne({ rfqId: record.id }).lean(),
    notices: await Notification.find({ resourceId: record.id, type: 'offer_decision' }).lean() }
}
async function assertFinal(record, status = 'accepted') {
  const s = await state(record), d = s.rfq.decision
  expect(s.rfq.status).toBe(status)
  expect(d.phase).toBe('completed')
  expect(s.offer.status).toBe(status)
  expect(String(s.offer.decisionId)).toBe(String(d.id))
  expect(s.thread.status).toBe('closed')
  expect(String(s.thread.decisionId)).toBe(String(d.id))
  expect(s.thread.messages.filter(m => String(m._id) === String(d.id))).toHaveLength(1)
  expect(s.notices).toHaveLength(1)
  expect(String(s.notices[0]._id)).toBe(String(d.id))
  expect(await Order.countDocuments()).toBe(0)
  if (status === 'accepted') expect(agreementHash(d.agreement)).toBe(d.agreementHash)
  return s
}

// Acknowledgement loss is reproduced by executing the REAL write and throwing
// afterwards, rather than pretending that an uncommitted write succeeded.
function failStage(stage, after = false) {
  const map = {
    claim: [QuoteRequest, 'findOneAndUpdate', (_q, u) => u.$set?.status === 'deciding'],
    offer: [QuoteOffer, 'updateOne', (_q, u) => u.$set?.status === 'accepted'],
    thread: [MessageThread, 'updateOne', (_q, u) => Boolean(u.$set?.decisionId)],
    notification: [Notification, 'updateOne', (_q, u) => Boolean(u.$setOnInsert?.decisionId)],
    final: [QuoteRequest, 'updateOne', (_q, u) => u.$set?.['decision.phase'] === 'completed']
  }
  const [Model, method, isStage] = map[stage]
  const original = Model[method]
  let injected = false
  return jest.spyOn(Model, method).mockImplementation(async function (...args) {
    if (!injected && isStage(...args)) {
      injected = true
      if (after) await original.apply(this, args)
      throw Object.assign(new Error('Synthetic server failure at ' + stage), { code: 'SYNTHETIC_WRITE_FAILURE' })
    }
    return original.apply(this, args)
  })
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'phase_b_standalone', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('phase_b_standalone'), { monitorCommands: true })
  await Promise.all([QuoteRequest.init(), QuoteOffer.init(), MessageThread.init(), Notification.init()])
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  expect(hello.setName).toBeUndefined() // Demonstrably not a replica set/transaction deployment.
})
beforeEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
  f = await fixtures()
})
afterAll(async () => {
  jest.restoreAllMocks()
  if (process.env.OPS2_RFQ_EVIDENCE) fs.writeFileSync(process.env.OPS2_RFQ_EVIDENCE, JSON.stringify(stabilityEvidence, null, 2))
  require('../middleware/logger').logger.close()
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  const checked = path.resolve(root)
  if (path.dirname(checked) === path.resolve(os.tmpdir()) && path.basename(checked).startsWith('jomla-phase-b-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary Windows log handles only */ }
  }
})

test.each(['claim', 'offer', 'thread', 'notification', 'final'].flatMap(stage => [[stage, false], [stage, true]]))(
  'safe retry after server failure at %s (write committed before error: %s)', async (stage, after) => {
    const record = await ready()
    const fault = failStage(stage, after)
    const response = await action(record)
    expect([200, 202, 500]).toContain(response.status)
    fault.mockRestore()
    const s = await state(record)
    if (s.rfq.status === 'accepted') await assertFinal(record)
    else expect(s.rfq.status).toBe(stage === 'claim' && !after ? 'responded' : 'deciding')
    if (s.rfq.status === 'deciding') {
      expect(response.status).toBe(202)
      expect(response.body.processing).toBe(true)
      expect(response.body.rfq.status).not.toBe('accepted')
      expect((await respond(record.id, 50)).status).toBe(409)
      expect((await action(record, 'reject')).status).toBe(409)
      expect((await request(app).post('/api/rfq/' + record.id + '/messages').set(auth()).send({ content: 'late message' })).status).toBe(409)
    }
    const replay = await action(record)
    expect(replay.status).toBe(200)
    const done = await assertFinal(record)
    const stable = JSON.stringify(done.rfq.decision.agreement)
    expect((await action(record)).status).toBe(200)
    expect(JSON.stringify((await assertFinal(record)).rfq.decision.agreement)).toBe(stable)
  })

test('a newly started recovery worker finishes a persisted intent without a client retry', async () => {
  const record = await ready(), fault = failStage('offer')
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  const journal = (await state(record)).rfq.decision
  // Simulate process restart: fresh connection, no retained request/service state.
  await mongoose.disconnect()
  await mongoose.connect(mongo.getUri('phase_b_standalone'), { monitorCommands: true })
  await QuoteRequest.updateOne({ _id: record.id }, { $set: { 'decision.nextAttemptAt': new Date(0) } })
  const recovery = createDecisionRecovery({ pollMs: 10 })
  try { expect((await recovery.runOnce()).completed).toBe(1) } finally { await recovery.stop() }
  const result = await assertFinal(record)
  expect(String(result.rfq.decision.id)).toBe(String(journal.id))
  expect(result.rfq.decision.agreementHash).toBe(journal.agreementHash)
})

test('simultaneous identical decisions, duplicate recovery and repeat delivery create one message and notification', async () => {
  const record = await ready()
  const responses = await Promise.all(Array.from({ length: 6 }, () => action(record)))
  expect(responses.every(r => r.status === 200)).toBe(true)
  await Promise.all(Array.from({ length: 5 }, () => completeDecision(record.id)))
  const result = await assertFinal(record)
  expect(result.rfq.revision).toBe(4) // R3 reservation + publication, then unchanged B claim + finalization.
  await Notification.updateOne({ _id: result.rfq.decision.id }, { $set: { readAt: new Date('2026-01-01') } })
  await action(record)
  expect((await Notification.findById(result.rfq.decision.id)).readAt.toISOString()).toBe('2026-01-01T00:00:00.000Z')
})

test('notification inserted before acknowledgement failure remains read after replay', async () => {
  const record = await ready(), fault = failStage('notification', true)
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  const before = await state(record)
  expect(before.notices).toHaveLength(1)
  const readAt = new Date('2026-02-02')
  await Notification.updateOne({ _id: before.notices[0]._id }, { $set: { readAt } })
  expect((await action(record)).status).toBe(200)
  expect((await assertFinal(record)).notices[0].readAt).toEqual(readAt)
})

test('conflicting buyer decisions have one durable winner', async () => {
  const record = await ready()
  const responses = await Promise.all([action(record, 'accept'), action(record, 'reject')])
  expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  const status = (await state(record)).rfq.status
  await assertFinal(record, status)
  expect((await action(record, status === 'accepted' ? 'reject' : 'accept')).status).toBe(409)
})

test('a superseded offer cannot win even if its retirement write was previously lost', async () => {
  const record = await ready(), newer = await respond(record.id, 95)
  expect(newer.status).toBe(200)
  await QuoteOffer.updateOne({ _id: record.offer._id }, { $set: { status: 'active' } })
  expect((await action(record)).status).toBe(409)
  expect((await state(record)).rfq.decision).toBeUndefined()
  expect((await action({ id: record.id, offer: newer.body.offer })).status).toBe(200)
})

test('racing a replacement offer against a buyer decision never accepts a non-current offer', async () => {
  const record = await ready()
  const [replacement, decision] = await Promise.all([respond(record.id, 88), action(record)])
  const s = await state(record)
  if (decision.status === 200) {
    expect(replacement.status).toBe(409)
    await assertFinal(record)
  } else {
    expect(decision.status).toBe(409)
    expect(replacement.status).toBe(200)
    expect(String(s.rfq.currentOfferId)).toBe(replacement.body.offer._id)
    expect(s.rfq.decision).toBeUndefined()
  }
})

test('expired offers cannot be claimed but a committed decision is recovered after expiry', async () => {
  const record = await ready()
  await QuoteOffer.updateOne({ _id: record.offer._id }, { $set: { validUntil: new Date(0) } })
  expect((await action(record)).status).toBe(409)
  await QuoteOffer.updateOne({ _id: record.offer._id }, { $unset: { validUntil: 1 } })
  const fault = failStage('offer')
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  await QuoteOffer.updateOne({ _id: record.offer._id }, { $set: { validUntil: new Date(0) } })
  expect((await action(record)).status).toBe(200)
  await assertFinal(record)
})

test('commercial and product details stay as quoted through catalog edits/deletion and later profile edits', async () => {
  const record = await ready(19), original = record.offer.productSnapshot
  await Product.updateOne({ _id: f.product._id }, { $set: { name: 'اسم جديد', unit: 'صندوق', description: 'وصف متغير بعد العرض' } })
  await Supplier.updateOne({ _id: f.supplier._id }, { $set: { name: 'اسم مورد جديد' } })
  const listing = await request(app).get('/api/rfq/buyer').set(auth())
  expect(listing.body.data[0].offer.productSnapshot.unit).toBe('زوج')
  expect(listing.body.data[0].productId.unit).toBe('صندوق')
  await Product.deleteOne({ _id: f.product._id })
  expect((await action(record, 'accept', 'buyer', { agreement: { unitPrice: 1, unit: 'fake' } })).status).toBe(200)
  const s = await assertFinal(record), agreement = s.rfq.decision.agreement
  expect(agreement).toMatchObject({ source: 'offer_snapshot', unitPrice: 19, quantity: 20, totalPrice: 380,
    currency: 'MAD', unit: 'زوج', deliveryDays: 4, paymentTerms: 'شروط اصطناعية ثابتة', notes: 'تسليم دفعة واحدة' })
  expect(agreement.product).toMatchObject({ id: String(f.product._id), name: original.name, unit: 'زوج', description: original.description })
  expect(agreement.supplier.name).toBe(f.supplier.name)
  expect(agreement.buyer.name).toBe(f.buyer.name)
  expect(JSON.stringify(agreement)).not.toMatch(/imageUrl|\/uploads\//)
  const hash = s.rfq.decision.agreementHash
  await QuoteOffer.collection.updateOne({ _id: s.offer._id }, { $set: { unitPrice: 3, paymentTerms: 'later corruption' } })
  await action(record)
  expect((await state(record)).rfq.decision.agreementHash).toBe(hash)
  const read = await request(app).get('/api/rfq/' + record.id).set(auth())
  expect(read.body.productId).toBeNull()
  expect(read.body.decision.agreement.unitPrice).toBe(19)
})

test('legacy accepted records and their inconsistent projections are not guessed or auto-migrated', async () => {
  const record = await ready()
  await QuoteRequest.updateOne({ _id: record.id }, { $set: { status: 'accepted' } })
  await QuoteOffer.collection.updateOne({ _id: new mongoose.Types.ObjectId(record.offer._id) }, { $unset: { productSnapshot: 1, supplierSnapshot: 1 } })
  const before = await state(record)
  expect((await recoverPendingDecisions({ now: new Date(Date.now() + 120000) })).processed).toBe(0)
  expect((await action(record)).status).toBe(409)
  const after = await state(record)
  expect(after).toEqual(before)
  expect(after.rfq.decision).toBeUndefined()
})

test('a new decision on a legacy active offer explicitly records current product provenance without backfilling the offer', async () => {
  const record = await ready()
  await QuoteOffer.collection.updateOne({ _id: new mongoose.Types.ObjectId(record.offer._id) }, { $unset: { productSnapshot: 1, supplierSnapshot: 1 } })
  expect((await action(record)).status).toBe(200)
  const s = await assertFinal(record)
  expect(s.rfq.decision.agreement.source).toBe('legacy_product_at_decision')
  expect(s.offer.productSnapshot).toBeUndefined()
})

test('a legacy offer with a deleted product cannot invent an acceptance snapshot but may still be rejected', async () => {
  const record = await ready()
  await QuoteOffer.collection.updateOne({ _id: new mongoose.Types.ObjectId(record.offer._id) }, { $unset: { productSnapshot: 1, supplierSnapshot: 1 } })
  await Product.deleteOne({ _id: f.product._id })
  expect((await action(record)).status).toBe(409)
  expect((await state(record)).rfq.decision).toBeUndefined()
  expect((await action(record, 'reject')).status).toBe(200)
  await assertFinal(record, 'rejected')
})

test('other parties, suppliers and revoked sessions cannot decide; a persisted authorized intent survives later logout', async () => {
  const record = await ready()
  expect((await action(record, 'accept', 'otherBuyer')).status).toBe(403)
  expect((await action(record, 'accept', 'supplier')).status).toBe(403)
  expect((await state(record)).rfq.decision).toBeUndefined()
  const fault = failStage('thread')
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  expect((await request(app).post('/api/suppliers/logout').set(auth())).status).toBe(200)
  expect((await action(record)).status).toBe(401)
  expect((await recoverPendingDecisions({ now: new Date(Date.now() + 120000) })).completed).toBe(1)
  await assertFinal(record)
})

test('persistent projection failures remain pending with bounded retries and never masquerade as accepted', async () => {
  const record = await ready()
  const original = MessageThread.updateOne
  const fault = jest.spyOn(MessageThread, 'updateOne').mockImplementation(function (q, u, ...rest) {
    return u.$set?.decisionId ? Promise.reject(new Error('persistent synthetic failure')) : original.call(this, q, u, ...rest)
  })
  expect((await action(record)).status).toBe(202)
  const errors = []
  for (let i = 0; i < 3; i++) expect((await recoverPendingDecisions({ now: new Date(Date.now() + 120000), onError: e => errors.push(e) })).pending).toBe(1)
  const pending = (await state(record)).rfq
  expect(pending.status).toBe('deciding')
  expect(pending.decision.attempts).toBe(4)
  expect(pending.decision.nextAttemptAt.getTime() - Date.now()).toBeLessThanOrEqual(60000)
  expect(errors).toHaveLength(3)
  expect(errors.every(e => e.code === 'RFQ_DECISION_RETRY')).toBe(true)
  fault.mockRestore()
  await completeDecision(record.id)
  await assertFinal(record)
})

test('a corrupted pending agreement fails closed rather than reconstructing prices from current records', async () => {
  const record = await ready(), fault = failStage('offer')
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  await QuoteRequest.updateOne({ _id: record.id }, { $set: { 'decision.agreement.unitPrice': 1 } })
  const errors = []
  expect((await recoverPendingDecisions({ now: new Date(Date.now() + 120000), onError: e => errors.push(e) })).pending).toBe(1)
  expect(errors[0].code).toBe('RFQ_DECISION_CONFLICT')
  expect((await state(record)).rfq.status).toBe('deciding')
})

test('actual standalone write commands request durable journaling before exposing accepted state', async () => {
  const record = await ready(), commands = []
  const client = mongoose.connection.getClient()
  const listener = event => {
    if (['update', 'findAndModify'].includes(event.commandName)) commands.push({
      collection: event.commandName === 'update' ? event.command.update : event.command.findAndModify, concern: event.command.writeConcern
    })
  }
  client.on('commandStarted', listener)
  try { expect((await action(record)).status).toBe(200) } finally { client.off('commandStarted', listener) }
  expect(commands.length).toBeGreaterThanOrEqual(5)
  expect(commands.every(command => command.concern?.j === true && command.concern.w === 1)).toBe(true)
  expect(new Set(commands.map(command => command.collection)).size).toBe(4)
  await assertFinal(record)
})

test('background recovery starts from its durable scan and stops cleanly', async () => {
  const record = await ready(), fault = failStage('offer')
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  await QuoteRequest.updateOne({ _id: record.id }, { $set: { 'decision.nextAttemptAt': new Date(0) } })
  const recovery = createDecisionRecovery({ pollMs: 10 }).start()
  expect((await recovery.runOnce()).completed).toBe(1)
  await recovery.stop()
  expect((await recovery.runOnce()).processed).toBe(0)
  await assertFinal(record)
})

test('buyer rejection uses the same recoverable journal and cannot later become acceptance', async () => {
  const record = await ready()
  const original = MessageThread.updateOne
  const fault = jest.spyOn(MessageThread, 'updateOne').mockRejectedValueOnce(new Error('synthetic rejection crash'))
  expect((await action(record, 'reject')).status).toBe(202)
  fault.mockRestore()
  expect(MessageThread.updateOne).toBe(original)
  expect((await action(record, 'accept')).status).toBe(409)
  expect((await action(record, 'reject')).status).toBe(200)
  expect((await assertFinal(record, 'rejected')).rfq.decision.agreement).toBeUndefined()
})

test('a pending decision and its unchanged snapshot survive backup and recovery into a separate empty database', async () => {
  const record = await ready(), fault = failStage('thread', true)
  expect((await action(record)).status).toBe(202)
  fault.mockRestore()
  const original = await state(record)
  const source = mongo.getUri('phase_b_standalone')
  const archive = path.join(root, 'pending-decision-backup')
  const restoredMedia = path.join(root, 'restored-media')
  await backupDatabase({ uri: source, output: archive, uploads: process.env.UPLOADS_DIR })
  const result = await restoreDatabase({ uri: source, configuredProductionUri: source, archive,
    targetDatabase: 'phase_b_restored', confirmTarget: 'phase_b_restored', mediaTarget: restoredMedia,
    outcome: path.join(root, 'restore-outcome.json') })
  expect(result.outcome.status).toBe('complete')
  await mongoose.disconnect()
  try {
    await mongoose.connect(mongo.getUri('phase_b_restored'), { monitorCommands: true })
    expect((await state(record)).rfq.decision.agreement).toEqual(original.rfq.decision.agreement)
    expect((await recoverPendingDecisions({ now: new Date(Date.now() + 120000) })).completed).toBe(1)
    const completed = await assertFinal(record)
    expect(completed.rfq.decision.agreementHash).toBe(original.rfq.decision.agreementHash)
    expect(completed.thread.messages.filter(m => String(m._id) === String(original.rfq.decision.id))).toHaveLength(1)
  } finally {
    await mongoose.disconnect()
    await mongoose.connect(source, { monitorCommands: true })
  }
  expect((await state(record)).rfq.status).toBe('deciding') // source never restored/overwritten.
})

test('supplier-supplied snapshot fields cannot forge the server-captured product identity', async () => {
  const record = await ready()
  const response = await request(app).put('/api/rfq/' + record.id + '/respond').set(auth('supplier')).send({
    unitPrice: 90, deliveryDays: 3, productSnapshot: { id: 'fake-product', name: 'forged', unit: 'fake unit' },
    supplierSnapshot: { id: String(f.otherSupplier._id), name: 'forged supplier' }
  })
  expect(response.status).toBe(200)
  expect(response.body.offer.productSnapshot).toMatchObject({ id: String(f.product._id), name: f.product.name, unit: 'زوج' })
  expect(response.body.offer.supplierSnapshot.id).toBe(String(f.supplier._id))
})

// Delay a real read, never its data, until another HTTP decision has committed.
function pausePreclaimRead(stage) {
  const Model = stage === 'offer' ? QuoteOffer : MessageThread
  const method = stage === 'offer' ? 'findOne' : 'exists', original = Model[method]
  let enter, release, blocked = false
  const entered = new Promise(resolve => { enter = resolve }), gate = new Promise(resolve => { release = resolve })
  const spy = jest.spyOn(Model, method).mockImplementation(function (...args) {
    const target = stage === 'offer' ? args[0]?.status === 'active' : args[0]?.decisionId?.$exists === false
    if (!blocked && target) { blocked = true; enter(); return gate.then(() => original.apply(this, args)) }
    return original.apply(this, args)
  })
  return { entered, release, restore: () => spy.mockRestore() }
}

test.each([
  ['offer', 'accept', 'accept'], ['thread', 'accept', 'accept'],
  ['offer', 'reject', 'reject'], ['thread', 'reject', 'reject'],
  ['offer', 'accept', 'reject'], ['thread', 'reject', 'accept']
])('stale %s read: persisted %s versus delayed %s returns only the authorized matching receipt', async (stage, winnerAction, delayedAction) => {
  const record = await ready(), pause = pausePreclaimRead(stage)
  const delayed = action(record, delayedAction).then(response => response)
  let winner, late
  try { await pause.entered; winner = await action(record, winnerAction) }
  finally { pause.release() }
  try { late = await delayed } finally { pause.restore() }
  expect(winner.status).toBe(200)
  expect(late.status).toBe(winnerAction === delayedAction ? 200 : 409)
  const final = await assertFinal(record, winnerAction === 'accept' ? 'accepted' : 'rejected')
  expect(final.rfq.decision.action).toBe(winnerAction)
  expect((await action(record, winnerAction === 'accept' ? 'reject' : 'accept')).status).toBe(409)
})

test.each(['offer', 'thread'])('stale %s read replays the same pending intent as 202 without inventing completion', async stage => {
  const record = await ready(), pause = pausePreclaimRead(stage)
  const delayed = action(record).then(response => response)
  await pause.entered
  const fault = jest.spyOn(Notification, 'updateOne').mockRejectedValue(new Error('synthetic ongoing notification outage'))
  let winner, late
  try { winner = await action(record); pause.release(); late = await delayed }
  finally { pause.release(); pause.restore(); fault.mockRestore() }
  expect(winner.status).toBe(202); expect(late.status).toBe(202)
  const pending = await state(record)
  expect(pending.rfq.status).toBe('deciding'); expect(pending.rfq.decision.phase).toBe('pending')
  expect(pending.notices).toHaveLength(0)
  expect((await action(record)).status).toBe(200)
  await assertFinal(record)
})

test.each(['accept', 'reject'])('%s receipt resumes and replays in a new Node process without new effects', async choice => {
  const record = await ready(), fault = failStage('notification')
  expect((await action(record, choice)).status).toBe(202); fault.mockRestore()
  const before = await state(record), journal = before.rfq.decision
  const script = `const mongoose=require('mongoose');(async()=>{
    await mongoose.connect(process.env.OPS2_DISPOSABLE_URI);
    const {decide}=require('./services/rfqDecision');
    const result=await decide(JSON.parse(process.env.OPS2_DECISION_INPUT));
    console.log(JSON.stringify({status:result.rfq.status,processing:result.processing,id:String(result.rfq.decision.id)}));
    await mongoose.disconnect();
  })().catch(async e=>{console.error(e.code||e.name);await mongoose.disconnect();process.exitCode=1})`
  const run = () => JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000,
    env: { ...process.env, OPS2_DISPOSABLE_URI: mongo.getUri('phase_b_standalone'), OPS2_DECISION_INPUT: JSON.stringify({
      rfqId: record.id, buyerId: String(f.buyer._id), actor: { id: String(f.buyer._id), name: f.buyer.name }, action: choice, offerId: record.offer._id
    }) }
  }))
  expect(run()).toEqual({ status: choice === 'accept' ? 'accepted' : 'rejected', processing: false, id: String(journal.id) })
  const stamp = new Date('2026-03-04T05:06:07Z')
  await Notification.updateOne({ _id: journal.id }, { $set: { readAt: stamp } })
  run()
  const final = await assertFinal(record, choice === 'accept' ? 'accepted' : 'rejected')
  expect(final.rfq.decision.agreement).toEqual(journal.agreement)
  expect(final.notices[0].readAt).toEqual(stamp)
})

test('40 isolated rounds of six identical HTTP decisions preserve one receipt and its exact effects', async () => {
  for (let iteration = 0; iteration < 40; iteration++) {
    const record = await ready(), responses = await Promise.all(Array.from({ length: 6 }, () => action(record)))
    expect(responses.every(response => [200, 202].includes(response.status))).toBe(true)
    await Promise.all(Array.from({ length: 3 }, () => completeDecision(record.id)))
    const final = await assertFinal(record), snapshot = JSON.stringify(final.rfq.decision.agreement)
    expect((await action(record)).status).toBe(200)
    expect(JSON.stringify((await state(record)).rfq.decision.agreement)).toBe(snapshot)
    stabilityEvidence.push({ iteration, statuses: responses.map(response => response.status), rfq: final.rfq.status,
      offer: final.offer.status, phase: final.rfq.decision.phase, thread: final.thread.status,
      decisionMessages: final.thread.messages.filter(message => String(message._id) === String(final.rfq.decision.id)).length,
      notifications: final.notices.length, agreementHashValid: agreementHash(final.rfq.decision.agreement) === final.rfq.decision.agreementHash })
  }
})
