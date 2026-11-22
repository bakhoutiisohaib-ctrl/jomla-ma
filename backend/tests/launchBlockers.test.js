require('./helpers/pilotIsolation')
const request = require('supertest'), mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), fixtures = require('./helpers/tradeFixtures')
const N = require('../models/Notification'), Report = require('../models/Report'), Supplier = require('../models/Supplier'), Store = require('../models/Store')
const RFQ = require('../models/QuoteRequest'), Audit = require('../models/AuditLog')
const { generateToken } = require('../middleware/auth')
let mongo, f, adminToken
const auth = who => ({ Authorization: 'Bearer ' + (who === 'admin' ? adminToken : f.tokens[who]) })
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri()); f = await fixtures()
  adminToken = generateToken(await Supplier.create({ name: 'Launch test admin', email: 'launch-admin@example.test', password: 'synthetic-only', role: 'admin' }))
})
afterEach(() => { jest.restoreAllMocks(); delete process.env.MEDIA_REVALIDATION; delete process.env.REPORTS_TRANSACTIONS })
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('delegated staff cannot read or mark private/future owner notices', async () => {
  const allowed = await N.create({ userId: f.supplier._id, resourceType: 'rfq', resourceId: f.product._id, type: 'rfq_created' })
  const hidden = new mongoose.Types.ObjectId()
  await N.collection.insertOne({ _id: hidden, userId: f.supplier._id, resourceType: 'account', resourceId: f.supplier._id, type: 'private_account_notice', readAt: null })
  const list = await request(app).get('/api/notifications').set(auth('staff'))
  expect(list.status).toBe(200); expect(list.body.data.map(n => n._id)).toContain(String(allowed._id)); expect(JSON.stringify(list.body)).not.toContain(String(hidden))
  expect((await request(app).put('/api/notifications/' + hidden + '/read').set(auth('staff'))).status).toBe(404)
  expect((await request(app).put('/api/notifications/read-all').set(auth('staff'))).status).toBe(200)
  expect((await N.collection.findOne({ _id: hidden })).readAt).toBeNull()
  expect((await N.findById(allowed._id)).readAt).toBeTruthy()
})

