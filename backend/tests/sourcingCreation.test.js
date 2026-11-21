process.env.JWT_SECRET = 'sourcing-s1-synthetic-test-secret'
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const crypto = require('crypto')
const cp = require('child_process')
const path = require('path')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Sourcing = require('../models/SourcingRequest')
const Notification = require('../models/Notification')
const fixtures = require('./helpers/tradeFixtures')
const { definition, matches } = require('../services/sourcingCreationIndex')
const { run: indexProcedure } = require('../scripts/sourcingCreationIndex')
let mongo, f
const key = () => crypto.randomUUID()
const body = { productName: 'منتج اصطناعي S1', buyerPhone: '+212655443322', quantity: 100, unit: 'زوج', notes: 'بيانات اختبار فقط' }
const auth = who => ({ Authorization: 'Bearer ' + f.tokens[who] })
const post = (id, input = body, who = 'buyer', server = app) => request(server).post('/api/sourcing').set(auth(who)).set('Idempotency-Key', id).send(input)
const lookup = (id, who = 'buyer') => request(app).get('/api/sourcing/creation-result').set(auth(who)).set('Idempotency-Key', id)
const count = id => Sourcing.countDocuments({ buyerId: f.buyer._id, 'creationReceipt.key': id })
const provision = () => Sourcing.collection.createIndex(definition.key, definition.options)
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri(), { autoIndex: false })
  await Sourcing.createCollection()
  await provision()
  f = await fixtures()
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

