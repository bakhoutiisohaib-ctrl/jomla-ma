// C2 direct public detail endpoints and logo privacy, real isolated HTTP/Mongo.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs'), os = require('os'), path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-c2-pages-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'synthetic-c2-pages-only-secret',
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', DISABLE_REDIS: '1' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const request = require('supertest'), mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const fixtures = require('./helpers/tradeFixtures')
const { mediaFixture } = require('./helpers/mediaFixture')
const { generateToken } = require('../middleware/auth')
const Product = require('../models/Product'), Store = require('../models/Store'), Supplier = require('../models/Supplier')
const MediaAsset = require('../models/MediaAsset')
let mongo, f, adminToken
const auth = token => ({ Authorization: 'Bearer ' + token })
const productUrl = () => '/api/products/' + f.product._id
const storeUrl = () => '/api/stores/' + f.store._id
const mediaUrl = ref => '/api/media/' + path.basename(ref)
jest.setTimeout(120000)
beforeAll(async () => { mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger', dbName: 'c2_public_pages' } }); await mongoose.connect(mongo.getUri('c2_public_pages')) })
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
  f = await fixtures()
  adminToken = generateToken(await Supplier.create({ role: 'admin', name: 'C2 test admin', email: 'admin@c2.test', password: 'unused-test-hash' }))
})
afterAll(async () => {
  require('../middleware/logger').logger.close(); await mongoose.disconnect(); if (mongo) await mongo.stop()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-c2-pages-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary Windows log handles only */ }
  }
})

test('direct product detail exposes prices, tiers, images, supplier and store through an explicit public projection', async () => {
  const secondary = await mediaFixture(f.supplier)
  await Product.updateOne({ _id: f.product._id }, { $set: { images: [secondary], priceTiers: [{ minQty: 10, maxQty: 49, price: 110 }, { minQty: 50, price: 100 }], moderationReason: 'PRIVATE_PRODUCT_NOTE' } })
  await Supplier.updateOne({ _id: f.supplier._id }, { $set: { verificationDoc: 'PRIVATE_DOCUMENT', iceNumber: 'PRIVATE_ICE', rejectionReason: 'PRIVATE_ACCOUNT_NOTE' } })
  await Store.updateOne({ _id: f.store._id }, { $set: { reviewReason: 'PRIVATE_STORE_NOTE', organizationId: f.organization._id } })
  const res = await request(app).get(productUrl())
  expect(res.status).toBe(200); expect(res.headers['cache-control']).toBe('no-store')
  expect(res.body.product).toMatchObject({ name: f.product.name, unit: 'زوج', moq: 10, currency: 'MAD', price: 120, images: [secondary] })
  expect(res.body.product.priceTiers).toHaveLength(2)
  expect(res.body.store._id).toBe(String(f.store._id)); expect(res.body.product.supplierId.name).toBe(f.supplier.name)
  expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE_|password|tokenVersion|email|organizationId|reviewedBy|approvedBy|moderationReason/)
  for (const ref of [res.body.product.imageUrl, ...res.body.product.images]) expect((await request(app).get(mediaUrl(ref))).status).toBe(200)
})

test.each([
  ['draft', 'product', { isDraft: true }], ['hidden', 'product', { moderationStatus: 'hidden' }],
  ['approval removed', 'product', { approvedAt: null }], ['rights withdrawn', 'product', { hasImageRights: false }],
  ['unavailable', 'product', { inStock: false, availability: 'out_of_stock' }],
  ['store pending', 'store', { reviewStatus: 'pending' }], ['store rejected', 'store', { reviewStatus: 'rejected' }],
  ['store inactive', 'store', { isActive: false }], ['store admin suspended but active', 'store', { adminSuspended: true }],
  ['supplier inactive', 'supplier', { isActive: false }], ['supplier wrong role', 'supplier', { role: 'buyer' }]
])('%s never becomes accessible through a direct product id, even with owner/admin credentials', async (_name, kind, changes) => {
  expect((await request(app).get(productUrl())).status).toBe(200)
  const Model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id
  await Model.updateOne({ _id: id }, { $set: changes })
  for (const token of [undefined, f.tokens.supplier, f.tokens.buyer, adminToken]) {
    let req = request(app).get(productUrl()); if (token) req = req.set(auth(token))
    const denied = await req; expect(denied.status).toBe(404); expect(denied.body).not.toHaveProperty('product')
  }
  if (kind !== 'product') {
    expect((await request(app).get(storeUrl())).status).toBe(404)
    expect((await request(app).get('/api/stores')).body.data).toHaveLength(0)
    expect((await request(app).get('/api/suppliers/' + f.supplier._id + '/products')).body.data || []).toHaveLength(0)
  }
})