test('error handler safely handles missing keyPattern, sent headers and JWT errors', () => {
  const { errorHandler } = require('../middleware/errorHandler')
  const response = () => { const r = { status: jest.fn(), json: jest.fn() }; r.status.mockReturnValue(r); return r }
  const req = { method: 'GET', path: '/test' }, next = jest.fn(), sent = { headersSent: true }
  errorHandler(new Error('test'), req, sent, next); expect(next).toHaveBeenCalledTimes(1)
  const duplicate = response(); errorHandler({ code: 11000 }, req, duplicate, next); expect(duplicate.status).toHaveBeenCalledWith(409)
  for (const name of ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']) { const r = response(); errorHandler({ name }, req, r, next); expect(r.status).toHaveBeenCalledWith(401) }
  const r = response(); errorHandler({ name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' }, req, r, next); expect(r.status).toHaveBeenCalledWith(400)
})

test('early product validators reject external images, bad image items and reversed tiers', async () => {
  for (const body of [{ imageUrl: 'https://example.test/a.png' }, { images: [42] }, { priceTiers: [{ minQty: 20, maxQty: 10, price: 5 }] }]) {
    expect((await request(app).put('/api/products/' + f.product._id).set(auth('supplier')).send(body)).status).toBe(400)
  }
  expect((await request(app).put('/api/products/' + f.product._id).set(auth('supplier')).send({ description: 'valid partial description', publishApproved: true, hasImageRights: true, imageRights: { source: 'owned' }, availabilityConfirmed: true })).status).toBe(200)
})

test('concurrent report resolutions publish exactly one decision', async () => {
  const report = await Report.create({ targetType: 'supplier', targetId: f.otherSupplier._id, targetName: 'Synthetic target', reason: 'other' })
  const replies = await Promise.all(Array.from({ length: 6 }, () => request(app).put('/api/reports/' + report._id + '/resolve').set(auth('admin')).send({ action: 'dismissed', resolutionNotes: 'Synthetic dismissal' })))
  expect(replies.filter(r => r.status === 200)).toHaveLength(1); expect(replies.filter(r => r.status === 409)).toHaveLength(5)
  expect(await Audit.countDocuments({ targetId: report._id, action: 'REPORT_DISMISSED', phase: 'completed' })).toBe(1)
})

test('partial suspension is recoverable only with identical intent and without duplicate session increments', async () => {
  const report = await Report.create({ targetType: 'supplier', targetId: f.otherSupplier._id, targetName: 'Synthetic target', reason: 'fraud' })
  const body = { action: 'resolved', resolutionNotes: 'Synthetic suspension', moderationAction: 'suspend_supplier' }
  jest.spyOn(Store, 'updateMany').mockRejectedValueOnce(new Error('synthetic unavailable store write'))
  expect((await request(app).put('/api/reports/' + report._id + '/resolve').set(auth('admin')).send(body)).status).toBe(500)
  const version = (await Supplier.findById(f.otherSupplier._id)).tokenVersion
  await Report.updateOne({ _id: report._id }, { $set: { 'resolutionClaim.leaseUntil': new Date(0) } })
  expect((await request(app).put('/api/reports/' + report._id + '/resolve').set(auth('admin')).send({ action: 'dismissed', resolutionNotes: 'Different intent' })).status).toBe(409)
  expect((await request(app).put('/api/reports/' + report._id + '/resolve').set(auth('admin')).send(body)).status).toBe(200)
  expect((await Supplier.findById(f.otherSupplier._id)).tokenVersion).toBe(version)
})

test('transaction opt-in fails closed on standalone without suspending target', async () => {
  process.env.REPORTS_TRANSACTIONS = '1'
  const report = await Report.create({ targetType: 'supplier', targetId: f.supplier._id, targetName: 'Synthetic target', reason: 'fraud' })
  expect((await request(app).put('/api/reports/' + report._id + '/resolve').set(auth('admin')).send({ action: 'resolved', resolutionNotes: 'Synthetic transaction', moderationAction: 'suspend_supplier' })).status).toBe(500)
  expect((await Supplier.findById(f.supplier._id)).isActive).not.toBe(false)
})

test('opt-in media revalidation checks current access before 304', async () => {
  process.env.MEDIA_REVALIDATION = '1'
  const url = f.product.imageUrl.replace('/uploads/', '/api/media/')
  const first = await request(app).get(url); expect(first.status).toBe(200); expect(first.headers.etag).toBeTruthy()
  const second = await request(app).get(url).set('If-None-Match', first.headers.etag); expect(second.status).toBe(304)
  await require('../models/Product').updateOne({ _id: f.product._id }, { $set: { moderationStatus: 'hidden' } })
  const hidden = await request(app).get(url).set('If-None-Match', first.headers.etag)
  expect(hidden.status).toBe(401); expect(hidden.headers['cache-control']).toContain('no-store')
  await require('../models/Product').updateOne({ _id: f.product._id }, { $set: { moderationStatus: 'visible' } })
})

test('RFQ retry ceiling retains stable identity and explicit buyer retry completes it', async () => {
  const key = require('crypto').randomUUID(), payload = { productId: String(f.product._id), quantity: 20, buyerPhone: '+212600000001' }
  jest.spyOn(N, 'updateOne').mockRejectedValueOnce(new Error('synthetic unavailable notification'))
  const first = await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key', key).send(payload)
  expect(first.status).toBe(202)
  await RFQ.updateOne({ _id: first.body.rfq._id }, { $set: { 'creation.attempts': 5 } })
  await require('../services/rfqCreation').recoverPendingCreations()
  const held = await RFQ.findById(first.body.rfq._id).select('+creation'); expect(held.creation.phase).toBe('dead')
  const replay = await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key', key).send(payload)
  expect(replay.status).toBe(202); expect(replay.body.creation.phase).toBe('dead')
  const retried = await request(app).post('/api/rfq/' + held._id + '/creation/retry').set(auth('buyer'))
  expect(retried.status).toBe(201); expect(retried.body.processing).toBe(false)
  expect(await RFQ.countDocuments({ buyerId: f.buyer._id, 'creation.key': key })).toBe(1)
})


test('public reports enforce their own limit and admin list rejects unknown status', async () => {
  expect((await request(app).get('/api/reports?status=unknown').set(auth('admin'))).status).toBe(400)
  for (let n = 0; n < 20; n++) expect((await request(app).post('/api/reports').send({})).status).toBe(400)
  expect((await request(app).post('/api/reports').send({})).status).toBe(429)
})