test.each([null, '', 'short', 'a'.repeat(129), 'bad key with spaces', 'a'.repeat(16) + '!'])('missing/invalid required key %p is rejected before insertion', async id => {
  const before = await Sourcing.countDocuments()
  const call = request(app).post('/api/sourcing').set(auth('buyer'))
  if (id !== null) call.set('Idempotency-Key', id)
  expect((await call.send(body)).status).toBe(400)
  expect(await Sourcing.countDocuments()).toBe(before)
})
test('same normalized accepted inputs replay; ignored mass-assignment fields cannot affect identity', async () => {
  const id = key(), first = await post(id, { ...body, productName: '  ' + body.productName + '  ', quantity: '100', targetPrice: '' })
  const retry = await post(id, { ...body, targetPrice: null, buyerName: 'forged', buyerId: f.otherBuyer.id, status: 'closed', quotes: [{}] })
  expect(first.status).toBe(201); expect(retry.status).toBe(200)
  expect(retry.body.sourcing._id).toBe(first.body.sourcing._id)
  expect(retry.body.sourcing.buyerId).toBe(f.buyer.id)
  expect(retry.body.sourcing.quotes).toEqual([])
  expect(await count(id)).toBe(1)
})
test.each([{ quantity: 101 }, { notes: 'different' }, { targetPrice: 2 }, { unit: 'صندوق' }, { buyerPhone: '+212611223344' }])('same key with changed accepted input %p returns 409', async change => {
  const id = key(); expect((await post(id)).status).toBe(201)
  const conflict = await post(id, { ...body, ...change })
  expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('SOURCING_CREATION_KEY_CONFLICT')
  expect(await count(id)).toBe(1)
})
test('a new key permits identical independent requests', async () => {
  const first = await post(key()), second = await post(key())
  expect(first.status).toBe(201); expect(second.status).toBe(201)
  expect(second.body.sourcing._id).not.toBe(first.body.sourcing._id)
})
test('the same key is independently scoped to each buyer; lookup enforces ownership and role', async () => {
  const id = key(); expect((await lookup(id, 'otherBuyer')).status).toBe(404)
  const first = await post(id)
  expect((await lookup(id, 'otherBuyer')).status).toBe(404)
  expect((await lookup(id, 'supplier')).status).toBe(403)
  expect((await request(app).get('/api/sourcing/creation-result')).status).toBe(401)
  const second = await post(id, body, 'otherBuyer')
  expect(second.status).toBe(201); expect(second.body.sourcing._id).not.toBe(first.body.sourcing._id)
  expect((await lookup(id)).body.sourcing._id).toBe(first.body.sourcing._id)
})
test('failure before insertion remains unconfirmed; same-key retry safely creates once', async () => {
  const id = key()
  jest.spyOn(Sourcing.prototype, 'save').mockRejectedValueOnce(new Error('synthetic pre-insert failure'))
  const result = await post(id)
  expect(result.status).toBe(503); expect(result.body.code).toBe('SOURCING_CREATION_UNCONFIRMED')
  expect(await count(id)).toBe(0); expect((await lookup(id)).status).toBe(404)
  expect((await post(id)).status).toBe(201); expect(await count(id)).toBe(1)
})
test('lost write acknowledgement after insertion is recovered by reading the actual receipt', async () => {
  const id = key(), save = Sourcing.prototype.save
  jest.spyOn(Sourcing.prototype, 'save').mockImplementationOnce(async function (...args) { await save.apply(this, args); throw new Error('synthetic lost acknowledgement') })
  const result = await post(id)
  expect(result.status).toBe(200); expect(result.body.replayed).toBe(true)
  expect((await post(id)).body.sourcing._id).toBe(result.body.sourcing._id)
  expect(await count(id)).toBe(1)
})
test('an unrelated E11000 without the owner receipt is never reported as success or leaked', async () => {
  const id = key()
  jest.spyOn(Sourcing.prototype, 'save').mockRejectedValueOnce(Object.assign(new Error('E11000 secret ' + id), { code: 11000 }))
  const result = await post(id)
  expect(result.status).toBe(503); expect(result.text).not.toContain(id); expect(result.text).not.toContain('E11000')
  expect(await count(id)).toBe(0)
})
test('a real unrelated unique-index violation is not a creation receipt', async () => {
  const input = { ...body, productName: 's1_unique_collision_fixture' }, firstKey = key(), secondKey = key()
  await Sourcing.collection.createIndex({ productName: 1 }, { name: 's1_disposable_collision', unique: true,
    partialFilterExpression: { productName: input.productName } })
  try {
    expect((await post(firstKey, input)).status).toBe(201)
    const result = await post(secondKey, input)
    expect(result.status).toBe(503); expect(result.text).not.toContain(secondKey)
    expect(await count(secondKey)).toBe(0); expect((await lookup(secondKey)).status).toBe(404)
  } finally { await Sourcing.collection.dropIndex('s1_disposable_collision') }
  expect((await post(secondKey, input)).status).toBe(201)
  expect(await count(secondKey)).toBe(1)
})

