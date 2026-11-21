// Real HTTP/Mongo regression for public reporting; never load the project .env.
require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const Report = require('../models/Report')
const AuditLog = require('../models/AuditLog')

let mongo, f
const body = (targetId, targetType = 'product') => ({ targetType, targetId: String(targetId), reason: 'other' })
const submit = (targetId, targetType) => request(app).post('/api/reports').send(body(targetId, targetType))
const missingId = () => new mongoose.Types.ObjectId()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'r42_report_privacy' } })
  await mongoose.connect(mongo.getUri('r42_report_privacy'))
})
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})))
  f = await fixtures()
})
afterAll(async () => {
  require('../middleware/logger').logger.close()
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
})

async function expectUnavailable(id, targetType = 'product') {
  const before = { reports: await Report.countDocuments(), audits: await AuditLog.countDocuments() }
  const absent = await submit(missingId(), targetType)
  const rejected = await submit(id, targetType)
  expect(rejected.status).toBe(404)
  expect(rejected.status).toBe(absent.status)
  expect(rejected.body).toEqual(absent.body)
  expect(Object.keys(rejected.body)).toEqual(['message'])
  expect(JSON.stringify(rejected.body)).not.toContain(f.product.name)
  expect(JSON.stringify(rejected.body)).not.toContain(f.supplier.name)
  expect(await Report.countDocuments()).toBe(before.reports)
  expect(await AuditLog.countDocuments()).toBe(before.audits)
}

test('eligible public product accepts an anonymous report with a minimal receipt and a server-derived name', async () => {
  expect((await request(app).get('/api/products/' + f.product._id)).status).toBe(200)
  const result = await request(app).post('/api/reports').send({
    ...body(f.product._id), targetName: 'CLIENT_FORGED_NAME', reporterName: 'SYNTHETIC_REPORTER',
    reporterPhone: '+212600000000', details: 'SYNTHETIC_PRIVATE_DETAILS',
    status: 'resolved', resolvedBy: String(f.supplier._id), resolutionNotes: 'CLIENT_INTERNAL_FIELD'
  })
  expect(result.status).toBe(201)
  expect(Object.keys(result.body).sort()).toEqual(['message', 'report'])
  expect(Object.keys(result.body.report)).toEqual(['_id'])
  expect(result.body.report._id).toMatch(/^[a-f\d]{24}$/)
  const saved = await Report.findById(result.body.report._id)
  expect(saved).toMatchObject({ targetName: f.product.name, targetType: 'product', status: 'pending', resolutionNotes: '' })
  expect(saved.resolvedBy).toBeUndefined()
  expect(saved.reporterName).toBe('SYNTHETIC_REPORTER')
  expect(saved.details).toBe('SYNTHETIC_PRIVATE_DETAILS')
  expect(JSON.stringify(result.body)).not.toMatch(/CLIENT_|SYNTHETIC_|targetName|targetId|reporter|resolved|createdAt|__v|password|tokenVersion/)
  expect(await AuditLog.countDocuments({ action: 'REPORT_SUBMITTED', targetId: saved._id, phase: 'completed' })).toBe(1)
})

test.each([
  ['draft', 'product', { isDraft: true }],
  ['unpublished without approval date', 'product', { approvedAt: null }],
  ['unpublished without approver', 'product', { approvedBy: null }],
  ['out of stock', 'product', { inStock: false }],
  ['unavailable', 'product', { availability: 'out_of_stock' }],
  ['unconfirmed availability', 'product', { availabilityConfirmed: false }],
  ['no image rights', 'product', { hasImageRights: false }],
  ['unknown image rights source', 'product', { 'imageRights.source': 'unknown' }],
  ['no rights declarer', 'product', { 'imageRights.declaredBy': null }],
  ['no rights date', 'product', { 'imageRights.declaredAt': null }],
  ['moderated hidden', 'product', { moderationStatus: 'hidden' }],
  ['pending store', 'store', { reviewStatus: 'pending' }],
  ['rejected store', 'store', { reviewStatus: 'rejected' }],
  ['inactive store', 'store', { isActive: false }],
  ['suspended store even if active', 'store', { adminSuspended: true }],
  ['inactive supplier', 'supplier', { isActive: false }],
  ['non-supplier owner', 'supplier', { role: 'buyer' }]
])('%s is indistinguishable from a missing report target and writes nothing', async (_label, kind, changes) => {
  const model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id
  await model.updateOne({ _id: id }, { $set: changes })
  expect((await request(app).get('/api/products/' + f.product._id)).status).toBe(404)
  await expectUnavailable(f.product._id)
})

test.each(['product', 'store', 'supplier'])('deleted %s prevents public reporting and leaks no name', async kind => {
  const model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id
  await model.deleteOne({ _id: id })
  await expectUnavailable(f.product._id)
})

test('an eligible store belonging to another supplier cannot make a product reportable', async () => {
  await Store.updateOne({ _id: f.store._id }, { $set: { supplierId: f.otherSupplier._id } })
  expect((await request(app).get('/api/products/' + f.product._id)).status).toBe(404)
  await expectUnavailable(f.product._id)
})

test('missing and unlinked stores cannot make a product reportable', async () => {
  for (const storeId of [missingId(), null]) {
    await Product.updateOne({ _id: f.product._id }, { $set: { storeId } })
    await expectUnavailable(f.product._id)
  }
})

test('owner, staff and buyer credentials do not bypass the public reporting policy', async () => {
  await Product.updateOne({ _id: f.product._id }, { $set: { isDraft: true } })
  const absent = await submit(missingId())
  for (const token of Object.values(f.tokens)) {
    const result = await request(app).post('/api/reports').set('Authorization', 'Bearer ' + token).send(body(f.product._id))
    expect(result.status).toBe(404)
    expect(result.body).toEqual(absent.body)
  }
  expect(await Report.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})

test.each(['not-an-id', 'a'.repeat(23), 'a'.repeat(25), '', null, { $ne: null }, ['a'.repeat(24)]])('invalid target id %j is safely rejected without writes', async targetId => {
  const result = await request(app).post('/api/reports').send({ targetType: 'product', targetId, reason: 'other' })
  expect(result.status).toBe(400)
  expect(Object.keys(result.body)).toEqual(['message'])
  expect(await Report.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})

test('an active supplier without optional commercial verification remains reportable', async () => {
  expect(f.supplier.isVerified).toBe(false)
  const result = await request(app).post('/api/reports').send({ ...body(f.supplier._id, 'supplier'), targetName: 'FORGED' })
  expect(result.status).toBe(201)
  expect(Object.keys(result.body.report)).toEqual(['_id'])
  expect((await Report.findById(result.body.report._id)).targetName).toBe(f.supplier.name)
})

test.each([{ isActive: false }, { role: 'buyer' }])('non-public supplier %j is not reportable and leaks no name', async changes => {
  await Supplier.updateOne({ _id: f.supplier._id }, { $set: changes })
  await expectUnavailable(f.supplier._id, 'supplier')
})

test('store reports remain unsupported instead of exposing store details through a new path', async () => {
  const result = await submit(f.store._id, 'store')
  expect(result.status).toBe(400)
  expect(Object.keys(result.body)).toEqual(['message'])
  expect(await Report.countDocuments()).toBe(0)
  expect(await AuditLog.countDocuments()).toBe(0)
})
