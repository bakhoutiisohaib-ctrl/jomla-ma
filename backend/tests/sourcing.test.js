const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const path = require('path')
const fs = require('fs')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const SourcingRequest = require('../models/SourcingRequest')
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
    name: 'شركة التوريد المغربية',
    email: 'sourcing-supplier@jomla.ma',
    password: 'password123',
    city: 'الدار البيضاء',
    phone: '+212600112233',
    isVerified: true
  })

  supplierToken = generateToken(testSupplier)

  testProduct = await Product.create({
    name: 'بلوزة صوف مغربية أصلية',
    category: 'ملابس',
    price: 150,
    city: 'الدار البيضاء',
    moq: 20,
    unit: 'قطعة',
    supplierId: testSupplier._id,
    supplierPhone: testSupplier.phone
  })
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('B2B Sourcing Requests & Visual Matching', () => {
  let createdSourcingId

  test('POST /api/sourcing validates required fields', async () => {
    const res = await request(app)
      .post('/api/sourcing')
      .send({
        productName: 'صندل جلدي'
        // missing buyerName, buyerPhone, quantity
      })

    expect(res.statusCode).toBe(400)
    expect(res.body.message).toMatch(/يرجى ملء الحقول الإلزامية/i)
  })

  test('POST /api/sourcing creates a custom wholesale sourcing request', async () => {
    const res = await request(app)
      .post('/api/sourcing')
      .send({
        buyerName: 'عمر التاجر',
        buyerPhone: '+212655443322',
        buyerCity: 'طنجة',
        productName: 'صنادل تقليدية فاس',
        category: 'أحذية',
        quantity: 100,
        unit: 'زوج',
        targetPrice: 65,
        notes: 'مطلوب كمية 100 زوج من الجلد الطبيعي'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body).toHaveProperty('sourcing')
    expect(res.body.sourcing.productName).toBe('صنادل تقليدية فاس')
    expect(res.body.sourcing.quantity).toBe(100)
    expect(res.body.sourcing.status).toBe('open')
    expect(res.body.whatsappFollowup).toContain('wa.me')

    createdSourcingId = res.body.sourcing._id
  })

  test('GET /api/sourcing lists open sourcing opportunities for suppliers', async () => {
    const res = await request(app).get('/api/sourcing?status=open')

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('data')
    expect(res.body.data.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data[0].buyerName).toBe('عمر التاجر')
  })

  test('GET /api/sourcing/:id fetches single sourcing request detail', async () => {
    const res = await request(app).get(`/api/sourcing/${createdSourcingId}`)

    expect(res.statusCode).toBe(200)
    expect(res.body._id.toString()).toBe(createdSourcingId.toString())
    expect(res.body.productName).toBe('صنادل تقليدية فاس')
  })

  test('POST /api/sourcing/:id/quote allows supplier to submit quotation with WhatsApp link', async () => {
    const res = await request(app)
      .post(`/api/sourcing/${createdSourcingId}/quote`)
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        unitPrice: 62,
        deliveryDays: 5,
        notes: 'نستطيع توفير الكمية كاملة بجودة عالية والتسليم في طنجة'
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.sourcing.status).toBe('quoted')
    expect(res.body.sourcing.quotesCount).toBe(1)
    expect(res.body.buyerWhatsapp).toContain('wa.me')
    expect(res.body.buyerWhatsapp).toContain('62')
  })

  test('POST /api/image-search classifies results into exactMatches and similarMatches with sourcing fallback', async () => {
    // create a dummy image buffer for testing
    const dummyImagePath = path.join(__dirname, 'dummy_test_image.jpg')
    fs.writeFileSync(dummyImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]))

    try {
      const res = await request(app)
        .post('/api/image-search')
        .attach('image', dummyImagePath)

      expect(res.statusCode).toBe(200)
      expect(res.body).toHaveProperty('exactMatches')
      expect(res.body).toHaveProperty('similarMatches')
      expect(res.body).toHaveProperty('exactCount')
      expect(res.body).toHaveProperty('similarCount')
      expect(Array.isArray(res.body.products)).toBe(true)

      // When exact matches are 0, it should provide a sourcingOffer
      if (res.body.exactCount === 0) {
        expect(res.body).toHaveProperty('sourcingOffer')
        expect(res.body.sourcingOffer.canRequestSourcing).toBe(true)
      }
    } finally {
      if (fs.existsSync(dummyImagePath)) {
        fs.unlinkSync(dummyImagePath)
      }
    }
  })
})
