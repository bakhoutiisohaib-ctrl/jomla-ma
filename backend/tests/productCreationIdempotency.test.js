// Independent R1 integration checks: real standalone MongoDB and HTTP routes.
// Only post-write side-effect boundaries are fault-injected.
process.env.JWT_SECRET = 'r1-product-creation-isolated-test-secret'
const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const BackgroundJob = require('../models/BackgroundJob')
const { generateToken } = require('../middleware/auth')

const app = express()
app.use(express.json())
app.use('/api/products', require('../routes/products'))
app.use((error, req, res, next) => res.status(error.status || (error.name === 'ValidationError' ? 400 : 500)).json({ message: error.message, code: error.code }))

let mongo, owner, outsider, buyer, staff, organization, membership
let tokens
let sequence = 0
const key = () => 'r1-operation-' + String(++sequence).padStart(12, '0')
const draft = (extra = {}) => ({ name: 'R1 isolated private draft', isDraft: true, hasImageRights: false, moq: 1, availability: 'unknown', priceTiers: [], ...extra })
const post = (body, identity, who = 'owner') => {
  const pending = request(app).post('/api/products').set('Authorization', 'Bearer ' + tokens[who])
  if (identity !== undefined) pending.set('Idempotency-Key', identity)
  return pending.send(body)
}
const mine = who => request(app).get('/api/products/mine').set('Authorization', 'Bearer ' + tokens[who])
const edit = (id, body) => request(app).put('/api/products/' + id).set('Authorization', 'Bearer ' + tokens.owner).send(body)
const jobsFor = id => BackgroundJob.find({ type: 'visual_index_product', 'payload.productId': String(id) }).select('+idempotencyKey +payloadHash +payload')
const temporaryFailure = () => Object.assign(new Error('R1 synthetic boundary failure'), { code: 'R1_SYNTHETIC_FAILURE' })

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri())
  await Promise.all([Product.init(), BackgroundJob.init()])
  ;[owner, outsider, buyer, staff] = await Supplier.create([
    { name: 'R1 owner', email: 'owner@r1-idempotency.test', password: 'fixture', role: 'supplier', phone: '+212611111111' },
    { name: 'R1 other supplier', email: 'other@r1-idempotency.test', password: 'fixture', role: 'supplier' },
    { name: 'R1 buyer', email: 'buyer@r1-idempotency.test', password: 'fixture', role: 'buyer' },
    { name: 'R1 staff', email: 'staff@r1-idempotency.test', password: 'fixture', role: 'staff' }
  ])
  organization = await Organization.create({ ownerSupplierId: owner._id, name: 'R1 organization' })
  membership = await Membership.create({ organizationId: organization._id, userId: staff._id, invitedEmail: staff.email,
    invitedBy: owner._id, role: 'staff', status: 'active', permissions: ['manage_products'] })
  tokens = Object.fromEntries(Object.entries({ owner, outsider, buyer, staff }).map(([name, user]) => [name, generateToken(user)]))
}, 120000)

beforeEach(async () => {
  jest.restoreAllMocks()
  await Promise.all([Product.deleteMany({}), BackgroundJob.deleteMany({}), Supplier.updateMany({}, { $set: { products: [], isActive: true } }),
    Membership.updateOne({ _id: membership._id }, { $set: { status: 'active', permissions: ['manage_products'] } })])
})

afterEach(() => jest.restoreAllMocks())
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

test('identical retries return the original persisted creation, not another product or job', async () => {
  const identity = key(), body = draft()
  const first = await post(body, identity)
  expect(first.status).toBe(201)
  expect(first.body.creation.replayed).toBe(false)
  const retry = await post(body, identity)
  expect(retry.status).toBe(201)
  expect(retry.body.creation.replayed).toBe(true)
  expect(retry.body.product).toEqual(first.body.product)
  expect(await Product.countDocuments({ supplierId: owner._id })).toBe(1)
  expect(await jobsFor(first.body.product._id)).toHaveLength(1)
  const linked = await Supplier.findById(owner._id)
  expect(linked.products.map(String)).toEqual([first.body.product._id])
})

test('twelve truly concurrent identical HTTP requests produce one product and one indexing job', async () => {
  const identity = key(), body = draft()
  const responses = await Promise.all(Array.from({ length: 12 }, () => post(body, identity)))
  expect(responses.map(response => response.status)).toEqual(Array(12).fill(201))
  expect(new Set(responses.map(response => response.body.product._id)).size).toBe(1)
  expect(responses.filter(response => !response.body.creation.replayed)).toHaveLength(1)
  expect(await Product.countDocuments()).toBe(1)
  expect(await jobsFor(responses[0].body.product._id)).toHaveLength(1)
})

