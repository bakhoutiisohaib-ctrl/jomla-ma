require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Review = require('../models/Review')
const Product = require('../models/Product')
const AuditLog = require('../models/AuditLog')
const Analytics = require('../models/Analytics')
const { generateToken } = require('../middleware/auth')

let server
let sequence = 0
const auth = token => ({ Authorization: 'Bearer ' + token })
async function account(role = 'buyer') {
  const user = await Supplier.create({ name: 'مستخدم موثوق ' + ++sequence, email: 'trust-' + sequence + '@test.ma', password: 'fixture-hash', role })
  return { user, token: generateToken(user) }
}
beforeAll(async () => {
  server = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(server.getUri())
  await Review.init()
})
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
})
afterAll(async () => {
  await mongoose.disconnect()
  if (server) await server.stop()
})

test('reviews require buyer/admin identity and refuse forged names, supplier replies and dates', async () => {
  const owner = await account('supplier')
  const buyer = await account()
  const body = { supplierId: String(owner.user._id), stars: 4, comment: 'تقييم قائم على تجربتي' }
  expect((await request(app).post('/api/reviews').send(body)).status).toBe(401)
  expect((await request(app).post('/api/reviews').set(auth(owner.token)).send(body)).status).toBe(403)
  for (const extra of [{ userName: 'شخص آخر' }, { reply: { text: 'رد مورد مزور' } }, { date: '2000-01-01' }]) {
    expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ ...body, ...extra })).status).toBe(400)
  }
  const result = await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)
  expect(result.status).toBe(201)
  expect(result.body.review.userName).toBe(buyer.user.name)
  expect(result.body.review.buyerId).toBe(String(buyer.user._id))
  expect(result.body.review.reply?.text).toBeUndefined()
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)).status).toBe(409)
  expect(await Review.countDocuments()).toBe(1)
})

test('supplier existence, active status and optional product relationship are enforced', async () => {
  const owner = await account('supplier')
  const other = await account('supplier')
  const buyer = await account()
  const draft = await Product.create({ supplierId: other.user._id, name: 'منتج خاص', isDraft: true })
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), productId: String(draft._id), stars: 5 })).status).toBe(400)
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(new mongoose.Types.ObjectId()), stars: 5 })).status).toBe(404)
  await Supplier.updateOne({ _id: owner.user._id }, { $set: { isActive: false } })
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 5 })).status).toBe(404)
  expect(await Review.countDocuments()).toBe(0)
})

test('rating stats aggregate all reviews regardless of page and hide internal buyer ids', async () => {
  const owner = await account('supplier')
  for (const stars of [1, 3, 5]) {
    const buyer = await account()
    const result = await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars })
    expect(result.status).toBe(201)
  }
  const response = await request(app).get('/api/reviews/' + owner.user._id + '?page=2&limit=1')
  expect(response.status).toBe(200)
  expect(response.body.data).toHaveLength(1)
  expect(response.body.stats).toEqual({ avg: 3, total: 3 })
  expect(response.body.pagination.total).toBe(3)
  expect(response.body.data[0]).not.toHaveProperty('buyerId')
})

test('only the owning supplier can reply and only an admin can remove a review with an audit', async () => {
  const owner = await account('supplier')
  const other = await account('supplier')
  const buyer = await account()
  const admin = await account('admin')
  const created = await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 1, comment: 'تجربة تحتاج تحسيناً' })
  const id = created.body.review._id
  expect((await request(app).post('/api/suppliers/me/reviews/' + id + '/reply').set(auth(other.token)).send({ text: 'رد منتحل' })).status).toBe(404)
  const reply = await request(app).post('/api/suppliers/me/reviews/' + id + '/reply').set(auth(owner.token)).send({ text: 'شكراً، سنتواصل لمعالجة المشكلة' })
  expect(reply.status).toBe(200)
  expect(await AuditLog.countDocuments({ action: 'REVIEW_REPLIED', targetId: id, phase: 'completed' })).toBe(1)
  expect((await request(app).delete('/api/suppliers/me/reviews/' + id).set(auth(owner.token))).status).toBe(403)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(owner.token)).send({ reason: 'حذف التقييم السلبي' })).status).toBe(403)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(admin.token)).send({})).status).toBe(400)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(admin.token)).send({ reason: 'تقييم مخالف بعد المراجعة' })).status).toBe(200)
  expect(await Review.findById(id)).toBeNull()
  expect(await AuditLog.countDocuments({ action: 'REVIEW_DELETED', targetId: id, phase: 'completed', 'performedBy.id': admin.user._id })).toBe(1)
})

test('concurrent reviews from one account create at most one rating', async () => {
  const owner = await account('supplier')
  const buyer = await account()
  const submit = () => request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 3 })
  const results = await Promise.all([submit(), submit()])
  expect(results.map(result => result.status).sort()).toEqual([201, 409])
  expect(await Review.countDocuments({ buyerId: buyer.user._id, supplierId: owner.user._id })).toBe(1)
})

test('analytics requires authentication, restricts event metadata and protects summaries to admins', async () => {
  const buyer = await account()
  const admin = await account('admin')
  const event = { event: 'search', meta: { query: 'منتج' } }
  expect((await request(app).post('/api/analytics').send(event)).status).toBe(401)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send(event)).status).toBe(201)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send({ event: 'rfq_created', meta: {} })).status).toBe(400)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send({ event: 'search', meta: { email: 'private@test.ma' } })).status).toBe(400)
  expect((await request(app).get('/api/analytics/summary')).status).toBe(401)
  expect((await request(app).get('/api/analytics/summary').set(auth(buyer.token))).status).toBe(403)
  const summary = await request(app).get('/api/analytics/summary').set(auth(admin.token))
  expect(summary.status).toBe(200)
  expect(summary.body.total).toBe(1)
  expect(await Analytics.countDocuments()).toBe(1)
})

