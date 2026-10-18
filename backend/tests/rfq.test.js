const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const { generateToken } = require('../middleware/auth')

let mongoServer
let supplierToken
let testSupplier
let testProduct

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)

  testSupplier = await Supplier.create({
    name: 'مورد الجملة المعتمد',
    email: 'supplier-rfq@jomla.ma',
    password: 'password123',
    city: 'الدار البيضاء',
    phone: '+212612345678'
  })

  supplierToken = generateToken(testSupplier)

  testProduct = await Product.create({
    name: 'حذاء جلدي مغربي فاخر',
    category: 'أحذية',
    price: 120,
    city: 'الدار البيضاء',
    moq: 10,
    unit: 'درزينة',
    supplierId: testSupplier._id,
    supplierPhone: testSupplier.phone
  })
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('RFQ (Request For Quotation) Engine', () => {
  let createdRfqId

  test('POST /api/rfq creates a valid B2B quote request', async () => {
    const res = await request(app)
      .post('/api/rfq')
      .send({
        productId: testProduct._id,
        buyerName: 'يوسف تاجر التجزئة',
        buyerPhone: '+212699887766',
        buyerCity: 'مراكش',
        quantity: 50,
        targetPrice: 100,
        notes: 'نحتاج قياسات متنوعة من 40 إلى 44'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty('rfq')
    expect(res.body.rfq.quantity).toBe(50)
    expect(res.body.rfq.status).toBe('pending')
    expect(res.body.rfq.supplierId.toString()).toBe(testSupplier._id.toString())

    createdRfqId = res.body.rfq._id
  })

  test('GET /api/rfq/supplier lists incoming quotes for supplier with counts', async () => {
    const res = await request(app)
      .get('/api/rfq/supplier')
      .set('Authorization', `Bearer ${supplierToken}`)

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.counts.pending).toBeGreaterThanOrEqual(1)
    expect(res.body.data[0].buyerName).toBe('يوسف تاجر التجزئة')
  })

  test('PUT /api/rfq/:id/respond allows supplier to submit formal offer', async () => {
    const res = await request(app)
      .put(`/api/rfq/${createdRfqId}/respond`)
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        unitPrice: 105,
        deliveryDays: 4,
        notes: 'موافقون على المقاسات، والتسليم في مراكش بعد 4 أيام'
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.rfq.status).toBe('responded')
    expect(res.body.rfq.offer.unitPrice).toBe(105)
    expect(res.body.rfq.offer.totalPrice).toBe(105 * 50)
    expect(res.body.rfq.offer.deliveryDays).toBe(4)
  })

  test('GET /api/rfq/:id allows buyer to check quote and offer details', async () => {
    const res = await request(app).get(`/api/rfq/${createdRfqId}`)

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('responded')
    expect(res.body.offer.totalPrice).toBe(5250)
    expect(res.body.productId.name).toBe('حذاء جلدي مغربي فاخر')
  })
})
