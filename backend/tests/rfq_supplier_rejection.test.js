require('./helpers/pilotIsolation')
const fs = require('fs'), path = require('path'), cp = require('child_process')
const express = require('express'), request = require('supertest'), mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), fixtures = require('./helpers/tradeFixtures')
const R = require('../models/QuoteRequest'), O = require('../models/QuoteOffer')
const T = require('../models/MessageThread'), N = require('../models/Notification')
const Membership = require('../models/Membership')
const { completeRejection, recoverPendingRejections, createRejectionRecovery } = require('../services/rfqSupplierRejection')
let mongo, f, id, serial = 0
const auth = (who = 'supplier') => ({ Authorization: 'Bearer ' + f.tokens[who] })
const reject = (who = 'supplier') => request(app).put('/api/rfq/' + id + '/respond').set(auth(who)).send({ status: 'rejected' })
const offer = () => request(app).put('/api/rfq/' + id + '/respond').set(auth()).set('Idempotency-Key', 'r43a-offer-' + String(++serial).padStart(16, '0')).send({ unitPrice: 99, deliveryDays: 4 })
const decide = (offerId, action = 'accept') => request(app).put('/api/rfq/' + id + '/action').set(auth('buyer')).send({ action, offerId })
const load = () => R.findById(id).select('+supplierRejection +offerSubmission')
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'r43a_rejection_tests', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('r43a_rejection_tests'))
  expect((await mongoose.connection.db.admin().command({ hello: 1 })).setName).toBeUndefined()
  await Promise.all([R.init(), O.init(), T.init(), N.init()])
})
beforeEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
  f = await fixtures()
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { require('../middleware/logger').logger.close(); await mongoose.disconnect(); if (mongo) await mongo.stop() })
async function ready(withOffer = true) {
  const created = await request(app).post('/api/rfq').set(auth('buyer')).send({ productId: String(f.product._id), quantity: 20, buyerPhone: '+212600000001' })
  expect(created.status).toBe(201); id = created.body.rfq._id
  if (withOffer) expect((await offer()).status).toBe(200)
  return load()
}
const stages = {
  claim: [R, 'findOneAndUpdate', (_q, u) => Boolean(u.$set?.supplierRejection)],
  attempt: [R, 'updateOne', (_q, u) => Boolean(u.$inc?.['supplierRejection.attempts'])],
  offer: [O, 'updateOne', (_q, u) => u.$set?.status === 'rejected'],
  thread: [T, 'updateOne', (_q, u) => Boolean(u.$set?.decisionId)],
  notice: [N, 'updateOne', (_q, u) => Boolean(u.$setOnInsert?.decisionId)],
  final: [R, 'updateOne', (_q, u) => u.$set?.['supplierRejection.phase'] === 'completed']
}
function fault(stage, after = false, always = false) {
  const [model, method, predicate] = stages[stage], original = model[method].bind(model)
  let used = false
  return jest.spyOn(model, method).mockImplementation((...args) => {
    if (predicate(...args) && (!used || always)) {
      used = true
      const promise = (async () => { if (after) await original(...args); throw Error('SYNTHETIC_WRITE_ACK_FAILURE') })()
      promise.select = () => promise
      return promise
    }
    return original(...args)
  })
}
async function finalState(withOffer = true) {
  const r = await load(), j = r.supplierRejection
  expect(r.status).toBe('rejected'); expect(j.phase).toBe('completed'); expect(r.decision).toBeUndefined()
  expect(r.revision).toBe(j.claimedRevision + 1)
  if (withOffer) {
    const o = await O.findById(j.previousOfferId)
    expect(o.status).toBe('rejected'); expect(String(o.decisionId)).toBe(String(j.id))
    expect(String(r.currentOfferId)).toBe(String(o._id))
  } else expect(await O.countDocuments({ rfqId: id })).toBe(0)
  const t = await T.findOne({ rfqId: id })
  expect(t.status).toBe('closed'); expect(String(t.decisionId)).toBe(String(j.id))
  expect(t.messages.filter(m => String(m._id) === String(j.id))).toHaveLength(1)
  expect(t.messages.find(m => String(m._id) === String(j.id)).senderRole).toBe('supplier')
  expect(await N.countDocuments({ resourceId: id, type: 'offer_decision' })).toBe(1)
  const n = await N.findById(j.id); expect(String(n.userId)).toBe(String(f.buyer._id))
  return r
}
test.each([true, false])('normal refusal withOffer=%s is replayable and closes only after all effects', async withOffer => {
  await ready(withOffer)
  expect((await reject()).status).toBe(200)
  const r = await finalState(withOffer), before = r.toObject({ transform: false })
  expect((await reject()).status).toBe(200)
  expect((await finalState(withOffer)).toObject({ transform: false })).toEqual(before)
})
test.each(Object.keys(stages).flatMap(stage => [false, true].map(after => [stage, after])))('%s failure afterWrite=%s recovers the same persistent intent', async (stage, after) => {
  await ready()
  const spy = fault(stage, after), first = await reject(); spy.mockRestore()
  expect(first.status).toBe(stage === 'claim' ? (after ? 200 : 503) : stage === 'final' && after ? 200 : 202)
  const partial = await load(), savedId = partial.supplierRejection?.id
  if (first.status === 202) {
    expect(first.body.processing).toBe(true); expect(partial.status).toBe('deciding')
    expect(partial.supplierRejection.phase).toBe('pending')
    expect((await offer()).status).toBe(409)
    expect((await decide(String(partial.currentOfferId))).status).toBe(409)
  }
  const retry = await reject(); expect(retry.status).toBe(200)
  const r = await finalState(); if (savedId) expect(String(r.supplierRejection.id)).toBe(String(savedId))
})
test('lost actual HTTP response after completion replays 200 with no new effects', async () => {
  await ready(); const wrapper = express()
  wrapper.use((req, res, next) => { const json = res.json; res.json = function (data) {
    if (req.originalUrl.endsWith('/respond') && this.statusCode === 200) { this.destroy(); return this }
    return json.call(this, data)
  }; next() }); wrapper.use(app)
  await expect(request(wrapper).put('/api/rfq/' + id + '/respond').set(auth()).send({ status: 'rejected' })).rejects.toThrow()
  const before = await finalState(); expect((await reject()).status).toBe(200)
  expect((await finalState()).supplierRejection.id).toEqual(before.supplierRejection.id)
})
test('fresh Node recovery after a saved intent completes one message and notice', async () => {
  await ready(); const spy = fault('thread'); expect((await reject()).status).toBe(202); spy.mockRestore()
  await R.updateOne({ _id: id }, { $set: { 'supplierRejection.nextAttemptAt': new Date(0) } })
  const uri = mongo.getUri('r43a_rejection_tests')
  const output = cp.execFileSync(process.execPath, ['-e', `
    const mongoose=require('./node_modules/mongoose');
    (async()=>{const uri=process.env.R43A_TEST_URI;if(!uri.startsWith('mongodb://127.0.0.1:')||[27017,27018].includes(Number(new URL(uri).port)))throw Error('Unsafe test DB');
      await mongoose.connect(uri);const api=require('./services/rfqSupplierRejection');
      const worker=api.createRejectionRecovery();console.log(JSON.stringify(await worker.runOnce()));await worker.stop();await mongoose.disconnect();
    })().catch(e=>{console.error(e.name);process.exitCode=1});
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, R43A_TEST_URI: uri }, encoding: 'utf8', timeout: 30000 })
  expect(JSON.parse(output.trim())).toEqual({ processed: 1, completed: 1, pending: 0 }); await finalState()
})
test.each(['api', 'worker'])('real %s entry point starts recovery and drains it on safe shutdown', async entry => {
  await ready(); const spy = fault('attempt'); expect((await reject()).status).toBe(202); spy.mockRestore()
  await R.updateOne({ _id: id }, { $set: { 'supplierRejection.nextAttemptAt': new Date(0) } })
  const net = require('net'), listener = net.createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  const code = `process.on('message',()=>process.emit('SIGTERM'));${entry === 'api' ? "require('./start')" : "require('./workers/worker').main()"}`
  const child = cp.spawn(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, MONGODB_URI: mongo.getUri('r43a_rejection_tests'), PORT: String(port), JOB_WORKER_MODE: 'external', DISABLE_REDIS: '1' } })
  let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    const until = Date.now() + 20000
    while ((await load()).status !== 'rejected' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50))
    await finalState()
    child.send('stop')
    const outcome = await Promise.race([exited, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(Error('Synthetic child shutdown timeout')), 20000); timer.unref() })])
    expect(outcome).toEqual({ code: 0, signal: null })
    expect(output).toMatch(entry === 'api' ? /API listening/ : /worker_started/)
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill() }
})
test.each([true, false])('concurrent refusals and parallel recovery withOffer=%s create exactly one terminal intent', async withOffer => {
  await ready(withOffer)
  const replies = await Promise.all(Array.from({ length: 8 }, () => reject()))
  expect(replies.every(r => [200, 202].includes(r.status))).toBe(true)
  await Promise.all(Array.from({ length: 5 }, () => completeRejection(id)))
  await finalState(withOffer)
})
test('a slow preflight joins a concurrent refusal even after the thread has closed', async () => {
  await ready()
  const original = T.findOne.bind(T); let used = false, reached, release
  const entered = new Promise(resolve => { reached = resolve }), wait = new Promise(resolve => { release = resolve })
  const spy = jest.spyOn(T, 'findOne').mockImplementation((...args) => {
    if (!used && args[0].status === 'open') {
      used = true
      const promise = (async () => { reached(); await wait; return original(...args).select('_id').lean() })()
      promise.select = promise.lean = () => promise; return promise
    }
    return original(...args)
  })
  const slow = reject().then(r => r); await entered
  expect((await reject()).status).toBe(200); release(); expect((await slow).status).toBe(200)
  spy.mockRestore(); await finalState()
})
function gateClaim(predicate) {
  const original = R.findOneAndUpdate.bind(R)
  let release, reached; const wait = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { reached = resolve })
  let used = false
  const spy = jest.spyOn(R, 'findOneAndUpdate').mockImplementation((...args) => {
    if (!used && predicate(args[1])) {
      used = true
      const promise = (async () => { reached(); await wait; return original(...args).select('+supplierRejection +offerSubmission') })()
      promise.select = () => promise; return promise
    }
    return original(...args)
  })
  return { entered, release, spy }
}
test.each(['offer', 'accept', 'reject'].flatMap(other => [true, false].map(rejectionWins => [other, rejectionWins])))('CAS race with %s, rejectionWins=%s, has one authorized winner', async (other, rejectionWins) => {
  const start = await ready(), offerId = String(start.currentOfferId)
  const gate = gateClaim(u => rejectionWins ? (other === 'offer' ? u.$set?.status === 'offering' : Boolean(u.$set?.decision)) : Boolean(u.$set?.supplierRejection))
  const delayed = (rejectionWins ? (other === 'offer' ? offer() : decide(offerId, other)) : reject()).then(r => r)
  await gate.entered
  const winner = await (rejectionWins ? reject() : other === 'offer' ? offer() : decide(offerId, other))
  expect(winner.status).toBe(200)
  gate.release(); expect((await delayed).status).toBe(409); gate.spy.mockRestore()
  if (rejectionWins) await finalState()
  else {
    const r = await load(); expect(r.supplierRejection).toBeUndefined()
    expect(r.status).toBe(other === 'offer' ? 'responded' : other === 'accept' ? 'accepted' : 'rejected')
  }
})
test('accepted agreement and closed historical RFQs cannot be replaced or inferred', async () => {
  const r = await ready(); expect((await decide(String(r.currentOfferId))).status).toBe(200)
  const before = await R.findById(id).lean(), t = await T.findOne({ rfqId: id }).lean()
  expect((await reject()).status).toBe(409)
  expect(await R.findById(id).lean()).toEqual(before); expect(await T.findOne({ rfqId: id }).lean()).toEqual(t)
  await R.updateOne({ _id: id }, { $unset: { decision: 1 }, $set: { status: 'rejected' } })
  expect((await reject()).status).toBe(409)
  expect(await recoverPendingRejections()).toEqual({ processed: 0, completed: 0, pending: 0 })
})
test('owner and active delegated staff only; revoked staff and expired sessions lose access', async () => {
  await ready()
  expect((await request(app).put('/api/rfq/' + id + '/respond').send({ status: 'rejected' })).status).toBe(401)
  for (const who of ['buyer', 'otherBuyer', 'otherSupplier']) expect((await reject(who)).status).toBe(403)
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: [] } })
  expect((await reject('staff')).status).toBe(403)
  const token = require('jsonwebtoken').sign({ id: String(f.supplier._id), tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: -1 })
  expect((await request(app).put('/api/rfq/' + id + '/respond').set('Authorization', 'Bearer ' + token).send({ status: 'rejected' })).status).toBe(401)
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: ['manage_rfq'] } })
  expect((await reject('staff')).status).toBe(200)
  expect(String((await finalState()).supplierRejection.actor.id)).toBe(String(f.staff._id))
})
test('revoked staff cannot retry, while recovery finishes the previously authorized durable intent', async () => {
  await ready(); const spy = fault('attempt')
  expect((await reject('staff')).status).toBe(202); spy.mockRestore()
  const saved = (await load()).supplierRejection
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: [] } })
  expect((await reject('staff')).status).toBe(403)
  await completeRejection(id)
  const r = await finalState(); expect(String(r.supplierRejection.id)).toBe(String(saved.id))
  expect(String(r.supplierRejection.actor.id)).toBe(String(f.staff._id))
})
test.each([
  { 'supplierRejection.kind': 'other_intent' },
  { 'supplierRejection.supplierId': new mongoose.Types.ObjectId() },
  { 'supplierRejection.buyerId': new mongoose.Types.ObjectId() },
  { 'supplierRejection.actor.role': 'buyer' },
  { decision: { id: new mongoose.Types.ObjectId(), version: 1, phase: 'pending', action: 'reject' } }
])('inconsistent intent %j cannot change an offer, conversation or notification', async changes => {
  await ready(); const spy = fault('attempt'); expect((await reject()).status).toBe(202); spy.mockRestore()
  await R.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: changes })
  const before = { offers: await O.find({ rfqId: id }).lean(), thread: await T.findOne({ rfqId: id }).lean(), notices: await N.find({ resourceId: id }).lean() }
  await expect(completeRejection(id)).rejects.toMatchObject({ code: 'RFQ_SUPPLIER_REJECTION_CONFLICT' })
  expect(await O.find({ rfqId: id }).lean()).toEqual(before.offers)
  expect(await T.findOne({ rfqId: id }).lean()).toEqual(before.thread)
  expect(await N.find({ resourceId: id }).lean()).toEqual(before.notices)
  expect((await load()).status).toBe('deciding')
})
test('a conflicting notification stays pending with a safe code; readAt is preserved on ordinary replay', async () => {
  await ready(); const spy = fault('notice'); expect((await reject()).status).toBe(202); spy.mockRestore()
  const j = (await load()).supplierRejection
  await N.create({ _id: j.id, userId: f.otherBuyer._id, type: 'message_received', resourceType: 'rfq', resourceId: id })
  expect((await reject()).status).toBe(202)
  const r = await load(); expect(r.status).toBe('deciding'); expect(r.supplierRejection.lastErrorCode).toBe('RFQ_SUPPLIER_REJECTION_CONFLICT')
  expect(String((await N.findById(j.id)).userId)).toBe(String(f.otherBuyer._id))
})
test('read notification and completed intent are unchanged by repeated delivery', async () => {
  await ready(); const spy = fault('final'); expect((await reject()).status).toBe(202); spy.mockRestore()
  const j = (await load()).supplierRejection, date = new Date('2026-01-01')
  await N.updateOne({ _id: j.id }, { $set: { readAt: date } })
  expect((await reject()).status).toBe(200); await finalState()
  const before = await N.findById(j.id).lean(); expect(before.readAt).toEqual(date)
  expect((await reject()).status).toBe(200); expect(await N.findById(j.id).lean()).toEqual(before)
})
test('missing/archived conversation stays safe and no legacy conversation is invented', async () => {
  await ready(); await T.deleteOne({ rfqId: id }); expect((await reject()).status).toBe(409)
  expect((await load()).supplierRejection).toBeUndefined(); expect(await T.countDocuments({ rfqId: id })).toBe(0)
})
test('conversation changed after intent remains pending instead of reopening or publishing rejection', async () => {
  await ready(); const spy = fault('thread'); expect((await reject()).status).toBe(202); spy.mockRestore()
  await T.updateOne({ rfqId: id }, { $set: { status: 'archived' } })
  expect((await reject()).status).toBe(202); expect((await load()).status).toBe('deciding')
  expect((await T.findOne({ rfqId: id })).status).toBe('archived')
})
test('an offer changed to accepted after intent is never overwritten and prevents final publication', async () => {
  const r = await ready(); const spy = fault('attempt'); expect((await reject()).status).toBe(202); spy.mockRestore()
  await O.updateOne({ _id: r.currentOfferId }, { $set: { status: 'accepted', decisionId: new mongoose.Types.ObjectId() } })
  const before = await O.findById(r.currentOfferId).lean()
  expect((await reject()).status).toBe(202); expect((await load()).status).toBe('deciding')
  expect(await O.findById(r.currentOfferId).lean()).toEqual(before)
  expect((await T.findOne({ rfqId: id })).status).toBe('open')
  expect(await N.countDocuments({ resourceId: id, type: 'offer_decision' })).toBe(0)
})
test('journal is hidden from public RFQ JSON and progress is supplier-only', async () => {
  await ready(); const spy = fault('attempt'); const pending = await reject(); spy.mockRestore()
  expect(pending.status).toBe(202)
  expect(pending.body.rfq).not.toHaveProperty('supplierRejection')
  expect(pending.body.rejection).toEqual({ version: 1, phase: 'pending' })
  const mine = await request(app).get('/api/rfq/' + id + '/thread').set(auth())
  expect(mine.body.rejection.phase).toBe('pending'); expect(JSON.stringify(mine.body)).not.toContain('claimedRevision')
  const buyer = await request(app).get('/api/rfq/' + id + '/thread').set(auth('buyer'))
  expect(buyer.body.rejection).toBeUndefined(); expect(buyer.body.rfq.supplierRejection).toBeUndefined()
})
test('recovery backs off persistent failures, deduplicates local scans and stops safely', async () => {
  await ready(); const spy = fault('notice', false, true); expect((await reject()).status).toBe(202)
  const errors = [], worker = createRejectionRecovery({ onError: e => errors.push(e), pollMs: 10 })
  await R.updateOne({ _id: id }, { $set: { 'supplierRejection.nextAttemptAt': new Date(0) } })
  const a = worker.runOnce(), b = worker.runOnce(); expect(a).toBe(b)
  expect(await a).toEqual({ processed: 1, completed: 0, pending: 1 })
  const r = await load(); expect(r.status).toBe('deciding'); expect(r.supplierRejection.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  expect(errors.every(e => Object.keys(e).sort().join(',') === 'code,rfqId')).toBe(true)
  spy.mockRestore(); await worker.stop(); expect(await worker.runOnce()).toEqual({ processed: 0, completed: 0, pending: 0 })
  await completeRejection(id); await finalState()
})
test('safe stop drains an in-flight recovery projection before resolving', async () => {
  await ready(); const failure = fault('attempt'); expect((await reject()).status).toBe(202); failure.mockRestore()
  await R.updateOne({ _id: id }, { $set: { 'supplierRejection.nextAttemptAt': new Date(0) } })
  let release, reached; const wait = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { reached = resolve })
  const original = N.updateOne.bind(N), spy = jest.spyOn(N, 'updateOne').mockImplementation(async (...args) => {
    if (args[1].$setOnInsert?.decisionId) { reached(); await wait }
    return original(...args)
  })
  const worker = createRejectionRecovery(), running = worker.runOnce(); await entered
  let stopped = false; const stopping = worker.stop().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve)); expect(stopped).toBe(false)
  release(); expect(await running).toEqual({ processed: 1, completed: 1, pending: 0 }); await stopping
  expect(stopped).toBe(true); spy.mockRestore(); await finalState()
})
