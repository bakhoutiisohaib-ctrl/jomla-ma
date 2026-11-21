process.env.JWT_SECRET = 'sourcing-test-secret-with-sufficient-length'
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const SourcingRequest = require('../models/SourcingRequest')
let mongo, f
const { definition } = require('../services/sourcingCreationIndex')
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri()); await SourcingRequest.collection.createIndex(definition.key, definition.options); f = await fixtures() })
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })
const auth = who => ({ Authorization: 'Bearer ' + f.tokens[who] })
const create = (body = {}, who = 'buyer') => request(app).post('/api/sourcing').set(auth(who)).set('Idempotency-Key', require('crypto').randomUUID()).send({
  productName: 'صنادل تقليدية بالجملة', buyerPhone: '+212655443322', quantity: 100, unit: 'زوج', buyerCity: 'طنجة', ...body
})
const quote = (id, price, who = 'supplier') => request(app).post('/api/sourcing/' + id + '/quote').set(auth(who)).set('Idempotency-Key', require('crypto').randomUUID()).send({ unitPrice: price, deliveryDays: 5, paymentTerms: 'الدفع بعد التأكيد' })

describe('Private sourcing and competing persisted supplier offers', () => {
  test('requires buyer identity and validates quantity, phone and price', async () => {
    expect((await request(app).post('/api/sourcing').send({})).status).toBe(401)
    expect((await create({}, 'supplier')).status).toBe(403)
    expect((await create({ quantity: 0 })).status).toBe(400)
    expect((await create({ quantity: 1.5 })).status).toBe(400)
    expect((await create({ buyerPhone: 'wrong' })).status).toBe(400)
    expect((await create({ targetPrice: -1 })).status).toBe(400)
  })
  test('uses session identity, protects contact details and isolates buyer history', async () => {
    const result = await create({ buyerId: f.otherBuyer._id, buyerName: 'forged name' })
    expect(result.status).toBe(201)
    const id = result.body.sourcing._id
    expect(result.body.sourcing.buyerId).toBe(String(f.buyer._id))
    expect(result.body.sourcing.buyerName).toBe(f.buyer.name)
    expect(result.body.whatsappFollowup).toBeUndefined()
    expect((await request(app).get('/api/sourcing')).status).toBe(401)
    const list = await request(app).get('/api/sourcing').set(auth('supplier'))
    expect(list.status).toBe(200)
    expect(list.body.data[0].buyerPhone).toBeUndefined()
    expect(list.body.data[0].buyerName).toBeUndefined()
    expect((await request(app).get('/api/sourcing/' + id).set(auth('otherBuyer'))).status).toBe(403)
    expect((await request(app).get('/api/sourcing/buyer').set(auth('otherBuyer'))).body.data).toHaveLength(0)
  })
  test('persists competitive offers without closing the request or leaking competitors', async () => {
    const id = (await create()).body.sourcing._id
    const first = await quote(id, 62)
    const second = await quote(id, 59, 'otherSupplier')
    expect(first.status).toBe(200); expect(second.status).toBe(200)
    expect(first.body.buyerWhatsapp).toBeUndefined()
    const stored = await SourcingRequest.findById(id)
    expect(stored.status).toBe('open')
    expect(stored.quotes).toHaveLength(2)
    expect(stored.quotesCount).toBe(2)
    expect(stored.quotes[0].paymentTerms).toBe('الدفع بعد التأكيد')
    const buyer = await request(app).get('/api/sourcing/' + id).set(auth('buyer'))
    expect(buyer.body.quotes).toHaveLength(2)
    const supplier = await request(app).get('/api/sourcing/' + id).set(auth('supplier'))
    expect(supplier.body.quotes).toHaveLength(1)
    expect(supplier.body.quotes[0].supplierId).toBe(String(f.supplier._id))
    expect(supplier.body.buyerPhone).toBeUndefined()
    const list = await request(app).get('/api/sourcing?status=open').set(auth('otherSupplier'))
    expect(list.body.data.some(s => s._id === id)).toBe(true)
    const revised = await quote(id, 58)
    expect(revised.status).toBe(200)
    const history = await SourcingRequest.findById(id)
    expect(history.quotes[0].status).toBe('superseded')
    expect(history.quotesCount).toBe(2)
  })
  test('rejects invalid offers without changing the request', async () => {
    const id = (await create()).body.sourcing._id
    expect((await quote(id, -1)).status).toBe(400)
    expect((await quote(id, 'nonnumeric')).status).toBe(400)
    expect((await quote(id, 10, 'buyer')).status).toBe(403)
    expect((await SourcingRequest.findById(id)).quotes).toHaveLength(0)
  })
  test('only the owning buyer can choose an active offer; acceptance closes new quotes', async () => {
    const id = (await create()).body.sourcing._id
    const first = (await quote(id, 62)).body.quote
    const second = (await quote(id, 60, 'otherSupplier')).body.quote
    const act = (offer, action, who = 'buyer') => request(app).put('/api/sourcing/' + id + '/quotes/' + offer._id + '/action').set(auth(who)).send({ action })
    expect((await act(first, 'accept', 'otherBuyer')).status).toBe(403)
    expect((await act(first, 'invalid')).status).toBe(400)
    expect((await act(first, 'reject')).status).toBe(200)
    const accepted = await act(second, 'accept')
    expect(accepted.status).toBe(200)
    expect(accepted.body.sourcing.status).toBe('fulfilled')
    expect((await quote(id, 50)).status).toBe(409)
    expect((await act(second, 'reject')).status).toBe(409)
  })
})
