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
})