test.each(['product', 'store', 'supplier'])('deleting the %s makes the product direct link unavailable', async kind => {
  const Model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  await Model.deleteOne({ _id: kind === 'store' ? f.store._id : kind === 'supplier' ? f.supplier._id : f.product._id })
  expect((await request(app).get(productUrl())).status).toBe(404)
})

test('a product using another supplier’s store cannot be exposed by a direct link', async () => {
  const foreign = await Store.create({ supplierId: f.otherSupplier._id, name: 'Foreign store', slug: 'foreign-c2', isActive: true, reviewStatus: 'approved' })
  await Product.updateOne({ _id: f.product._id }, { $set: { storeId: foreign._id } })
  expect((await request(app).get(productUrl())).status).toBe(404)
  expect((await request(app).get('/api/stores/' + foreign._id)).body.products).toHaveLength(0)
})

test('store search and pagination cannot include drafts, another store or another supplier', async () => {
  const otherStore = await Store.create({ supplierId: f.supplier._id, name: 'Other store', slug: 'other-c2', isActive: true, reviewStatus: 'approved' })
  const clone = extra => Product.create({ ...f.product.toObject(), _id: new mongoose.Types.ObjectId(), ...extra })
  await clone({ name: 'C2 Only match A' }); await clone({ name: 'C2 Only match B' })
  await clone({ name: 'C2 Only private', isDraft: true }); await clone({ name: 'C2 Only foreign', storeId: otherStore._id })
  const first = await request(app).get(storeUrl() + '?q=C2%20Only&limit=1&page=1')
  expect(first.status).toBe(200); expect(first.body.products).toHaveLength(1)
  expect(first.body.pagination).toMatchObject({ total: 2, pages: 2, hasNextPage: true })
  const second = await request(app).get(storeUrl() + '?q=C2%20Only&limit=1&page=2')
  expect(second.body.products[0]._id).not.toBe(first.body.products[0]._id)
  expect((await request(app).get(storeUrl() + '?q=.*')).body.products).toHaveLength(0)
  expect((await request(app).get(storeUrl() + '?supplier=' + f.otherSupplier._id)).body.products).toHaveLength(0)
  expect((await request(app).get(storeUrl() + '?page=0')).status).toBe(400)
})

test('renaming a product/store keeps id-based API links stable without aliases or data migration', async () => {
  const p = productUrl(), s = storeUrl()
  await Product.updateOne({ _id: f.product._id }, { $set: { name: 'Renamed C2 product' } })
  await Store.updateOne({ _id: f.store._id }, { $set: { name: 'Renamed C2 store', slug: 'renamed-c2' } })
  expect((await request(app).get(p)).body.product.name).toBe('Renamed C2 product')
  expect((await request(app).get(s)).body.store.name).toBe('Renamed C2 store')
})

test('an explicitly linked registered same-owner logo is public only while the store and supplier are eligible', async () => {
  const logo = await mediaFixture(f.supplier)
  expect((await request(app).get(mediaUrl(logo))).status).toBe(401)
  const saved = await request(app).put(storeUrl()).set(auth(f.tokens.supplier)).send({ logoUrl: logo })
  expect(saved.status).toBe(200)
  expect((await request(app).get(storeUrl())).body.store.logoUrl).toBe(logo)
  expect((await request(app).get(mediaUrl(logo))).status).toBe(200)
  expect((await request(app).get(logo)).status).toBe(404)
  await Store.updateOne({ _id: f.store._id }, { $set: { adminSuspended: true } })
  expect((await request(app).get(mediaUrl(logo))).status).toBe(401)
  expect((await request(app).get(mediaUrl(logo)).set(auth(f.tokens.supplier))).status).toBe(200)
  await Store.updateOne({ _id: f.store._id }, { $set: { adminSuspended: false } })
  await Supplier.updateOne({ _id: f.supplier._id }, { $set: { isActive: false } })
  expect((await request(app).get(mediaUrl(logo))).status).toBe(401)
})

