require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Report = require('../models/Report')
const AuditLog = require('../models/AuditLog')
const { generateToken } = require('../middleware/auth')
const { mediaFixture } = require('./helpers/mediaFixture')

let mongoServer
let adminToken
let supplierToken
let testSupplier
let testProduct

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
  const admin = await Supplier.create({ name: 'مشرف البلاغات', email: 'admin-reports@jomla.ma', password: 'hashed-fixture', role: 'admin' })
  adminToken = generateToken(admin)
  testSupplier = await Supplier.create({ name: 'مورد البلاغات', email: 'supplier-reports@jomla.ma', password: 'hashed-fixture', role: 'supplier', city: 'فاس', phone: '+212612345678' })
  supplierToken = generateToken(testSupplier)
  const store = await Store.create({ name: 'متجر البلاغات', supplierId: testSupplier._id, reviewStatus: 'approved', isActive: true })
  testProduct = await Product.create({ name: 'منتج عام للبلاغات', supplierId: testSupplier._id, storeId: store._id,
    category: 'أحذية', price: 120, city: 'فاس', description: 'منتج اصطناعي لاختبار البلاغات العامة', imageUrl: await mediaFixture(testSupplier),
    isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true,
    hasImageRights: true, imageRights: { source: 'owned', declaredBy: testSupplier._id, declaredAt: new Date() },
    approvedBy: testSupplier._id, approvedAt: new Date() })
})
afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

test('buyer and staff registration never grants unaccepted organizational permissions', async () => {
  for (const role of ['buyer', 'staff']) {
    const response = await request(app).post('/api/suppliers/register').send({
      name: 'حساب ' + role, email: role + '-roles@test.ma', password: 'password123',
      city: 'الرباط', phone: '+212612345678', role, organization: testSupplier.name
    })
    expect(response.status).toBe(201)
    expect(response.body.supplier.role).toBe(role)
    expect(response.body.supplier.permissions).toEqual([])
    expect(response.body.supplier.organizationId).toBeNull()
    expect((await request(app).post('/api/stores').set('Authorization', 'Bearer ' + response.body.token).send({ name: 'لا يجوز إنشاؤه' })).status).toBe(403)
  }
})

test('report submission and dismissal persist valid audit records with the real admin actor', async () => {
  const response = await request(app).post('/api/reports').send({
    reporterName: 'مبلغ تجريبي', reporterPhone: '+212677889900', targetType: 'product',
    targetId: String(testProduct._id), targetName: 'اسم غير موثوق من المتصفح',
    reason: 'copyright_infringement', details: 'طلب مراجعة حقوق الصورة'
  })
  expect(response.status).toBe(201)
  expect(Object.keys(response.body.report)).toEqual(['_id'])
  const reportId = response.body.report._id
  expect((await Report.findById(reportId)).targetName).toBe(testProduct.name)
  const submitted = await AuditLog.findOne({ action: 'REPORT_SUBMITTED', targetType: 'Report', targetId: reportId })
  expect(submitted.phase).toBe('completed')
  expect((await request(app).get('/api/reports')).status).toBe(401)
  expect((await request(app).get('/api/reports').set('Authorization', 'Bearer ' + supplierToken)).status).toBe(403)
  const list = await request(app).get('/api/reports?status=pending').set('Authorization', 'Bearer ' + adminToken)
  expect(list.status).toBe(200)
  expect(list.body.data.some(report => report._id === reportId)).toBe(true)
  const dismissal = await request(app).put('/api/reports/' + reportId + '/resolve').set('Authorization', 'Bearer ' + adminToken)
    .send({ action: 'dismissed', resolutionNotes: 'الترخيص صالح حسب المستندات' })
  expect(dismissal.status).toBe(200)
  const dismissed = await AuditLog.findOne({ action: 'REPORT_DISMISSED', targetId: reportId })
  expect(dismissed.phase).toBe('completed')
  expect(dismissed.performedBy.role).toBe('admin')
  expect((await Report.findById(reportId)).status).toBe('dismissed')
})

test('invalid report targets and resolution actions are rejected without silently closing reports', async () => {
  const missing = await request(app).post('/api/reports').send({ targetType: 'supplier', targetId: String(new mongoose.Types.ObjectId()), reason: 'fraud' })
  expect(missing.status).toBe(404)
  const report = await Report.create({ targetType: 'product', targetId: testProduct._id, targetName: testProduct.name, reason: 'other' })
  for (const body of [{ action: 'unknown', resolutionNotes: 'reason' }, { action: 'resolved' }, { action: 'resolved', resolutionNotes: 'reason', moderationAction: 'suspend_supplier' }]) {
    const result = await request(app).put('/api/reports/' + report._id + '/resolve').set('Authorization', 'Bearer ' + adminToken).send(body)
    expect(result.status).toBe(400)
  }
  expect((await Report.findById(report._id)).status).toBe('pending')
})
