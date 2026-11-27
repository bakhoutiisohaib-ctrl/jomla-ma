require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const AuditLog = require('../models/AuditLog')
const { generateToken } = require('../middleware/auth')

let mongoServer
let adminToken
let supplierToken
let testAdmin
let testSupplier

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)

  // إنشاء حساب مشرف
  testAdmin = await Supplier.create({
    name: 'المشرف الرئيسي',
    email: 'admin@jomla.ma',
    password: 'adminPassword123',
    city: 'الدار البيضاء',
    phone: '+212600000001',
    role: 'admin',
    isVerified: true,
    verificationStatus: 'verified'
  })
  adminToken = generateToken(testAdmin)

  // إنشاء مورد عادي
  testSupplier = await Supplier.create({
    name: 'شركة الأطلس للتوزيع بالجملة',
    email: 'atlas@jomla.ma',
    password: 'supplierPassword123',
    city: 'طنجة',
    phone: '+212611223344',
    role: 'supplier',
    isVerified: false,
    verificationStatus: 'unverified'
  })
  supplierToken = generateToken(testSupplier)
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('Supplier Verification & Admin Moderation', () => {
  test('POST /api/suppliers/me/verify allows supplier to submit ICE & RC for verification', async () => {
    const res = await request(app)
      .post('/api/suppliers/me/verify')
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        iceNumber: '001234567890001',
        tradeRegistry: 'RC-TNG-12345',
        verificationDoc: 'https://jomla.ma/uploads/docs/atlas-rc.pdf'
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.supplier.verificationStatus).toBe('pending')
    expect(res.body.supplier.iceNumber).toBe('001234567890001')

    // التحقق من إنشاء سجل تدقيق
    const audit = await AuditLog.findOne({ action: 'SUPPLIER_VERIFICATION_SUBMITTED', targetId: testSupplier._id })
    expect(audit).not.toBeNull()
    expect(audit.details.iceNumber).toBe('001234567890001')
  })

  test('GET /api/admin/suppliers returns 403 for non-admin users', async () => {
    const res = await request(app)
      .get('/api/admin/suppliers')
      .set('Authorization', `Bearer ${supplierToken}`)

    expect(res.statusCode).toBe(403)
  })

  test('GET /api/admin/suppliers allows admin to view pending verifications', async () => {
    const res = await request(app)
      .get('/api/admin/suppliers?status=pending')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.statusCode).toBe(200)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    const found = res.body.data.find(s => s._id.toString() === testSupplier._id.toString())
    expect(found).toBeDefined()
    expect(found.verificationStatus).toBe('pending')
  })

  test('PUT /api/admin/suppliers/:id/verify allows admin to approve supplier verification', async () => {
    const res = await request(app)
      .put(`/api/admin/suppliers/${testSupplier._id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve', verificationRevision: 1 })

    expect(res.statusCode).toBe(200)
    expect(res.body.supplier.isVerified).toBe(true)
    expect(res.body.supplier.verificationStatus).toBe('verified')

    const dbSupplier = await Supplier.findById(testSupplier._id)
    expect(dbSupplier.isVerified).toBe(true)
    expect(dbSupplier.verificationStatus).toBe('verified')

    // تحقق من تسجيل التدقيق
    const approvalAudit = await AuditLog.findOne({ action: 'SUPPLIER_VERIFIED', targetId: testSupplier._id })
    expect(approvalAudit).not.toBeNull()
    expect(approvalAudit.performedBy.role).toBe('admin')
  })

  test('GET /api/admin/stats returns aggregate metrics', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('totalSuppliers')
    expect(res.body).toHaveProperty('verifiedSuppliers')
    expect(res.body.verifiedSuppliers).toBeGreaterThanOrEqual(1)
  })

  test('GET /api/admin/audit-logs returns log trail for auditability', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
  })

  test('PUT /api/admin/suppliers/:id/verify allows admin to reject with reason', async () => {
    // إنشاء مورد آخر للرفض
    const rejectedSupplier = await Supplier.create({
      name: 'مورد غير مكتمل',
      email: 'incomplete@jomla.ma',
      password: 'password123',
      city: 'مراكش',
      phone: '+212677889900',
      role: 'supplier',
      verificationStatus: 'pending'
    })

    const res = await request(app)
      .put(`/api/admin/suppliers/${rejectedSupplier._id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'reject', verificationRevision: 0,
        rejectionReason: 'رقم السجل التجاري غير واضح في الوثيقة المرفقة'
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.supplier.isVerified).toBe(false)
    expect(res.body.supplier.verificationStatus).toBe('rejected')
    expect(res.body.supplier.rejectionReason).toContain('رقم السجل التجاري')
  })
})