test('pending store logos and unlinked banners stay private; removing a logo reference withdraws public access', async () => {
  const logo = await mediaFixture(f.supplier), banner = await mediaFixture(f.supplier)
  await Store.updateOne({ _id: f.store._id }, { $set: { logoUrl: logo, bannerUrl: banner, reviewStatus: 'pending' } })
  expect((await request(app).get(mediaUrl(logo))).status).toBe(401)
  await Store.updateOne({ _id: f.store._id }, { $set: { reviewStatus: 'approved' } })
  expect((await request(app).get(mediaUrl(logo))).status).toBe(200)
  expect((await request(app).get(mediaUrl(banner))).status).toBe(401)
  await Store.updateOne({ _id: f.store._id }, { $set: { logoUrl: '' } })
  expect((await request(app).get(mediaUrl(logo))).status).toBe(401)
})

test('remote, legacy and foreign logos are refused on writes and omitted from old public records without adoption', async () => {
  const foreign = await mediaFixture(f.otherSupplier)
  for (const logo of ['https://external.invalid/logo.png', '/uploads/unregistered-c2.png', foreign]) {
    expect((await request(app).put(storeUrl()).set(auth(f.tokens.supplier)).send({ logoUrl: logo })).status).toBe(400)
    await Store.updateOne({ _id: f.store._id }, { $set: { logoUrl: logo } })
    expect((await request(app).get(storeUrl())).body.store.logoUrl).toBe('')
    expect((await request(app).get('/api/stores')).body.data[0].logoUrl).toBe('')
  }
  expect((await request(app).get(mediaUrl(foreign))).status).toBe(401)
  expect(await MediaAsset.countDocuments({ imageUrl: '/uploads/unregistered-c2.png' })).toBe(0)
})

test('invalid/missing ids return controlled errors and cannot expose private editor documents', async () => {
  expect((await request(app).get('/api/products/not-an-id')).status).toBe(400)
  expect((await request(app).get('/api/products/' + new mongoose.Types.ObjectId())).status).toBe(404)
  expect((await request(app).get('/api/stores/not-an-id')).status).toBe(400)
  expect((await request(app).get('/api/stores/' + new mongoose.Types.ObjectId())).status).toBe(404)
  expect((await request(app).get('/api/products/mine')).status).toBe(401)
})

test('public directory pages reach beyond 100 stores, with deterministic ties and visibility filters', async () => {
  await Supplier.updateOne({_id:f.supplier._id},{$set:{businessTypes:['manufacturer']}})
  await Supplier.updateOne({_id:f.otherSupplier._id},{$set:{businessTypes:['importer']}})
  const date=new Date('2026-01-01T00:00:00Z')
  await Store.updateOne({_id:f.store._id},{$set:{createdAt:date,views:0}})
  const make=(owner,n,extra={})=>({supplierId:owner,name:'Synthetic store '+n,slug:'directory-'+n,isActive:true,reviewStatus:'approved',createdAt:date,views:0,reviewReason:'PRIVATE_STORE_NOTE',...extra})
  const rows=await Store.insertMany([
    ...Array.from({length:104},(_,i)=>make(f.supplier._id,i)),
    make(f.otherSupplier._id,104),
    make(f.supplier._id,105,{reviewStatus:'pending'}),
    make(f.supplier._id,106,{isActive:false}),
    make(f.supplier._id,107,{adminSuspended:true}),
    make(f.buyer._id,108)
  ])
  const expected=[String(f.store._id),...rows.slice(0,104).map(s=>String(s._id))].sort().reverse()
  const seen=[]
  for(let page=1;page<=9;page++){
    const res=await request(app).get('/api/stores?businessType=manufacturer&limit=12&page='+page)
    expect(res.status).toBe(200)
    expect(res.body.pagination).toMatchObject({page,limit:12,total:105,pages:9,hasNextPage:page<9,hasPrevPage:page>1})
    expect(res.body.data).toHaveLength(page===9?9:12)
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE_STORE_NOTE|reviewReason|organizationId|password/)
    seen.push(...res.body.data.map(s=>s._id))
  }
  expect(seen).toEqual(expected)
  expect(new Set(seen).size).toBe(105)
  const unfiltered=await request(app).get('/api/stores?limit=100&page=2')
  expect(unfiltered.body.pagination).toMatchObject({total:106,pages:2,hasNextPage:false})
  expect(unfiltered.body.data).toHaveLength(6)
  const importer=await request(app).get('/api/stores?businessType=importer&page=1&limit=12')
  expect(importer.body.pagination.total).toBe(1)
  expect(importer.body.data[0]._id).toBe(String(rows[104]._id))
  const empty=await request(app).get('/api/stores?businessType=artisan&page=1&limit=12')
  expect(empty.body.pagination).toMatchObject({total:0,pages:0})
  expect(empty.body.data).toEqual([])
})
