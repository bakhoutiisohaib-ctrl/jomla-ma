const mongoose = require('mongoose'), crypto = require('crypto'), express = require('express'), request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), S = require('../models/SourcingRequest'), N = require('../models/Notification'), Supplier = require('../models/Supplier')
const { definition } = require('../services/sourcingCreationIndex')
const service = require('../services/sourcingDecision'), { recover } = require('../services/sourcingRecovery')
let mongo, f
const auth = who => ({ Authorization: 'Bearer ' + f.tokens[who] }), raw = id => S.findById(id).select('+creationReceipt').lean()
const notices = id => N.find({ resourceId: id, type: 'sourcing_decision' }).lean()
const decide = (id, q, action = 'accept', who = 'buyer', server = app) => request(server).put('/api/sourcing/' + id + '/quotes/' + q + '/action').set(auth(who)).send({ action })
const retry = (id, op, who = 'buyer', body = {}) => request(app).post('/api/sourcing/' + id + '/operations/' + op + '/retry').set(auth(who)).send(body)
const read = (id, who = 'buyer') => request(app).get('/api/sourcing/' + id).set(auth(who))
async function offer(id, who = 'supplier', price = 12) {
  const r = await request(app).post('/api/sourcing/' + id + '/quote').set(auth(who)).set('Idempotency-Key', crypto.randomUUID()).send({ unitPrice: price, deliveryDays: 3, paymentTerms: 'شروط مثبتة', notes: 'عرض اصطناعي' })
  expect(r.status).toBe(200); return r.body.quote._id
}
async function create() {
  const r = await request(app).post('/api/sourcing').set(auth('buyer')).set('Idempotency-Key', crypto.randomUUID()).send({ productName: 'طلب S3 اصطناعي', buyerPhone: '+212655443322', quantity: 100, unit: 'زوج', notes: 'المواصفات الأصلية' })
  expect(r.status).toBe(201); return r.body.sourcing._id
}
function fault(stage, after = false, once = false) {
  const target = stage === 'notification' ? N : S.collection, real = target.updateOne.bind(target); let fired = false
  return jest.spyOn(target, 'updateOne').mockImplementation(async (...args) => {
    const matches = stage === 'notification' || (stage === 'claim' ? args[1].$set?.operation?.kind === 'sourcing_decision' : args[1].$unset?.operation)
    if (matches && (!once || !fired)) { fired = true; if (after) await real(...args); throw Error('Synthetic S3 write failure') }
    return real(...args)
  })
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri(), { autoIndex: false })
  await S.collection.createIndex(definition.key, definition.options); f = await require('./helpers/tradeFixtures')()
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })

test.each(['accept', 'reject'])('%s is durable, naturally idempotent and opposite action conflicts', async action => {
  const id = await create(), q = await offer(id), first = await decide(id, q, action)
  expect(first.status).toBe(200); expect(first.body.processing).toBe(false); expect(first.body.quote.decision.action).toBe(action)
  const before = await raw(id), n = (await notices(id))[0], readAt = new Date(); await N.updateOne({ _id: n._id }, { $set: { readAt } })
  const replay = await decide(id, q, action); expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true)
  expect((await decide(id, q, action === 'accept' ? 'reject' : 'accept')).status).toBe(409)
  expect(await raw(id)).toEqual(before); expect(await notices(id)).toHaveLength(1); expect((await N.findById(n._id)).readAt).toEqual(readAt)
  expect(String(n.userId)).toBe(f.supplier.id)
})
test('reject keeps other quotes active and allows a later acceptance; old receipt never resumes newer operation', async () => {
  const id = await create(), one = await offer(id), two = await offer(id, 'otherSupplier', 15)
  await S.updateOne({ _id: id }, { $set: { status: 'quoted' } })
  expect((await decide(id, one, 'reject')).status).toBe(200)
  let s = await raw(id); expect(s.status).toBe('quoted'); expect(s.quotesCount).toBe(1); expect(s.quotes[1].status).toBe('active')
  const block = fault('notification'); expect((await decide(id, two)).status).toBe(202); block.mockRestore()
  const before = await raw(id), oldId = before.quotes[0].decisionReceipt.id
  expect((await decide(id, one, 'reject')).status).toBe(200); expect((await retry(id, oldId)).status).toBe(200)
  expect(await raw(id)).toEqual(before); expect(await notices(id)).toHaveLength(1)
  expect((await retry(id, before.operation.id)).status).toBe(200); s = await raw(id)
  expect(s.status).toBe('fulfilled'); expect(s.quotesCount).toBe(0); expect(s.quotes.map(q => q.status)).toEqual(['rejected', 'accepted'])
})
test.each(['accept', 'reject'].flatMap(action => ['claim', 'notification', 'publication'].map(stage => [action, stage])))('%s failure BEFORE %s preserves old states and recovers once', async (action, stage) => {
  const id = await create(), q = await offer(id), before = await raw(id), block = fault(stage)
  const first = await decide(id, q, action); expect(first.status).toBe(stage === 'claim' ? 503 : 202)
  const pending = await raw(id); expect(pending.status).toBe(before.status); expect(pending.quotes).toEqual(before.quotes)
  if (stage !== 'claim') expect(pending.operation.kind).toBe('sourcing_decision')
  block.mockRestore(); expect((await decide(id, q, action)).status).toBe(200)
  expect(await notices(id)).toHaveLength(1); expect((await raw(id)).quotes[0].decisionReceipt).toBeDefined()
})
test.each(['accept', 'reject'].flatMap(action => ['claim', 'notification', 'publication'].map(stage => [action, stage])))('%s lost acknowledgement AFTER %s is resolved by primary reread', async (action, stage) => {
  const id = await create(), q = await offer(id); fault(stage, true, true)
  expect((await decide(id, q, action)).status).toBe(200); expect((await decide(id, q, action)).status).toBe(200)
  expect(await notices(id)).toHaveLength(1); expect((await raw(id)).quotes).toHaveLength(1)
})
test('lost real HTTP response returns the original decision and agreement', async () => {
  const id = await create(), q = await offer(id), wrapper = express()
  wrapper.use((req, res, next) => { const json = res.json; res.json = function (body) { if (req.path.endsWith('/action') && this.statusCode === 200) { this.destroy(); return this } return json.call(this, body) }; next() }); wrapper.use(app)
  await expect(decide(id, q, 'accept', 'buyer', wrapper)).rejects.toThrow()
  const before = await raw(id); expect((await decide(id, q)).status).toBe(200); expect(await raw(id)).toEqual(before); expect(await notices(id)).toHaveLength(1)
})
test.each(['accept', 'reject'])('eight simultaneous identical %s decisions produce one receipt and notification', async action => {
  const id = await create(), q = await offer(id), replies = await Promise.all(Array.from({ length: 8 }, () => decide(id, q, action)))
  expect(replies.map(r => r.status)).toEqual(Array(8).fill(200)); expect(await notices(id)).toHaveLength(1)
})
test.each(['same', 'different'])('competing accept/reject decisions (%s quote) have one winning CAS', async mode => {
  const id = await create(), one = await offer(id), two = mode === 'same' ? one : await offer(id, 'otherSupplier', 15)
  const replies = await Promise.all([decide(id, one), decide(id, two, mode === 'same' ? 'reject' : 'accept')])
  expect(replies.map(r => r.status).sort()).toEqual([200, 409]); const s = await raw(id)
  expect(s.status).toBe('fulfilled'); expect(s.quotes.filter(q => q.status === 'accepted')).toHaveLength(1); expect(s.quotesCount).toBe(0); expect(await notices(id)).toHaveLength(1)
})
test('pending decision blocks replacement, another decision and unauthorized retries; saved action overrides retry body', async () => {
  const id = await create(), q = await offer(id), two = await offer(id, 'otherSupplier', 15), block = fault('notification')
  expect((await decide(id, q, 'reject')).status).toBe(202); const before = await raw(id), op = before.operation
  expect((await decide(id, q, 'accept')).body.code).toBe('SOURCING_DECISION_ACTION_CONFLICT')
  expect((await decide(id, two)).body.code).toBe('SOURCING_OPERATION_PENDING')
  const replacement = await request(app).post('/api/sourcing/' + id + '/quote').set(auth('supplier')).set('Idempotency-Key', crypto.randomUUID()).send({ unitPrice: 13, deliveryDays: 3 })
  expect(replacement.status).toBe(409)
  for (const who of ['supplier', 'staff', 'otherSupplier', 'otherBuyer']) expect((await retry(id, op.id, who)).status).toBe(403)
  block.mockRestore(); expect((await retry(id, op.id, 'buyer', { action: 'accept', unitPrice: 1 })).status).toBe(200)
  const s = await raw(id); expect(s.quotes.map(q => q.status)).toEqual(['rejected', 'active']); expect(s.status).toBe('open')
})
test('buyer cannot resume an offer operation and wrong buyer cannot decide', async () => {
  const id = await create(), q = await offer(id), block = fault('notification')
  await request(app).post('/api/sourcing/' + id + '/quote').set(auth('supplier')).set('Idempotency-Key', crypto.randomUUID()).send({ unitPrice: 13, deliveryDays: 3 })
  const s = await raw(id); expect((await retry(id, s.operation.id, 'buyer')).status).toBe(403)
  expect((await decide(id, q, 'accept', 'otherBuyer')).status).toBe(403); expect((await decide(id, q, 'accept', 'supplier')).status).toBe(403)
  block.mockRestore(); expect((await retry(id, s.operation.id, 'supplier')).status).toBe(200)
})
test('S2 agreement uses original snapshot after root edits, and remains fixed on replay', async () => {
  const id = await create(), q = await offer(id)
  await S.updateOne({ _id: id }, { $set: { productName: 'تغيير لاحق', quantity: 500, unit: 'صندوق', notes: 'تغيير المواصفات' } })
  const r = await decide(id, q); expect(r.status).toBe(200)
  expect(r.body.quote.agreement).toMatchObject({ source: 's2_commercial_snapshot', snapshot: { request: { productName: 'طلب S3 اصطناعي', quantity: 100, unit: 'زوج' }, offer: { unitPrice: 12, totalPrice: 1200, currency: 'MAD' } } })
  await S.updateOne({ _id: id }, { $set: { productName: 'تغيير آخر', quantity: 600 } })
  expect((await decide(id, q)).body.quote.agreement).toEqual(r.body.quote.agreement)
})
test('a legacy active quote gets an explicit new-decision source; unknown historical fields survive', async () => {
  const id = await create(), q = new mongoose.Types.ObjectId()
  await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { legacyRoot: 'keep', quotesCount: 1, quotes: [{ _id: q, ...{ supplierId: f.supplier._id, actorId: f.supplier._id, supplierName: f.supplier.name, unitPrice: 9, currency: 'MAD', deliveryDays: 2, status: 'active', legacyTerms: 'keep' } }] } })
  const r = await decide(id, q); expect(r.status).toBe(200); expect(r.body.quote.agreement.source).toBe('legacy_sourcing_quote_at_decision')
  const s = await raw(id); expect(s.legacyRoot).toBe('keep'); expect(s.quotes[0].legacyTerms).toBe('keep')
})
test.each(['accepted', 'rejected'])('historical %s quote without receipt is untouched and never gets a retrospective notification', async status => {
  const id = await create(), q = await offer(id)
  await S.updateOne({ _id: id }, { $set: { 'quotes.0.status': status, status: status === 'accepted' ? 'fulfilled' : 'open', quotesCount: 0 } })
  const before = await raw(id); expect((await decide(id, q, status === 'accepted' ? 'accept' : 'reject')).status).toBe(409)
  expect(await raw(id)).toEqual(before); expect(await notices(id)).toHaveLength(0)
})
test('decision DTOs hide journal, receipts, buyer contact and competitors, including after acceptance', async () => {
  const id = await create(), q = await offer(id); await offer(id, 'otherSupplier', 15)
  const block = fault('publication'); expect((await decide(id, q)).status).toBe(202); block.mockRestore()
  const s = await raw(id), buyer = (await read(id)).body, supplier = (await read(id, 'supplier')).body, competitor = (await read(id, 'otherSupplier')).body
  expect(buyer.decisionRecovery).toMatchObject({ action: 'accept', quoteId: q }); expect(supplier.decisionRecovery).toBeUndefined(); expect(competitor.quotes).toHaveLength(1)
  expect(supplier.offerRecovery).toBeUndefined(); expect(supplier.buyerPhone).toBeUndefined(); expect(supplier.buyerId).toBeUndefined()
  expect(JSON.stringify(buyer)).not.toMatch(/baselineHash|notificationId|decisionReceipt|creationReceipt|submission|lastErrorCode|"hash"|"key"/)
  expect((await retry(id, s.operation.id)).status).toBe(200)
  const after = (await read(id, 'supplier')).body; expect(after.quotes).toHaveLength(1); expect(after.buyerPhone).toBeUndefined(); expect(after.buyerId).toBeUndefined()
  expect(after.quotes[0].agreement.snapshot.request.buyerId).toBeUndefined(); expect(after.quotes[0].agreement.snapshot.request.quantity).toBe(100)
  const transformed = (await S.findById(id)).toJSON(); expect(transformed.quotes[0].decisionReceipt).toBeUndefined(); expect(transformed.quotes[0].agreement.snapshot.request.buyerId).toBeUndefined()
})
test.each(['price', 'buyer', 'kind', 'version'])('contradictory %s intent stays pending without a new effect', async field => {
  const id = await create(), q = await offer(id), block = fault('notification'); expect((await decide(id, q)).status).toBe(202); block.mockRestore()
  const s = await raw(id), path = { price: 'operation.commercialSnapshot.offer.unitPrice', buyer: 'operation.actor.id', kind: 'operation.kind', version: 'operation.version' }[field]
  await S.collection.updateOne({ _id: s._id }, { $set: { [path]: field === 'price' ? 1 : field === 'buyer' ? f.otherBuyer._id : field === 'kind' ? 'sourcing_offer' : 7 } })
  const r = await service.resume(id, s.operation.id); expect(r.processing).toBe(true)
  expect((await raw(id)).quotes[0].status).toBe('active'); expect(await notices(id)).toHaveLength(0)
})
test.each(['userId', 'type', 'resourceId', 'createdAt'])('a mismatched notification %s cannot finalize the decision', async field => {
  const id = await create(), q = await offer(id), block = fault('publication'); expect((await decide(id, q)).status).toBe(202); block.mockRestore()
  const s = await raw(id), notice = (await notices(id))[0], original = notice[field]
  await N.collection.updateOne({ _id: notice._id }, { $set: { [field]: field === 'type' ? 'sourcing_offer' : field === 'createdAt' ? new Date(0) : new mongoose.Types.ObjectId() } })
  expect((await retry(id, s.operation.id)).status).toBe(202); expect((await raw(id)).quotes[0].status).toBe('active')
  await N.collection.updateOne({ _id: notice._id }, { $set: { [field]: original, readAt: new Date(123456) } })
  expect((await retry(id, s.operation.id)).status).toBe(200); expect((await N.findById(notice._id)).readAt).toEqual(new Date(123456))
})
test('revoked buyer cannot resume; worker holds the intent without effects', async () => {
  const id = await create(), q = await offer(id), block = fault('notification'); await decide(id, q); block.mockRestore()
  const s = await raw(id); await Supplier.updateOne({ _id: f.buyer._id }, { $set: { isActive: false } })
  try { expect([401, 403]).toContain((await retry(id, s.operation.id)).status); expect((await service.resume(id, s.operation.id)).processing).toBe(true); expect(await notices(id)).toHaveLength(0) }
  finally { await Supplier.updateOne({ _id: f.buyer._id }, { $set: { isActive: true } }) }
  expect((await retry(id, s.operation.id)).status).toBe(200)
})
test('unsafe BSON size rejects before intent or notification and never deletes history', async () => {
  const id = await create(), q = await offer(id), before = await raw(id)
  await S.collection.updateOne({ _id: before._id }, { $set: { legacyPadding: 'x'.repeat(16 * 1024 * 1024 - 256 * 1024) } })
  // The root fits BSON but the conservative operation + receipt + agreement budget does not.
  const r = await decide(id, q); expect(r.status).toBe(413)
  const s = await raw(id); expect(s.operation).toBeUndefined(); expect(s.quotes).toEqual(before.quotes); expect(await notices(id)).toHaveLength(0)
})
test('post-claim BSON growth is held before notification; no timeout clears intent', async () => {
  const id = await create(), q = await offer(id), block = fault('notification'); await decide(id, q); block.mockRestore()
  const s = await raw(id); await S.collection.updateOne({ _id: s._id }, { $set: { legacyPadding: 'x'.repeat(16 * 1024 * 1024 - 256 * 1024) } })
  expect((await retry(id, s.operation.id)).status).toBe(202); expect(await notices(id)).toHaveLength(0); expect((await raw(id)).operation.id).toEqual(s.operation.id)
})
test('BSON growth after notification cannot publish an oversized receipt/agreement', async () => {
  const id = await create(), q = await offer(id), real = N.updateOne.bind(N)
  const block = jest.spyOn(N, 'updateOne').mockImplementationOnce(async (...args) => {
    const r = await real(...args); await S.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { legacyPadding: 'x'.repeat(16 * 1024 * 1024 - 256 * 1024) } }); return r
  })
  expect((await decide(id, q)).status).toBe(202); block.mockRestore(); const s = await raw(id)
  expect(s.quotes[0].status).toBe('active'); expect(s.quotes[0].decisionReceipt).toBeUndefined(); expect(await notices(id)).toHaveLength(1)
  // Test-only repair of synthetic injected growth; no production cleanup is run.
  await S.collection.updateOne({ _id: s._id }, { $unset: { legacyPadding: 1 } })
  expect((await retry(id, s.operation.id)).status).toBe(200); expect(await notices(id)).toHaveLength(1)
})
test('a new offer and decision after rejection preserve all earlier receipts', async () => {
  const id = await create(), q = await offer(id); await decide(id, q, 'reject'); const before = (await raw(id)).quotes[0]
  const next = await offer(id, 'supplier', 13); expect((await decide(id, next)).status).toBe(200)
  expect((await raw(id)).quotes[0]).toEqual(before); expect((await decide(id, q, 'reject')).status).toBe(200); expect(await notices(id)).toHaveLength(2)
})
test('read outage after publication replays a receipt without effects on recovery', async () => {
  const id = await create(), q = await offer(id), update = S.collection.updateOne.bind(S.collection), find = S.findById.bind(S); let published = false
  jest.spyOn(S.collection, 'updateOne').mockImplementation(async (...args) => { const r = await update(...args); if (args[1].$unset?.operation) published = true; return r })
  const block = jest.spyOn(S, 'findById').mockImplementation((...args) => { if (published) throw Error('Synthetic read loss'); return find(...args) })
  expect((await decide(id, q)).status).toBe(503); block.mockRestore(); expect((await decide(id, q)).status).toBe(200); expect(await notices(id)).toHaveLength(1)
})
test('worker dispatch respects kind/version, bounded batch and backoff for both protocols', async () => {
  const id = await create(), q = await offer(id), block = fault('notification'); await decide(id, q); block.mockRestore()
  const s = await raw(id); await S.updateOne({ _id: id }, { $set: { 'operation.nextAttemptAt': new Date(0) } })
  const result = await recover({ limit: 100, now: new Date(Date.now() + 100000) }); expect(result.completed).toBeGreaterThan(0)
  expect((await raw(id)).operation).toBeUndefined(); expect(await notices(id)).toHaveLength(1)
  expect((await retry(id, s.operation.id)).status).toBe(200)
})

