const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')

let mongoServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  await mongoose.connect(uri)
})

afterAll(async () => {
  await mongoose.disconnect()
  if (mongoServer) await mongoServer.stop()
})

describe('Products smoke', () => {
  test('GET /api/products returns 200 and pagination', async () => {
    const res = await request(app).get('/api/products')
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('pagination')
  }, 20000)

  test('GET /api/products/search safely handles regex injection inputs', async () => {
    // Malicious or special regex characters that previously broke new RegExp()
    const specialQueries = ['[a-z', '(', '(a+)+', '*+', '??', '{\\']
    for (const q of specialQueries) {
      const res = await request(app).get(`/api/products/search?q=${encodeURIComponent(q)}`)
      expect(res.statusCode).toBe(200)
      expect(res.body).toHaveProperty('pagination')
      expect(res.body).toHaveProperty('data')
    }
  }, 20000)

  test('GET /api/products/search parses Darija keywords and city filters', async () => {
    const res = await request(app).get(`/api/products/search?q=${encodeURIComponent('صباط كازا رخيص')}`)
    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveProperty('pagination')
    expect(res.body).toHaveProperty('data')
  }, 20000)

  test('POST and GET wholesale product with MOQ, unit, and tiered pricing', async () => {
    const { generateToken } = require('../middleware/auth')
    const Supplier = require('../models/Supplier')
    const supplier = await Supplier.create({
      name: 'مورد الجملة كازا',
      email: 'grossiste@jomla.ma',
      password: 'password123',
      city: 'كازا',
      phone: '+212600000000'
    })

    const token = generateToken(supplier)

    const newProduct = {
      name: 'قميص قطن ممتاز',
      category: 'ملابس',
      price: 50,
      city: 'كازا',
      moq: 15,
      unit: 'قطعة',
      priceTiers: [
        { minQty: 15, maxQty: 50, price: 50 },
        { minQty: 51, price: 42 }
      ]
    }

    const postRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send(newProduct)

    expect(postRes.statusCode).toBe(201)
    expect(postRes.body.product.moq).toBe(15)
    expect(postRes.body.product.unit).toBe('قطعة')
    expect(postRes.body.product.priceTiers.length).toBe(2)

    // Verify GET /api/products returns wholesale fields
    const getRes = await request(app).get('/api/products')
    expect(getRes.statusCode).toBe(200)
    const created = getRes.body.data.find(p => p.name === 'قميص قطن ممتاز')
    expect(created).toBeDefined()
    expect(created.moq).toBe(15)
    expect(created.unit).toBe('قطعة')
    expect(created.priceTiers.length).toBe(2)
  }, 20000)
})
