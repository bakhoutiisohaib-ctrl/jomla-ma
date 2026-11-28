process.env.JWT_SECRET = 'rfq-test-secret-with-sufficient-length'
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const QuoteOffer = require('../models/QuoteOffer')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Supplier = require('../models/Supplier')
const QuoteRequest = require('../models/QuoteRequest')
const Membership = require('../models/Membership')
const Notification = require('../models/Notification')
let mongo, f
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } }); await mongoose.connect(mongo.getUri()); f = await fixtures() }, 120000)
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() }, 120000)
const auth = who => ({ Authorization: 'Bearer ' + f.tokens[who] })
async function create(body = {}) {
  return request(app).post('/api/rfq').set(auth('buyer')).send({ productId: f.product._id, quantity: 20, buyerPhone: '+212600000001', ...body })
}
async function respond(id, price = 100, who = 'supplier') {
  return request(app).put('/api/rfq/' + id + '/respond').set(auth(who)).send({ unitPrice: price, deliveryDays: 4, paymentTerms: 'تحويل بعد التأكيد' })
}

describe('RFQ authorization and complete lifecycle', () => {
  test('requires an authenticated buyer and validates MOQ and availability', async () => {
    expect((await request(app).post('/api/rfq').send({})).status).toBe(401)
    expect((await request(app).post('/api/rfq').set(auth('supplier')).send({})).status).toBe(403)
    expect((await create({ quantity: 1 })).status).toBe(400)
    expect((await create({ quantity: 1.5 })).status).toBe(400)
    expect((await create({ targetPrice: 'invalid' })).status).toBe(400)
    await Product.updateOne({ _id: f.product._id }, { $set: { inStock: false } })
    expect((await create()).status).toBe(404)
    await Product.updateOne({ _id: f.product._id }, { $set: { inStock: true, isDraft: true } })
    expect((await create()).status).toBe(404)
    await Product.updateOne({ _id: f.product._id }, { $set: { isDraft: false } })
    await Supplier.updateOne({ _id: f.supplier._id }, { $set: { isActive: false } })
    expect((await create()).status).toBe(404)
    await Supplier.updateOne({ _id: f.supplier._id }, { $set: { isActive: true } })
    await Store.updateOne({ _id: f.store._id }, { $set: { supplierId: f.otherSupplier._id } })
    expect((await create()).status).toBe(404)
    await Store.updateOne({ _id: f.store._id }, { $set: { supplierId: f.supplier._id } })
  })
  test('binds buyer identity to the session and isolates listings', async () => {
    const result = await create({ buyerId: f.otherBuyer._id, buyerName: 'forged name' })
    expect(result.status).toBe(201)
    expect(result.body.rfq.buyerId).toBe(String(f.buyer._id))
    expect(result.body.rfq.buyerName).toBe(f.buyer.name)
    expect((await request(app).get('/api/rfq/buyer').set(auth('otherBuyer'))).body.data).toHaveLength(0)
    const mine = await request(app).get('/api/rfq/buyer').set(auth('buyer'))
    expect(mine.body.data.some(r => r._id === result.body.rfq._id)).toBe(true)
    expect((await request(app).get('/api/rfq/supplier').set(auth('otherSupplier'))).body.data).toHaveLength(0)
  })
  test('blocks anonymous and non-party reads, decisions, and messages', async () => {
    const id = (await create()).body.rfq._id
    for (const suffix of ['', '/thread']) {
      expect((await request(app).get('/api/rfq/' + id + suffix)).status).toBe(401)
      expect((await request(app).get('/api/rfq/' + id + suffix).set(auth('otherBuyer'))).status).toBe(403)
      expect((await request(app).get('/api/rfq/' + id + suffix).set(auth('otherSupplier'))).status).toBe(403)
    }
    expect((await request(app).post('/api/rfq/' + id + '/messages').set(auth('otherBuyer')).send({ content: 'intrusion' })).status).toBe(403)
    expect((await respond(id, 100, 'otherSupplier')).status).toBe(403)
    const offer = (await respond(id)).body.offer
    expect((await request(app).put('/api/rfq/' + id + '/action').set(auth('otherBuyer')).send({ action: 'accept', offerId: offer._id })).status).toBe(403)
  })
  test('derives message role/name from identity and enforces message bounds', async () => {
    const id = (await create()).body.rfq._id
    const result = await request(app).post('/api/rfq/' + id + '/messages').set(auth('buyer')).send({ content: 'هل تتوفر الألوان؟', senderRole: 'admin', senderName: 'forged' })
    expect(result.status).toBe(201)
    const message = result.body.thread.messages.at(-1)
    expect(message.senderRole).toBe('buyer')
    expect(message.senderName).toBe(f.buyer.name)
    expect(message.senderId).toBe(String(f.buyer._id))
    expect((await request(app).post('/api/rfq/' + id + '/messages').set(auth('buyer')).send({ content: ' ' })).status).toBe(400)
    expect((await request(app).post('/api/rfq/' + id + '/messages').set(auth('buyer')).send({ content: 'a'.repeat(5001) })).status).toBe(400)
  })
  test('supersedes old offers, requires current offer id, and closes acceptance', async () => {
    const id = (await create()).body.rfq._id
    const old = (await respond(id, 105)).body.offer
    const current = (await respond(id, 99)).body.offer
    expect((await QuoteOffer.findById(old._id)).status).toBe('superseded')
    const action = body => request(app).put('/api/rfq/' + id + '/action').set(auth('buyer')).send(body)
    expect((await action({ action: 'accept' })).status).toBe(400)
    expect((await action({ action: 'invalid', offerId: current._id })).status).toBe(400)
    expect((await action({ action: 'accept', offerId: old._id })).status).toBe(409)
    const result = await action({ action: 'accept', offerId: current._id })
    expect(result.status).toBe(200)
    expect(result.body.rfq.status).toBe('accepted')
    expect((await QuoteOffer.findById(current._id)).status).toBe('accepted')
    expect((await respond(id, 88)).status).toBe(409)
    expect((await action({ action: 'reject', offerId: current._id })).status).toBe(409)
    expect((await request(app).post('/api/rfq/' + id + '/messages').set(auth('buyer')).send({ content: 'reopen' })).status).toBe(409)
  })
  test('supports rejection while preserving a closed history', async () => {
    const id = (await create()).body.rfq._id
    const offer = (await respond(id)).body.offer
    const result = await request(app).put('/api/rfq/' + id + '/action').set(auth('buyer')).send({ action: 'reject', offerId: offer._id })
    expect(result.status).toBe(200)
    expect(result.body.rfq.status).toBe('rejected')
    const thread = await request(app).get('/api/rfq/' + id + '/thread').set(auth('buyer'))
    expect(thread.body.thread.status).toBe('closed')
    expect(thread.body.offers[0].status).toBe('rejected')
  })
  test('concurrent responses leave only the selected current offer active', async () => {
    const id = (await create()).body.rfq._id
    const results = await Promise.all([respond(id, 103), respond(id, 101)])
    expect(results.every(result => [200, 409].includes(result.status))).toBe(true)
    const rfq = await QuoteRequest.findById(id)
    const active = await QuoteOffer.find({ rfqId: id, status: 'active' })
    expect(active).toHaveLength(1)
    expect(String(active[0]._id)).toBe(String(rfq.currentOfferId))
    const decisions = await Promise.all(['accept', 'reject'].map(action => request(app).put('/api/rfq/' + id + '/action').set(auth('buyer')).send({ action, offerId: active[0]._id })))
    expect(decisions.map(r => r.status).sort()).toEqual([200, 409])
  })
  test('uses active staff membership and immediately honors revoked permissions', async () => {
    const id = (await create()).body.rfq._id
    expect((await request(app).get('/api/rfq/supplier').set(auth('staff'))).body.data.some(r => r._id === id)).toBe(true)
    expect((await respond(id, 100, 'staff')).status).toBe(200)
    await Membership.updateOne({ _id: f.membership._id }, { $set: { status: 'revoked' } })
    expect((await respond(id, 100, 'staff')).status).toBe(403)
    expect((await request(app).get('/api/rfq/' + id + '/thread').set(auth('staff'))).status).toBe(403)
  })
  test('persists private notifications and read state per recipient', async () => {
    const id = (await create()).body.rfq._id
    await respond(id)
    const buyerInbox = await request(app).get('/api/notifications').set(auth('buyer'))
    expect(buyerInbox.status).toBe(200)
    const entry = buyerInbox.body.data.find(n => n.resourceId === id && n.type === 'offer_received')
    expect(entry).toBeDefined()
    expect(entry.readAt).toBeNull()
    expect((await request(app).put('/api/notifications/' + entry._id + '/read').set(auth('otherBuyer'))).status).toBe(404)
    expect((await request(app).put('/api/notifications/' + entry._id + '/read').set(auth('buyer'))).status).toBe(200)
    expect((await Notification.findById(entry._id)).readAt).not.toBeNull()
    await request(app).put('/api/notifications/read-all').set(auth('buyer'))
    expect((await request(app).get('/api/notifications').set(auth('buyer'))).body.unreadCount).toBe(0)
  })
})
