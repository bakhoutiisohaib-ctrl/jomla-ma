process.env.JWT_SECRET = 'catalog-integration-test-secret'
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const { generateToken } = require('../middleware/auth')
const { mediaFixture } = require('./helpers/mediaFixture')
const app = express()
app.use(express.json())
app.use('/api/products', require('../routes/products'))
app.use('/api/ai-search', require('../routes/aiSearch'))
app.use('/api/tracking', require('../routes/tracking'))
app.use((err, req, res, next) => res.status(err.status || (err.name === 'ValidationError' ? 400 : 500)).json({ message: err.message }))

let mongo, owner, other, buyer, store, otherStore, token, otherToken, buyerToken, ownerImage, otherImage
const published = (extra = {}) => ({
  name: 'حذاء مهني', category: 'أحذية', price: 50, currency: 'MAD', country: 'MA',
  moq: 10, unit: 'زوج', city: 'فاس', description: 'وصف مؤكد من المورد لهذا المنتج',
  imageUrl: ownerImage,
  hasImageRights: true, imageRights: { source: 'owned' },
  availability: 'in_stock', availabilityConfirmed: true, inStock: true,
  isDraft: false, publishApproved: true, storeId: String(store._id), ...extra
})
const create = (body, auth = token) => request(app).post('/api/products').set('Authorization', 'Bearer ' + auth).send(body)

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  ;[owner, other, buyer] = await Supplier.create([
    { name: 'مصنع الأمل', email: 'owner@catalog.test', password: 'test', role: 'supplier', phone: '+212611111111' },
    { name: 'مورد آخر', email: 'other@catalog.test', password: 'test', role: 'supplier' },
    { name: 'مشتري', email: 'buyer@catalog.test', password: 'test', role: 'buyer' }
  ])
  store = await Store.create({ supplierId: owner._id, name: 'متجر الأمل', slug: 'owner', reviewStatus: 'approved', isActive: true })
  otherStore = await Store.create({ supplierId: other._id, name: 'متجر آخر', slug: 'other', reviewStatus: 'approved', isActive: true })
  await Organization.create({ name: 'شركة الأمل', ownerSupplierId: owner._id })
  ownerImage = await mediaFixture(owner)
  otherImage = await mediaFixture(other)
  token = generateToken(owner); otherToken = generateToken(other); buyerToken = generateToken(buyer)
}, 120000)
beforeEach(async () => { await Product.deleteMany({}) })
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

test('incomplete drafts are private and have no implicit rights or availability', async () => {
  const res = await create({ storeId: '', name: '', category: '', description: '', imageUrl: '' })
  expect(res.status).toBe(201)
  expect(res.body.product).toMatchObject({ isDraft: true, hasImageRights: false, inStock: false, availability: 'unknown', availabilityConfirmed: false })
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  expect((await request(app).get('/api/tracking/trending')).body.data).toHaveLength(0)
  expect((await request(app).get('/api/products/mine').set('Authorization', 'Bearer ' + token)).body.data).toHaveLength(1)
})

test('publishing requires explicit approval, rights, availability and an owned approved store', async () => {
  for (const override of [
    { publishApproved: false }, { hasImageRights: false }, { availabilityConfirmed: false },
    { imageUrl: '' }, { description: 'قصير' }, { storeId: String(otherStore._id) },
    { availability: 'unknown' }, { imageRights: { source: 'licensed' } }, { imageUrl: 'javascript:alert(1)' },
    { imageUrl: '/uploads/non-existent.jpg' }
  ]) expect((await create(published(override))).status).toBe(400)
  const pending = await Store.create({ supplierId: owner._id, name: 'قيد المراجعة', slug: 'pending', isActive: false })
  expect((await create(published({ storeId: String(pending._id) }))).status).toBe(400)
  const ok = await create(published({ approvedBy: other._id, supplierId: other._id, views: 999 }))
  expect(ok.status).toBe(201)
  expect(ok.body.product.supplierId).toBe(String(owner._id))
  expect(ok.body.product.approvedBy).toBe(String(owner._id))
  expect(ok.body.product.imageRights.declaredBy).toBe(String(owner._id))
  expect(ok.body.product.views).toBe(0)
  expect(ok.body.product.approvedAt).toBeTruthy()
})

test('draft/public endpoints enforce owner identity and RBAC', async () => {
  const res = await create({ name: 'مسودة' })
  const id = res.body.product._id
  expect((await create({}, buyerToken)).status).toBe(403)
  expect((await request(app).get('/api/products/mine')).status).toBe(401)
  expect((await request(app).put('/api/products/' + id).set('Authorization', 'Bearer ' + otherToken).send({ name: 'سرقة' })).status).toBe(404)
  expect((await request(app).delete('/api/products/' + id).set('Authorization', 'Bearer ' + otherToken)).status).toBe(404)
})

test('active staff with membership manage owner products without taking ownership', async () => {
  const staff = await Supplier.create({ name: 'موظف', email: 'staff@catalog.test', password: 'test', role: 'staff' })
  const org = await Organization.findOne({ ownerSupplierId: owner._id })
  await Membership.create({ userId: staff._id, organizationId: org._id, invitedEmail: staff.email, invitedBy: owner._id, role: 'staff', status: 'active', permissions: ['manage_products'] })
  const res = await create(published(), generateToken(staff))
  expect(res.status).toBe(201)
  expect(res.body.product.supplierId).toBe(String(owner._id))
  expect(res.body.product.approvedBy).toBe(String(staff._id))
})

