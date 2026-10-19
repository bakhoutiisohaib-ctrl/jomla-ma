const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const QuoteRequest = require('../models/QuoteRequest')
const Report = require('../models/Report')
const { generateToken } = require('../middleware/auth')

let mongoServer
let adminToken
let supplierToken
let testAdmin
let testSupplier
let testProduct

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)

  testAdmin = await Supplier.create({
    name: 'مشرف المنصة الرئيسي',
    email: 'admin-reports@jomla.ma',
    password: 'password123',
    role: 'admin',
    isVerified: true
  })
  adminToken = generateToken(testAdmin)

  testSupplier = await Supplier.create({
    name: 'مورد تجريبي للأدوار',
    email: 'supplier-roles@jomla.ma',
    password: 'password123',
    city: 'الدار البيضاء',
    phone: '+212611223344',
    isVerified: true
  })
  supplierToken = generateToken(testSupplier)

  testProduct = await Product.create({
    name: 'قفطان مغربي أصيل',
    category: 'ملابس',
    price: 350,
    city: 'الدار البيضاء',
    moq: 10,
    unit: 'قطعة',
    supplierId: testSupplier._id,
    supplierPhone: testSupplier.phone
  })
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('B2B Roles, RFQ Acceptance, and Moderation Reports', () => {
  let createdRfqId
  let createdReportId

  test('POST /api/suppliers/register supports buyer and staff roles', async () => {
    // 1. Register a professional buyer
    const resBuyer = await request(app)
      .post('/api/suppliers/register')
      .send({
        name: 'كريم التاجر المهني',
        email: 'buyer-karim@test.ma',
        password: 'password123',
        city: 'الرباط',
        phone: '+212677889900',
        role: 'buyer',
        organization: 'شركة التجزئة الحديثة'
      })

    expect(resBuyer.statusCode).toBe(201)
    expect(resBuyer.body.supplier.role).toBe('buyer')
    expect(resBuyer.body.supplier.organization).toBe('شركة التجزئة الحديثة')

    // 2. Register staff member
    const resStaff = await request(app)
      .post('/api/suppliers/register')
      .send({
        name: 'أحمد مسؤول المبيعات',
        email: 'staff-ahmed@test.ma',
        password: 'password123',
        city: 'الدار البيضاء',
        phone: '+212633221100',
        role: 'staff',
        organization: testSupplier.name
      })

    expect(resStaff.statusCode).toBe(201)
    expect(resStaff.body.supplier.role).toBe('staff')
    expect(resStaff.body.supplier.permissions).toContain('manage_products')
  })

  test('PUT /api/rfq/:id/action allows buyer to accept an offer with WhatsApp link', async () => {
    // First, create an RFQ
    const rfqRes = await request(app)
      .post('/api/rfq')
      .send({
        productId: testProduct._id,
        buyerName: 'طارق المشتري',
        buyerPhone: '+212612341234',
        quantity: 25
      })
    expect(rfqRes.statusCode).toBe(201)
    createdRfqId = rfqRes.body.rfq._id

    // Supplier responds
    await request(app)
      .put(`/api/rfq/${createdRfqId}/respond`)
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        unitPrice: 320,
        deliveryDays: 3,
        notes: 'موافقون على السعر المخفض للكمية'
      })

    // Buyer accepts the offer
    const acceptRes = await request(app)
      .put(`/api/rfq/${createdRfqId}/action`)
      .send({ action: 'accept' })

    expect(acceptRes.statusCode).toBe(200)
    expect(acceptRes.body.rfq.status).toBe('accepted')
    expect(acceptRes.body.whatsappSupplier).toContain('wa.me')
  })

  test('POST /api/reports submits a product violation report', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({
        reporterName: 'سعيد التاجر',
        reporterPhone: '+212688776655',
        targetType: 'product',
        targetId: testProduct._id,
        targetName: testProduct.name,
        reason: 'copyright_infringement',
        details: 'الصورة مأخوذة من كتالوج آخر بدون ترخيص'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.report.status).toBe('pending')
    expect(res.body.report.reason).toBe('copyright_infringement')
    createdReportId = res.body.report._id
  })

  test('GET /api/reports lists reports for admin', async () => {
    const res = await request(app)
      .get('/api/reports?status=pending')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data[0]._id.toString()).toBe(createdReportId.toString())
  })

  test('PUT /api/reports/:id/resolve resolves the report by admin', async () => {
    const res = await request(app)
      .put(`/api/reports/${createdReportId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        action: 'resolved',
        resolutionNotes: 'تم التحقق من الوثائق وحل النزاع مع المورد'
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.report.status).toBe('resolved')
    expect(res.body.report.resolutionNotes).toContain('تم التحقق')
  })
})