// These children receive only the isolated URI and no original .env file.
const childSource = `const p=require('path'),m=require(p.join(process.env.S3_BACKEND,'node_modules/mongoose'));const address=new URL(process.env.S3_URI);if(address.protocol!=='mongodb:'||address.hostname!=='127.0.0.1'||!address.port||['27017','27018'].includes(address.port))throw Error('Unsafe test URI');process.env.MONGODB_URI=process.env.S3_URI;process.on('message',message=>{if(message==='shutdown')process.emit('SIGTERM')});(async()=>{if(['api','worker'].includes(process.env.S3_MODE)){require(p.join(process.env.S3_BACKEND,process.env.S3_MODE==='api'?'start.js':'workers/worker.js'))[process.env.S3_MODE==='worker'?'main':'unused']?.();return}await m.connect(process.env.S3_URI,{autoIndex:false});const S=require(p.join(process.env.S3_BACKEND,'models/SourcingRequest')),service=require(p.join(process.env.S3_BACKEND,'services/sourcingDecision'));if(process.env.S3_MODE==='crash'){const target=process.env.S3_STAGE==='notification'?require(p.join(process.env.S3_BACKEND,'models/Notification')):S.collection;const update=target.updateOne.bind(target);target.updateOne=async(...args)=>{const result=await update(...args);if(process.env.S3_STAGE==='notification'||(process.env.S3_STAGE==='publication'?args[1].$unset?.operation:args[1].$set?.operation?.kind==='sourcing_decision'))process.exit(0);return result};await service.decide({params:{id:process.env.S3_PARENT,quoteId:process.env.S3_QUOTE},body:{action:'accept'},supplier:JSON.parse(process.env.S3_ACTOR)})}else if(process.env.S3_MODE==='replay'){const result=await service.decide({params:{id:process.env.S3_PARENT,quoteId:process.env.S3_QUOTE},body:{action:'accept'},supplier:JSON.parse(process.env.S3_ACTOR)});if(result.processing)throw Error('Incomplete replay');await m.disconnect();process.exit(0)}else{const s=await S.findById(process.env.S3_PARENT).lean(),op=s.operation?.id;if(!op)throw Error('Missing pending decision');process.send('ready');await new Promise(resolve=>process.once('message',resolve));const r=await service.resume(s._id,op);if(r.processing)throw Error('Still pending');await m.disconnect();process.exit(0)}})().catch(()=>process.exit(1))`
function child(mode, id, q, stage = 'claim', port = 0) {
  const cp = require('child_process'), path = require('path'), fs = require('fs')
  const env = { ...process.env, S3_BACKEND: path.resolve(__dirname, '..'), S3_URI: mongo.getUri(), S3_MODE: mode, S3_PARENT: id,
    S3_QUOTE: String(q), S3_STAGE: stage, S3_ACTOR: JSON.stringify({ id: f.buyer.id, role: 'buyer', name: f.buyer.name }), JOB_WORKER_MODE: 'external', PORT: String(port), DISABLE_REDIS: '1' }
  const log = fs.openSync(path.join(process.env.R41_OUTPUT, 'results', 's3-node-' + mode + '-' + crypto.randomUUID() + '.log'), 'wx')
  const processChild = cp.spawn(process.execPath, ['-e', childSource], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', log, log, 'ipc'] })
  const exited = new Promise(resolve => processChild.once('exit', code => { fs.closeSync(log); resolve(code) }))
  return { process: processChild, exited }
}
async function waitFor(predicate, timeout = 30000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw Error('Isolated decision recovery timed out')
}
test('a real Node exit after reservation is recovered by two independent completers', async () => {
  const id = await create(), q = await offer(id), writer = child('crash', id, q)
  expect(await writer.exited).toBe(0); expect((await raw(id)).quotes[0].status).toBe('active'); expect(await notices(id)).toHaveLength(0)
  const one = child('barrier', id, q), two = child('barrier', id, q)
  await Promise.all([one, two].map(c => new Promise(resolve => c.process.once('message', resolve))))
  one.process.send('go'); two.process.send('go'); expect(await one.exited).toBe(0); expect(await two.exited).toBe(0)
  expect((await decide(id, q)).status).toBe(200); expect(await notices(id)).toHaveLength(1)
})
test.each(['notification', 'publication'])('Node exit after %s replays the fixed decision without duplicating its effect', async stage => {
  const id = await create(), q = await offer(id), writer = child('crash', id, q, stage); expect(await writer.exited).toBe(0)
  const s = await raw(id); expect(s.quotes[0].status).toBe(stage === 'publication' ? 'accepted' : 'active')
  const n = (await notices(id))[0], readAt = new Date(); await N.updateOne({ _id: n._id }, { $set: { readAt } })
  const replayer = child('replay', id, q); expect(await replayer.exited).toBe(0); expect(await notices(id)).toHaveLength(1)
  expect((await N.findById(n._id)).readAt).toEqual(readAt); expect((await raw(id)).operation).toBeUndefined()
})
test.each(['api', 'worker'])('real %s entry point dispatches a persisted decision after restart and shuts down safely', async mode => {
  const id = await create(), q = await offer(id), block = fault('notification'); await decide(id, q); block.mockRestore()
  await S.updateOne({ _id: id }, { $set: { 'operation.nextAttemptAt': new Date(0) } })
  const port = await new Promise(resolve => { const server = require('net').createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) }) })
  const running = child(mode, id, q, 'claim', port)
  try { await waitFor(async () => !(await raw(id)).operation); expect((await raw(id)).quotes[0].status).toBe('accepted'); expect(await notices(id)).toHaveLength(1) }
  finally {
    running.process.send('shutdown'); let timer; const code = await Promise.race([running.exited, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 20000) })]); clearTimeout(timer)
    if (code === 'timeout') running.process.kill(); expect(code).toBe(0)
  }
})


test('expiry pauses recovery without releasing decision intent; explicit retry preserves one notice', async () => {
  const id = await create(), q = await offer(id), block = fault('publication')
  expect((await decide(id, q)).status).toBe(202); block.mockRestore()
  const before = await raw(id)
  await S.updateOne({ _id: id }, { $set: { 'operation.expiresAt': new Date(0) } })
  await recover()
  const held = await raw(id); expect(held.operation.recoveryPausedAt).toBeTruthy()
  expect(String(held.operation.id)).toBe(String(before.operation.id)); expect(held.quotes[0].status).toBe('active')
  expect((await decide(id, q, 'reject')).status).toBe(409)
  expect((await retry(id, held.operation.id)).status).toBe(200)
  expect(await notices(id)).toHaveLength(1); expect((await raw(id)).operation).toBeUndefined()
})
