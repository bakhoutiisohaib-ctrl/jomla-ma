// Phase C1: real HTTP/Mongo/files, entirely disposable synthetic data.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs')
const os = require('os')
const path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-c1-public-media-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'synthetic-c1-public-media-secret',
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const { mediaFixture, png } = require('./helpers/mediaFixture')
const { generateToken } = require('../middleware/auth')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const MediaAsset = require('../models/MediaAsset')
const Membership = require('../models/Membership')
const { indexProduct, searchImage } = require('../services/visualIndex')
let mongo, f, adminToken
jest.setTimeout(120000)
const endpoint = url => '/api/media/' + path.basename(url)
const auth = token => ({ Authorization: 'Bearer ' + token })
const bytes = (res, done) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))) }
async function get(url = f.product.imageUrl, token, { method = 'get', headers = {}, route = endpoint(url) } = {}) {
  const req = request(app)[method](route).set(headers).buffer(true).parse(bytes)
  if (token) req.set(auth(token))
  return req
}
async function readable(url = f.product.imageUrl, token) {
  const res = await get(url, token)
  expect(res.status).toBe(200); expect(res.body).toEqual(png)
  expect(res.headers['content-type']).toBe('image/png')
  expect(res.headers['cache-control']).toMatch(/private, no-store/)
  expect(res.headers.vary).toMatch(/Authorization/)
  expect(res.headers.etag).toBeUndefined(); expect(res.headers['last-modified']).toBeUndefined()
  return res
}
async function blocked(url, token, options) {
  const res = await get(url, token, options)
  expect(res.status).toBe(token ? 404 : 401)
  expect(res.headers['content-type'] || '').not.toMatch(/^image\//)
  expect(Buffer.isBuffer(res.body) && res.body.equals(png)).toBe(false)
  expect(res.headers['cache-control']).toMatch(/no-store/)
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'c1_public_media', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('c1_public_media'))
})
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
  f = await fixtures()
  const admin = await Supplier.create({ role: 'admin', name: 'C1 synthetic admin', email: 'admin@c1.test', password: 'unused-test-hash' })
  adminToken = generateToken(admin)
})
afterAll(async () => {
  require('../middleware/logger').logger.close()
  await mongoose.disconnect(); if (mongo) await mongo.stop()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-c1-public-media-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary Windows log handle only */ }
  }
})