test('concurrent different payloads sharing one key elect one winner and reject the other', async () => {
  const identity = key()
  const responses = await Promise.all([post(draft({ name: 'R1 winner candidate A' }), identity), post(draft({ name: 'R1 winner candidate B' }), identity)])
  expect(responses.map(response => response.status).sort()).toEqual([201, 409])
  const winner = responses.find(response => response.status === 201)
  expect(await Product.countDocuments()).toBe(1)
  expect((await Product.findOne()).name).toBe(winner.body.product.name)
  expect(await jobsFor(winner.body.product._id)).toHaveLength(1)
})

test('canonical object key order does not change identity, while changed accepted data conflicts', async () => {
  const identity = key()
  const body = draft({ imageRights: { source: 'owned', licenseReference: '' }, priceTiers: [{ minQty: 1, maxQty: 10, price: 3 }] })
  const first = await post(body, identity)
  expect(first.status).toBe(201)
  const reordered = { priceTiers: [{ price: 3, maxQty: 10, minQty: 1 }], imageRights: { licenseReference: '', source: 'owned' },
    availability: 'unknown', moq: 1, hasImageRights: false, isDraft: true, name: body.name }
  expect((await post(reordered, identity)).status).toBe(201)
  expect((await post({ ...body, name: 'Changed product' }, identity)).status).toBe(409)
  expect((await post({ ...body, priceTiers: [{ minQty: 1, maxQty: 10, price: 4 }] }, identity)).status).toBe(409)
  expect(await Product.countDocuments()).toBe(1)
})

test('ignored server-controlled fields neither alter the fingerprint nor gain authority', async () => {
  const identity = key(), body = draft()
  const first = await post({ ...body, supplierId: String(outsider._id), approvedBy: String(outsider._id), views: 900,
    creationReceipt: { key: 'forged-key', hash: 'forged-hash', snapshot: { name: 'forged' } } }, identity)
  expect(first.status).toBe(201)
  const retry = await post({ ...body, supplierId: String(buyer._id), views: 12345, createdAt: '1990-01-01T00:00:00.000Z' }, identity)
  expect(retry.status).toBe(201)
  expect(retry.body.product).toEqual(first.body.product)
  expect(first.body.product.supplierId).toBe(String(owner._id))
  expect(first.body.product.views).toBe(0)
  expect(JSON.stringify(first.body)).not.toContain('creationReceipt')
  expect(JSON.stringify((await mine('owner')).body)).not.toContain('creationReceipt')
})

test('replay returns an immutable creation snapshot after a later PUT without undoing that edit', async () => {
  const identity = key(), body = draft({ price: 11, unit: 'carton' })
  const first = await post(body, identity)
  expect(first.status).toBe(201)
  const changed = await edit(first.body.product._id, { name: 'R1 later edited product', price: 19, unit: 'lot' })
  expect(changed.status).toBe(200)
  const retry = await post(body, identity)
  expect(retry.status).toBe(201)
  expect(retry.body.product).toEqual(first.body.product)
  expect((await Product.findById(first.body.product._id)).toObject()).toMatchObject({ name: 'R1 later edited product', price: 19, unit: 'lot' })
  const jobs = await jobsFor(first.body.product._id)
  expect(jobs).toHaveLength(2) // One creation job and the existing PUT indexing job.
  expect(jobs.filter(job => job.idempotencyKey === 'creation:' + first.body.product._id)).toHaveLength(1)
})

test('the same key is scoped to each supplier and never discloses the other supplier product', async () => {
  const identity = key(), body = draft()
  const first = await post(body, identity)
  const other = await post(body, identity, 'outsider')
  expect(first.status).toBe(201); expect(other.status).toBe(201)
  expect(other.body.product._id).not.toBe(first.body.product._id)
  expect(other.body.product.supplierId).toBe(String(outsider._id))
  expect(JSON.stringify(other.body)).not.toContain(first.body.product._id)
  expect((await mine('outsider')).body.data.map(product => product._id)).toEqual([other.body.product._id])
  expect(await Product.countDocuments()).toBe(2)
})

test('fresh authorization protects retries from buyers, revoked staff and inactive owners', async () => {
  const identity = key(), body = draft()
  const first = await post(body, identity, 'staff')
  expect(first.status).toBe(201)
  expect(first.body.product.supplierId).toBe(String(owner._id))
  await Membership.updateOne({ _id: membership._id }, { $set: { status: 'revoked' } })
  expect((await post(body, identity, 'staff')).status).toBe(403)
  expect((await post(body, identity, 'buyer')).status).toBe(403)
  await Supplier.updateOne({ _id: owner._id }, { $set: { isActive: false } })
  expect((await post(body, identity)).status).toBe(401)
  expect(await Product.countDocuments()).toBe(1)
})