test('read failure after a successful insert remains unconfirmed and is recoverable later', async () => {
  const id = key(), find = Sourcing.find.bind(Sourcing)
  jest.spyOn(Sourcing, 'find').mockImplementationOnce((...args) => find(...args)).mockImplementationOnce(() => { throw new Error('synthetic read outage') })
  expect((await post(id)).status).toBe(503)
  expect(await count(id)).toBe(1)
  expect((await post(id)).status).toBe(200)
  expect(await count(id)).toBe(1)
})
test('lost HTTP response after successful insertion cannot cause a second request', async () => {
  const id = key(), wrapper = express()
  wrapper.use((req, res, next) => {
    const json = res.json
    res.json = function (data) { if (req.method === 'POST' && this.statusCode === 201) { this.destroy(); return this } return json.call(this, data) }
    next()
  }); wrapper.use(app)
  await expect(post(id, body, 'buyer', wrapper)).rejects.toThrow()
  expect(await count(id)).toBe(1)
  const retry = await post(id)
  expect(retry.status).toBe(200); expect(await count(id)).toBe(1)
})
test('concurrent requests use the database unique index and return exactly one document', async () => {
  const id = key(), results = await Promise.all(Array.from({ length: 8 }, () => post(id)))
  expect(results.every(result => [200, 201].includes(result.status))).toBe(true)
  expect(new Set(results.map(result => result.body.sourcing._id)).size).toBe(1)
  expect(await count(id)).toBe(1)
})
test('concurrent different payloads cannot share a receipt', async () => {
  const id = key(), results = await Promise.all([post(id), post(id, { ...body, quantity: 101 })])
  expect(results.map(result => result.status).sort()).toEqual([201, 409])
  expect(await count(id)).toBe(1)
})
test('creation replay/lookup never reopen an accepted request or alter its quotes, revision or notifications', async () => {
  const id = key(), first = await post(id), resource = first.body.sourcing._id
  // S1 deliberately does NOT mandate a key on quote submissions.
  const offer = await request(app).post('/api/sourcing/' + resource + '/quote').set(auth('supplier')).set('Idempotency-Key', key()).send({ unitPrice: 25, deliveryDays: 3 })
  expect(offer.status).toBe(200)
  expect((await request(app).put('/api/sourcing/' + resource + '/quotes/' + offer.body.quote._id + '/action').set(auth('buyer')).send({ action: 'accept' })).status).toBe(200)
  const before = await Sourcing.collection.findOne({ _id: new mongoose.Types.ObjectId(resource) })
  const notifications = await Notification.countDocuments({ resourceId: resource })
  expect((await post(id)).body.sourcing.status).toBe('fulfilled')
  expect((await lookup(id)).body.sourcing.status).toBe('fulfilled')
  expect(await Sourcing.collection.findOne({ _id: before._id })).toEqual(before)
  expect(await Notification.countDocuments({ resourceId: resource })).toBe(notifications)
})
test('closed requests are returned in their current state without writes', async () => {
  const id = key(), first = await post(id)
  await Sourcing.updateOne({ _id: first.body.sourcing._id }, { $set: { status: 'closed' } })
  expect((await post(id)).body.sourcing.status).toBe('closed')
  expect((await lookup(id)).body.sourcing.status).toBe('closed')
})
test('all creation, lookup, buyer and supplier DTOs hide receipts; legacy records remain untouched', async () => {
  const id = key(), first = await post(id), resource = first.body.sourcing._id
  const legacy = await Sourcing.create({ ...body, buyerId: f.buyer.id, buyerName: f.buyer.name })
  const stored = await Sourcing.findById(resource).select('+creationReceipt')
  expect(stored.creationReceipt.key).toBe(id)
  expect(stored.toJSON().creationReceipt).toBeUndefined(); expect(stored.toObject().creationReceipt).toBeUndefined()
  for (const response of [first, await post(id), await lookup(id), await request(app).get('/api/sourcing/buyer').set(auth('buyer')),
    await request(app).get('/api/sourcing/' + resource).set(auth('buyer')),
    await request(app).get('/api/sourcing/' + resource).set(auth('supplier')),
    await request(app).get('/api/sourcing').set(auth('supplier'))]) {
    expect(response.text).not.toContain('creationReceipt'); expect(response.text).not.toContain(id)
    expect(response.text).not.toContain(stored.creationReceipt.hash)
  }
  expect((await Sourcing.collection.findOne({ _id: legacy._id })).creationReceipt).toBeUndefined()
})
test('a new Node process resumes the same attempt after the writer exits immediately after durable save', async () => {
  const id = key(), uri = mongo.getUri(), backend = path.resolve(__dirname, '..')
  const source = "(async function(){const p=require('path'),m=require(p.join(process.env.S1_BACKEND,'node_modules/mongoose'));const uri=process.env.S1_URI,address=new URL(uri);if(address.protocol!=='mongodb:'||address.hostname!=='127.0.0.1'||!address.port||['27017','27018'].includes(address.port))throw Error('Unsafe DB');await m.connect(uri,{autoIndex:false});const S=require(p.join(process.env.S1_BACKEND,'models/SourcingRequest'));if(process.env.S1_CRASH==='yes'){const save=S.prototype.save;S.prototype.save=async function(...args){await save.apply(this,args);process.exit(0)}}const service=require(p.join(process.env.S1_BACKEND,'services/sourcingCreation'));const result=await service.create({get:()=>process.env.S1_KEY,body:JSON.parse(process.env.S1_BODY),supplier:{id:process.env.S1_BUYER,name:'Synthetic buyer'}});console.log(JSON.stringify({id:String(result.sourcing._id),replayed:result.replayed}));await m.disconnect()})().catch(()=>process.exit(1))"
  const env = { ...process.env, S1_BACKEND: backend, S1_URI: uri, S1_KEY: id, S1_BODY: JSON.stringify(body), S1_BUYER: f.buyer.id, S1_CRASH: 'yes' }
  cp.execFileSync(process.execPath, ['-e', source], { env, timeout: 30000 })
  expect(await count(id)).toBe(1)
  const second = JSON.parse(cp.execFileSync(process.execPath, ['-e', source], { env: { ...env, S1_CRASH: 'no' }, encoding: 'utf8', timeout: 30000 }))
  expect(second.replayed).toBe(true); expect((await post(id)).body.sourcing._id).toBe(second.id)
  expect(await count(id)).toBe(1)
})
test.each([
  ['missing', null],
  ['non-unique', { key: definition.key, options: { ...definition.options, unique: false } }],
  ['wrong key', { key: { buyerId: -1, 'creationReceipt.key': 1 }, options: definition.options }],
  ['wrong collation', { key: definition.key, options: { ...definition.options, collation: { locale: 'en', strength: 2 } } }],
  ['wrong partial filter', { key: definition.key, options: { ...definition.options, partialFilterExpression: { 'creationReceipt.key': { $exists: true } } } }],
  ['wrong name', { key: definition.key, options: { ...definition.options, name: 'unapproved_sourcing_index' } }]
])('autoIndex=false and %s index fail closed without silently provisioning or inserting', async (name, alternative) => {
  const id = key(); await Sourcing.collection.dropIndex(definition.options.name)
  let created = false
  try {
    if (alternative) { await Sourcing.collection.createIndex(alternative.key, alternative.options); created = true }
    const result = await post(id)
    expect(result.status).toBe(503); expect(result.body.code).toBe('SOURCING_CREATION_INDEX_REQUIRED')
    expect(await count(id)).toBe(0)
    const indexes = await Sourcing.collection.indexes()
    expect(indexes.some(matches)).toBe(false)
    if (alternative && name !== 'wrong name') expect((await indexProcedure({ uri: mongo.getUri(), database: mongoose.connection.name, create: true })).ready).toBe(false)
  } finally {
    if (created) await Sourcing.collection.dropIndex(alternative.options.name)
    await provision()
  }
})
test('operator procedure defaults to inspect only, refuses wrong database, and creates solely on explicit request in a disposable DB', async () => {
  const database = 's1_operator_disposable', uri = mongo.getUri(database)
  expect(await indexProcedure({ uri, database })).toEqual({ ready: false, created: false })
  await expect(indexProcedure({ uri, database: 'not_the_selected_database', create: true })).rejects.toThrow('confirmation')
  expect(await indexProcedure({ uri, database, create: true })).toEqual({ ready: true, created: true })
  expect(await indexProcedure({ uri, database })).toEqual({ ready: true, created: false })
})
test('application autoIndex cannot provision the deferred index via the model definition', () => {
  expect(Sourcing.schema.indexes().some(([, options]) => options.name === definition.options.name)).toBe(false)
})

test('keys use exact binary comparison rather than text similarity or case folding', async () => {
  const id = 's1_CaseSensitive_' + key(), first = await post(id), second = await post(id.toLowerCase())
  expect(first.status).toBe(201); expect(second.status).toBe(201)
  expect(first.body.sourcing._id).not.toBe(second.body.sourcing._id)
})