test('visitor and all authenticated roles read main/secondary published images; never open the uploads directory', async () => {
  const secondary = await mediaFixture(f.supplier)
  await Product.updateOne({ _id: f.product._id }, { $set: { images: [secondary] } })
  for (const url of [f.product.imageUrl, secondary]) {
    for (const token of [undefined, ...Object.values(f.tokens), adminToken]) await readable(url, token)
    for (const token of [undefined, f.tokens.supplier]) {
      const retired = await get(url, token, { route: url }); expect(retired.status).toBe(404)
      expect(retired.headers['content-type'] || '').not.toMatch(/^image\//)
    }
  }
  const profile = await request(app).get('/api/suppliers/' + f.supplier._id)
  expect(profile.status).toBe(200)
  expect(profile.body).not.toHaveProperty('email'); expect(profile.body).not.toHaveProperty('password')
})

test('anonymous knowledge of registered unattached or draft main/secondary URLs grants no private access', async () => {
  const main = await mediaFixture(f.supplier), secondary = await mediaFixture(f.supplier)
  await blocked(main); await blocked(secondary)
  await Product.create({ name: 'C1 private draft', supplierId: f.supplier._id, imageUrl: main, images: [secondary], isDraft: true })
  for (const url of [main, secondary]) {
    await blocked(url); await blocked(url, f.tokens.buyer); await blocked(url, f.tokens.otherSupplier)
    await readable(url, f.tokens.supplier); await readable(url, adminToken)
  }
})

test.each([
  ['unpublished', 'product', { isDraft: true }],
  ['hidden', 'product', { moderationStatus: 'hidden' }],
  ['publication approval removed', 'product', { approvedAt: null }],
  ['publication approver removed', 'product', { approvedBy: null }],
  ['image rights withdrawn', 'product', { hasImageRights: false }],
  ['image rights source invalid', 'product', { 'imageRights.source': 'unknown' }],
  ['image rights declaration removed', 'product', { 'imageRights.declaredAt': null }],
  ['out of stock', 'product', { inStock: false }],
  ['availability withdrawn', 'product', { availability: 'out_of_stock' }],
  ['availability confirmation withdrawn', 'product', { availabilityConfirmed: false }],
  ['store inactive', 'store', { isActive: false }],
  ['store admin suspended', 'store', { adminSuspended: true }],
  ['store pending review', 'store', { reviewStatus: 'pending' }],
  ['store rejected', 'store', { reviewStatus: 'rejected' }],
  ['supplier inactive', 'supplier', { isActive: false }],
  ['supplier no longer supplier', 'supplier', { role: 'buyer' }]
])('%s revokes public GET/HEAD/conditional bytes on the next request with no cache exception', async (_label, kind, changes) => {
  await readable()
  const Model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id
  await Model.updateOne({ _id: id }, { $set: changes })
  await blocked(f.product.imageUrl, undefined, { headers: { Range: 'bytes=0-4', 'If-None-Match': '*', 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } })
  await blocked(f.product.imageUrl, undefined, { method: 'head' })
  await blocked(f.product.imageUrl, f.tokens.buyer)
  await readable(f.product.imageUrl, adminToken)
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
})

test.each(['product', 'store', 'supplier'])('deleting the %s revokes anonymous access without deleting or adopting its asset', async kind => {
  await readable()
  const Model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id
  await Model.deleteOne({ _id: id })
  await blocked(f.product.imageUrl)
  expect(await MediaAsset.countDocuments({ imageUrl: f.product.imageUrl })).toBe(1)
  await readable(f.product.imageUrl, adminToken)
})

test('publication through the existing owner API opens public bytes; unpublication through it immediately closes them', async () => {
  await readable()
  const unpublished = await request(app).put('/api/products/' + f.product._id).set(auth(f.tokens.supplier)).send({ isDraft: true })
  expect(unpublished.status).toBe(200); await blocked(f.product.imageUrl)
  const republished = await request(app).put('/api/products/' + f.product._id).set(auth(f.tokens.supplier)).send({
    isDraft: false, publishApproved: true, hasImageRights: true, imageRights: { source: 'owned' }, availabilityConfirmed: true })
  expect(republished.status).toBe(200); await readable()
})

test('one surviving eligible reference keeps a shared asset public; a draft reference alone cannot', async () => {
  const copy = await Product.create({ ...f.product.toObject(), _id: new mongoose.Types.ObjectId(), isDraft: true })
  await readable()
  await Product.deleteOne({ _id: f.product._id }); await blocked(f.product.imageUrl)
  await Product.updateOne({ _id: copy._id }, { $set: { isDraft: false } }); await readable()
  await Product.updateOne({ _id: copy._id }, { $set: { imageUrl: '' } }); await blocked(f.product.imageUrl)
})

test('removing a secondary reference closes only that asset, while the main image stays public', async () => {
  const secondary = await mediaFixture(f.supplier)
  await Product.updateOne({ _id: f.product._id }, { $set: { images: [secondary] } })
  await readable(secondary)
  await Product.updateOne({ _id: f.product._id }, { $set: { images: [] } })
  await blocked(secondary); await readable(); await readable(secondary, f.tokens.supplier)
})

test('a foreign approved store or product reassignment never transfers public image provenance', async () => {
  const foreignStore = await Store.create({ name: 'C1 foreign', slug: 'c1-foreign', supplierId: f.otherSupplier._id, reviewStatus: 'approved', isActive: true })
  await Product.updateOne({ _id: f.product._id }, { $set: { storeId: foreignStore._id } })
  await blocked(f.product.imageUrl)
  await Product.updateOne({ _id: f.product._id }, { $set: { supplierId: f.otherSupplier._id } })
  await blocked(f.product.imageUrl); await blocked(f.product.imageUrl, f.tokens.otherSupplier)
  await readable(f.product.imageUrl, f.tokens.supplier)
})

test('unregistered legacy files and replaced bytes cannot become public through published references', async () => {
  const legacy = '/uploads/c1-legacy.png'
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, path.basename(legacy)), png)
  await Product.updateOne({ _id: f.product._id }, { $set: { images: [legacy] } })
  await blocked(legacy); await blocked(legacy, adminToken)
  expect(await MediaAsset.countDocuments({ imageUrl: legacy })).toBe(0)
  fs.writeFileSync(path.join(process.env.UPLOADS_DIR, path.basename(f.product.imageUrl)), Buffer.alloc(png.length, 7))
  const res = await get(); expect(res.status).toBe(404); expect(res.headers['content-type']).not.toMatch(/^image\//)
})

