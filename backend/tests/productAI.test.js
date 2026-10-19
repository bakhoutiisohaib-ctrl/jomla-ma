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

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)

  testSupplier = await Supplier.create({
    name: 'مورد الملابس بالجملة',
    email: 'supplier-ai@jomla.ma',
    password: 'password123',
    city: 'الدار البيضاء',
    phone: '+212611223344',
    isVerified: true
  })
  supplierToken = generateToken(testSupplier)
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('Product AI Onboarding (T08 - استخراج مسودة الجملة من الصورة)', () => {
  test('GET /api/product-ai/ping returns healthy status', async () => {
    const res = await request(app).get('/api/product-ai/ping')
    expect(res.statusCode).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  test('POST /api/product-ai/enhance requires authentication', async () => {
    const res = await request(app)
      .post('/api/product-ai/enhance')
      .attach('image', Buffer.from('fake-image-bytes'), 'test-product.jpg')

    expect(res.statusCode).toBe(401)
  })

  test('POST /api/product-ai/enhance extracts wholesale draft from image', async () => {
    const res = await request(app)
      .post('/api/product-ai/enhance')
      .set('Authorization', `Bearer ${supplierToken}`)
      .attach('image', Buffer.from('fake-image-data-for-wholesale-shoes'), 'chaussure-homme.jpg')
      .field('productName', 'حذاء جلدي كلاسيكي')
      .field('category', 'أحذية')

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('imageUrl')
    expect(res.body).toHaveProperty('draft')
    
    const draft = res.body.draft
    expect(draft).toHaveProperty('title')
    expect(draft).toHaveProperty('suggestedPrice')
    expect(draft).toHaveProperty('suggestedMoq')
    expect(draft).toHaveProperty('suggestedUnit')
    expect(draft).toHaveProperty('suggestedPriceTiers')
    expect(Array.isArray(draft.suggestedPriceTiers)).toBe(true)
  })

  test('POST /api/products allows creating product with AI draft data and copyright consent', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${supplierToken}`)
      .send({
        name: 'قميص قطني مغربي للرجال',
        category: 'ملابس',
        price: 80,
        moq: 20,
        unit: 'قطعة',
        city: 'فاس',
        hasImageRights: true,
        isDraft: false,
        priceTiers: [
          { minQty: 20, maxQty: 99, price: 80 },
          { minQty: 100, maxQty: null, price: 72 }
        ],
        description: 'قميص مصنوع من القطن الطبيعي عالي الجودة متوفر بمقاسات مختلفة.'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.product.name).toBe('قميص قطني مغربي للرجال')
    expect(res.body.product.hasImageRights).toBe(true)
    expect(res.body.product.isDraft).toBe(false)
    expect(res.body.product.priceTiers.length).toBe(2)
  })
})