test('malformed operation keys are rejected before a product is written', async () => {
  for (const identity of ['', 'short', 'x'.repeat(129), 'has spaces in operation', 'forbidden/slash/key']) {
    expect((await post(draft(), identity)).status).toBe(400)
  }
  expect(await Product.countDocuments()).toBe(0)
  expect((await post(draft(), 'x'.repeat(16))).status).toBe(201)
  expect((await post(draft(), 'y'.repeat(128))).status).toBe(201)
})

test('legacy unkeyed clients remain compatible and distinct new operation keys create distinct products', async () => {
  const body = draft()
  expect((await post(body)).status).toBe(201)
  expect((await post(body)).status).toBe(201)
  const first = await post(body, key())
  const second = await post(body, key())
  expect(first.status).toBe(201); expect(second.status).toBe(201)
  expect(first.body.product._id).not.toBe(second.body.product._id)
  expect(await Product.countDocuments()).toBe(4)
})

test('a pre-insert failure does not consume the attempt and its retry creates exactly one product', async () => {
  const identity = key(), body = draft()
  jest.spyOn(Product.prototype, 'save').mockRejectedValueOnce(temporaryFailure())
  expect((await post(body, identity)).status).toBe(500)
  expect(await Product.countDocuments()).toBe(0)
  expect((await post(body, identity)).status).toBe(201)
  expect(await Product.countDocuments()).toBe(1)
})

test('failure after product insertion but before supplier linkage recovers the same product on retry', async () => {
  const identity = key(), body = draft()
  jest.spyOn(Supplier, 'findByIdAndUpdate').mockRejectedValueOnce(temporaryFailure())
  expect((await post(body, identity)).status).toBe(503)
  const persisted = await Product.findOne({ supplierId: owner._id })
  expect(persisted).toBeTruthy()
  expect(await Product.countDocuments()).toBe(1)
  expect((await Supplier.findById(owner._id)).products).toHaveLength(0)
  const retry = await post(body, identity)
  expect(retry.status).toBe(201)
  expect(retry.body.creation.replayed).toBe(true)
  expect(retry.body.product._id).toBe(String(persisted._id))
  expect((await Supplier.findById(owner._id)).products.map(String)).toEqual([String(persisted._id)])
  expect(await jobsFor(persisted._id)).toHaveLength(1)
})

test.each(['before', 'after'])('indexing enqueue failure %s durable job creation does not multiply product or jobs', async phase => {
  const identity = key(), body = draft()
  const original = BackgroundJob.create.bind(BackgroundJob)
  jest.spyOn(BackgroundJob, 'create').mockImplementationOnce(async (...args) => {
    if (phase === 'after') await original(...args)
    throw temporaryFailure()
  })
  const first = await post(body, identity)
  expect(first.status).toBe(201)
  expect(first.body.visualIndex.status).toBe('unavailable')
  expect(await Product.countDocuments()).toBe(1)
  expect(await jobsFor(first.body.product._id)).toHaveLength(phase === 'after' ? 1 : 0)
  const retry = await post(body, identity)
  expect(retry.status).toBe(201)
  expect(retry.body.product._id).toBe(first.body.product._id)
  expect(retry.body.visualIndex.status).toBe('queued')
  expect(await Product.countDocuments()).toBe(1)
  expect(await jobsFor(first.body.product._id)).toHaveLength(1)
})

test('keyed creation fails closed when its unique index is absent instead of promising unsafe idempotency', async () => {
  const indexes = await Product.collection.indexes()
  const index = indexes.find(item => item.name === 'product_creation_owner_key')
  expect(index).toBeTruthy()
  expect(index.unique).toBe(true)
  expect(index.partialFilterExpression).toBeTruthy()
  await Product.collection.dropIndex(index.name)
  try {
    const response = await post(draft(), key())
    expect(response.status).toBe(503)
    expect(await Product.countDocuments()).toBe(0)
  } finally {
    await Product.collection.createIndex(index.key, { name: index.name, unique: true, partialFilterExpression: index.partialFilterExpression })
  }
})

test.each(['extra-index-key', 'narrower-partial-filter'])('keyed creation rejects an incompatible uniqueness index: %s', async variant => {
  const index = (await Product.collection.indexes()).find(item => item.name === 'product_creation_owner_key')
  expect(index).toBeTruthy()
  await Product.collection.dropIndex(index.name)
  const alteredKey = variant === 'extra-index-key' ? { ...index.key, createdAt: 1 } : index.key
  const alteredPartial = variant === 'narrower-partial-filter' ? { ...index.partialFilterExpression, isDraft: false } : index.partialFilterExpression
  try {
    await Product.collection.createIndex(alteredKey, { name: index.name, unique: true, partialFilterExpression: alteredPartial })
    expect((await post(draft(), key())).status).toBe(503)
    expect(await Product.countDocuments()).toBe(0)
  } finally {
    await Product.collection.dropIndex(index.name)
    await Product.collection.createIndex(index.key, { name: index.name, unique: true, partialFilterExpression: index.partialFilterExpression })
  }
})