test('rejects reversed, overlapping, fractional and below-MOQ price tiers', async () => {
  for (const tiers of [
    [{ minQty: 20, maxQty: 10, price: 50 }],
    [{ minQty: 10, maxQty: 30, price: 50 }, { minQty: 20, price: 45 }],
    [{ minQty: 1, price: 40 }],
    [{ minQty: 10.5, price: 40 }]
  ]) expect((await create(published({ priceTiers: tiers }))).status).toBe(400)
})

test('on-request pricing has no fabricated numeric price', async () => {
  const res = await create(published({ pricingMode: 'on_request', price: null }))
  expect(res.status).toBe(201)
  expect(res.body.product.pricingMode).toBe('on_request')
  expect(res.body.product.price).toBeUndefined()
  const list = await request(app).get('/api/products')
  expect(list.body.data[0].currency).toBe('MAD')
  expect(list.body.data[0].pricingMode).toBe('on_request')
})

test('published update needs renewed explicit approval and rights', async () => {
  const res = await create(published())
  const edit = await request(app).put('/api/products/' + res.body.product._id).set('Authorization', 'Bearer ' + token).send({ name: 'تعديل' })
  expect(edit.status).toBe(400)
})

test('public catalog and tracking exclude drafts, unavailable, moderated, and closed-store products', async () => {
  const visible = await create(published())
  const hidden = await create(published({ name: 'محجوب' }))
  await Product.updateOne({ _id: hidden.body.product._id }, { $set: { moderationStatus: 'hidden' } })
  await create(published({ name: 'غير متوفر', availability: 'out_of_stock', inStock: false }))
  await create({ name: 'مسودة خاصة', imageUrl: ownerImage })
  const inactive = await create(published({ storeId: String(otherStore._id), name: 'متجر مغلق', imageUrl: otherImage }), otherToken)
  await Store.updateOne({ _id: otherStore._id }, { $set: { isActive: false } })
  const list = await request(app).get('/api/products')
  expect(list.status).toBe(200)
  expect(list.body.data.map(p => p._id)).toEqual([visible.body.product._id])
  expect((await request(app).post('/api/tracking/view/' + hidden.body.product._id)).status).toBe(404)
  expect((await request(app).post('/api/tracking/view/' + inactive.body.product._id)).status).toBe(404)
  await Store.updateOne({ _id: otherStore._id }, { $set: { isActive: true } })
})

test('filters use confirmed catalog data, quantity price tiers and supplier names', async () => {
  await create(published({ name: 'حذاء عادي', price: 100, priceTiers: [{ minQty: 10, maxQty: 49, price: 100 }, { minQty: 50, price: 60 }] }))
  await create(published({ name: 'حذاء بعيد', city: 'طنجة', moq: 100, price: 40 }))
  const res = await request(app).get('/api/products/search').query({ q: 'حذاء', city: 'فاس', quantity: 60, minPrice: 55, maxPrice: 65, supplier: 'الأمل', currency: 'MAD', order: 'price_asc' })
  expect(res.status).toBe(200)
  expect(res.body.data).toHaveLength(1)
  expect(res.body.data[0].effectiveUnitPrice).toBe(60)
  for (const query of [{ quantity: -1 }, { minPrice: 100, maxPrice: 1 }, { city: ['a', 'b'] }, { order: 'unsafe' }]) {
    expect((await request(app).get('/api/products/search').query(query)).status).toBe(400)
  }
})

test('pagination and totals include all matches, exact title text comes before similar words', async () => {
  for (let i = 0; i < 7; i++) await create(published({ name: 'حذاء موديل ' + i }))
  await create(published({ name: 'حذاء' }))
  const res = await request(app).post('/api/ai-search').send({ query: 'حذاء', limit: 3, page: 1 })
  expect(res.status).toBe(200)
  expect(res.body.total).toBe(8)
  expect(res.body.exactCount).toBe(1)
  expect(res.body.products[0].name).toBe('حذاء')
  expect(res.body.products[0].matchBasis).toBe('title_text')
  const second = await request(app).post('/api/ai-search').send({ query: 'حذاء', limit: 3, page: 2 })
  expect(second.body.products).toHaveLength(3)
  expect(second.body.products.some(p => res.body.products.map(x => x._id).includes(p._id))).toBe(false)
  const mine = await request(app).get('/api/products/mine?page=2&limit=3').set('Authorization', 'Bearer ' + token)
  expect(mine.body.pagination.total).toBe(8)
  expect(mine.body.data).toHaveLength(3)
})

test('special regex input cannot change query structure or throw', async () => {
  for (const q of ['[a-z', '(', '(a+)+', '*+', '??', '{\\']) {
    const res = await request(app).get('/api/products/search').query({ q })
    expect(res.status).toBe(200)
    expect(res.body.pagination.total).toBe(0)
  }
})

test('deactivated supplier catalog disappears immediately and deletion records completed audit', async () => {
  const res = await create(published())
  await Supplier.updateOne({ _id: owner._id }, { $set: { isActive: false } })
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  await Supplier.updateOne({ _id: owner._id }, { $set: { isActive: true } })
  expect((await request(app).delete('/api/products/' + res.body.product._id).set('Authorization', 'Bearer ' + token)).status).toBe(200)
  const event = await require('../models/AuditLog').findOne({ action: 'PRODUCT_DELETED', targetId: res.body.product._id })
  expect(event.phase).toBe('completed')
  expect(String(event.performedBy.id)).toBe(String(owner._id))
})