test('valid private staff permissions still apply and revocation affects the same JWT immediately', async () => {
  const privateUrl = await mediaFixture(f.supplier)
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: ['manage_products'] } })
  await readable(privateUrl, f.tokens.staff)
  await Membership.updateOne({ _id: f.membership._id }, { $set: { permissions: ['manage_rfq'] } })
  await blocked(privateUrl, f.tokens.staff); await blocked(privateUrl)
  await readable(f.product.imageUrl, f.tokens.staff)
})

test('invalid supplied credentials are rejected; logged-out callers can still read genuinely public media as visitors', async () => {
  const invalid = await get(f.product.imageUrl, 'invalid-synthetic-jwt')
  expect(invalid.status).toBe(401)
  expect((await request(app).post('/api/suppliers/logout').set(auth(f.tokens.buyer))).status).toBe(200)
  expect((await get(f.product.imageUrl, f.tokens.buyer)).status).toBe(401)
  await readable()
  const privateUrl = await mediaFixture(f.supplier)
  await blocked(privateUrl, undefined, { route: endpoint(privateUrl) + '?token=' + f.tokens.supplier,
    headers: { Cookie: 'token=' + f.tokens.supplier } })
})

test('anonymous HEAD and range/conditional requests retain live checks and never return 304 or partial cached bytes', async () => {
  const head = await get(undefined, undefined, { method: 'head' })
  expect(head.status).toBe(200); expect(head.headers['content-length']).toBe(String(png.length)); expect(head.text || '').toBe('')
  expect(Buffer.isBuffer(head.body) && head.body.length > 0).toBe(false)
  const res = await get(undefined, undefined, { headers: { Range: 'bytes=0-4', 'If-None-Match': '*' } })
  expect(res.status).toBe(200); expect(res.body).toEqual(png); expect(res.headers['accept-ranges']).toBe('none')
})

test('anonymous catalog/store/visual results keep managed images working without persistent anonymous uploads', async () => {
  expect((await indexProduct(f.product._id)).status).toBe('indexed')
  const count = await MediaAsset.countDocuments(), files = fs.readdirSync(process.env.UPLOADS_DIR)
  const catalog = await request(app).get('/api/products')
  const store = await request(app).get('/api/stores/' + f.store._id)
  expect(catalog.body.data[0].imageUrl).toBe(f.product.imageUrl)
  expect(store.body.products[0].imageUrl).toBe(f.product.imageUrl)
  await readable(catalog.body.data[0].imageUrl)
  const visual = await request(app).post('/api/image-search').attach('image', png, { filename: 'query.png', contentType: 'image/png' })
  expect(visual.status).toBe(200); expect(visual.body.exactMatches.map(p => p._id)).toContain(String(f.product._id))
  expect(await MediaAsset.countDocuments()).toBe(count); expect(fs.readdirSync(process.env.UPLOADS_DIR)).toEqual(files)
  const upload = await request(app).post('/api/product-ai/upload').attach('image', png, { filename: 'new.png', contentType: 'image/png' })
  expect(upload.status).toBe(401); expect(await MediaAsset.countDocuments()).toBe(count)
  await Store.updateOne({ _id: f.store._id }, { $set: { adminSuspended: true } })
  expect((await searchImage(png)).total).toBe(0); await blocked(f.product.imageUrl)
})
