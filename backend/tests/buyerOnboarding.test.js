require('./helpers/pilotIsolation')
const request = require('supertest'), mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), Supplier = require('../models/Supplier')
let mongo, token, id
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri()) })
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })
test('buyer registers without contact fields; confirmation and role checks stay enforced', async () => {
  const body = { role: 'buyer', email: 'minimal@example.test', password: 'Synthetic-Only123!', confirmPassword: 'Synthetic-Only123!', gender: 'undisclosed' }
  expect((await request(app).post('/api/suppliers/register').send({ ...body, confirmPassword: 'different' })).status).toBe(400)
  expect((await request(app).post('/api/suppliers/register').send({ ...body, role: 'supplier' })).status).toBe(400)
  expect((await request(app).post('/api/suppliers/register').send({ ...body, role: 'admin' })).status).toBe(400)
  const result = await request(app).post('/api/suppliers/register').send({ ...body, profilePending: false })
  expect(result.status).toBe(201); expect(result.body.supplier.profilePending).toBe(true)
  expect(result.body.supplier).not.toHaveProperty('gender')
  token = result.body.token; id = result.body.supplier.id
})
test('incomplete buyer cannot bypass first-request contact completion in either API', async () => {
  for (const route of ['/api/rfq', '/api/sourcing']) {
    const result = await request(app).post(route).set('Authorization', 'Bearer ' + token).send({})
    expect(result.status).toBe(409); expect(result.body.code).toBe('BUYER_CONTACT_REQUIRED')
  }
  const incomplete = await request(app).put('/api/suppliers/' + id).set('Authorization', 'Bearer ' + token).send({ city: 'Rabat', phone: '+212600000001' })
  expect(incomplete.body.supplier.profilePending).toBe(true)
  const completed = await request(app).put('/api/suppliers/' + id).set('Authorization', 'Bearer ' + token).send({ name: 'Synthetic buyer', city: 'Rabat', phone: '+212600000001' })
  expect(completed.status).toBe(200); expect(completed.body.supplier.profilePending).toBe(false)
  // Fresh authentication reads saved completion, not the old token payload.
  const next = await request(app).post('/api/rfq').set('Authorization', 'Bearer ' + token).send({})
  expect(next.status).toBe(400); expect(next.body.code).not.toBe('BUYER_CONTACT_REQUIRED')
  expect((await Supplier.findById(id)).profilePending).toBe(false)
})
