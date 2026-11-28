process.env.JWT_SECRET = 'catalog-ai-integration-test-secret'
jest.mock('@anthropic-ai/sdk', () => jest.fn())
const Anthropic = require('@anthropic-ai/sdk')
const { mediaFixture } = require('./helpers/mediaFixture')
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const fs = require('fs')
const path = require('path')
const os = require('os')
const sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const BackgroundJob = require('../models/BackgroundJob')
const VisualEmbedding = require('../models/VisualEmbedding')
const { generateToken } = require('../middleware/auth')
const { createWorker } = require('../services/jobQueue')
const handlers = require('../services/jobHandlers')
const { indexProduct } = require('../services/visualIndex')
const app = express()
app.use(express.json())
app.use('/api/product-ai', require('../routes/productAI'))
app.use('/api/image-search', require('../routes/imageSearch'))
app.use('/api/jobs', require('../routes/jobs'))
app.use((err, req, res, next) => res.status(err.status || (err.name === 'ValidationError' ? 400 : 500)).json({ message: err.message }))
let png, similarJpeg, differentImage
let mongo, token, supplier, store, temporaryDirectory, uploaded = []
const previousUploads = process.env.UPLOADS_DIR
const previousClaudeKey = process.env.CLAUDE_API_KEY
const previousVisionKey = process.env.GOOGLE_VISION_KEY
const previousThreshold = process.env.VISUAL_SEARCH_MIN_SCORE
const previousExternalEnabled = process.env.EXTERNAL_DISCOVERY_ENABLED
let serial = 0
const mockedCreate = jest.fn()
const attach = (route, buffer = png, contentType = 'image/png') => request(app).post(route).set('Authorization', 'Bearer ' + token).attach('image', buffer, { filename: 'owned.png', contentType })

beforeAll(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-product-ai-test-'))
  process.env.UPLOADS_DIR = temporaryDirectory
  process.env.VISUAL_SEARCH_MIN_SCORE = '0.82'
  process.env.EXTERNAL_DISCOVERY_ENABLED = 'false'
  const pixels = Buffer.alloc(64 * 64 * 3, 255)
  for (let y = 6; y < 58; y++) for (let x = 6; x < 58; x++) {
    const offset = (y * 64 + x) * 3
    pixels[offset] = 230; pixels[offset + 1] = 20; pixels[offset + 2] = 20
  }
  png = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer()
  similarJpeg = await sharp(png).resize(128, 128).jpeg({ quality: 90 }).toBuffer()
  differentImage = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#1020ee' } }).png().toBuffer()
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  await Promise.all([BackgroundJob.init(), VisualEmbedding.init()])
  supplier = await Supplier.create({ name: 'مورد', email: 'ai@catalog.test', password: 'test', role: 'supplier' })
  store = await Store.create({ supplierId: supplier._id, name: 'متجر', slug: 'ai', reviewStatus: 'approved', isActive: true })
  token = generateToken(supplier)
}, 120000)
beforeEach(async () => {
  delete process.env.CLAUDE_API_KEY
  delete process.env.GOOGLE_VISION_KEY
  mockedCreate.mockReset()
  Anthropic.mockImplementation(() => ({ messages: { create: mockedCreate } }))
  await Promise.all([Product.deleteMany({}), BackgroundJob.deleteMany({}), VisualEmbedding.deleteMany({})])
})
afterEach(() => {
  for (const url of uploaded) if (url?.startsWith('/uploads/')) fs.rmSync(path.join(temporaryDirectory, path.basename(url)), { force: true })
  uploaded = []
})
afterAll(async () => {
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('jomla-product-ai-test-')) fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  for (const [name, value] of [['UPLOADS_DIR', previousUploads], ['CLAUDE_API_KEY', previousClaudeKey], ['GOOGLE_VISION_KEY', previousVisionKey], ['VISUAL_SEARCH_MIN_SCORE', previousThreshold], ['EXTERNAL_DISCOVERY_ENABLED', previousExternalEnabled]]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

async function observed(id) {
  return request(app).get('/api/jobs/' + id).set('Authorization', 'Bearer ' + token)
}

async function indexedProduct(buffer = png, extra = {}) {
  ++serial
  const imageUrl = await mediaFixture(supplier, { buffer, mimetype: buffer === similarJpeg ? 'image/jpeg' : 'image/png' })
  uploaded.push(imageUrl)
  const product = await Product.create({
    supplierId: supplier._id, storeId: store._id, name: 'حذاء ' + serial, category: 'أحذية', description: 'وصف منتج مؤكد من المورد',
    pricingMode: 'fixed', price: 50, moq: 10, unit: 'زوج', currency: 'MAD', city: 'فاس',
    imageUrl, hasImageRights: true,
    imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() },
    approvedBy: supplier._id, approvedAt: new Date(), availability: 'in_stock', availabilityConfirmed: true, inStock: true, isDraft: false,
    ...extra
  })
  expect(await indexProduct(product._id, { actorId: supplier._id })).toMatchObject({ status: 'indexed' })
  return product
}

test('image upload requires login, real image bytes, and explicit rights consent', async () => {
  expect((await request(app).post('/api/product-ai/upload').attach('image', png, 'owned.png')).status).toBe(401)
  expect((await attach('/api/product-ai/upload')).status).toBe(400)
  expect((await attach('/api/product-ai/upload', Buffer.from('fake-image'), 'image/png').field('hasImageRights', 'true')).status).toBe(415)
  expect((await attach('/api/product-ai/upload', png, 'image/jpeg').field('hasImageRights', 'true')).status).toBe(415)
  expect((await attach('/api/product-ai/upload', png, 'text/plain').field('hasImageRights', 'true')).status).toBe(415)
  const res = await attach('/api/product-ai/upload').field('hasImageRights', 'true')
  uploaded.push(res.body.imageUrl)
  expect(res.status).toBe(201)
  expect(res.body.imageUrl).toMatch(/^\/uploads\/product-[a-f0-9-]+\.png$/)
})

test('all image endpoints reject oversized files before processing', async () => {
  const large = Buffer.alloc(10 * 1024 * 1024 + 1)
  for (const route of ['/api/product-ai/upload', '/api/product-ai/enhance', '/api/image-search']) {
    expect((await attach(route, large).field('hasImageRights', 'true')).status).toBe(413)
  }
})

test('truncated image headers and corrupt PNG compressed data are rejected', async () => {
  const jpegHeader = Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0])
  expect((await attach('/api/product-ai/upload', jpegHeader, 'image/jpeg').field('hasImageRights', 'true')).status).toBe(415)
  expect((await attach('/api/product-ai/upload', png.subarray(0, 35)).field('hasImageRights', 'true')).status).toBe(415)
  const corrupt = Buffer.from(png); corrupt[45] ^= 255
  expect((await attach('/api/product-ai/upload', corrupt).field('hasImageRights', 'true')).status).toBe(415)
})

test('missing provider returns explicit manual entry response and never fake draft/prices', async () => {
  const res = await attach('/api/product-ai/enhance').field('hasImageRights', 'true')
  uploaded.push(res.body.imageUrl)
  expect(res.status).toBe(503)
  expect(res.body).toMatchObject({ analysisAvailable: false, manualInputRequired: true })
  expect(res.body.imageUrl).toBeTruthy()
  expect(res.body.draft).toBeUndefined()
  expect(mockedCreate).not.toHaveBeenCalled()
})

test('provider failure is retried as a durable job and terminates without fabricated analysis or secrets', async () => {
  process.env.CLAUDE_API_KEY = 'sk-ant-test'
  mockedCreate.mockRejectedValue(new Error('provider unavailable'))
  const res = await attach('/api/product-ai/enhance').field('hasImageRights', 'true')
  uploaded.push(res.body.imageUrl)
  expect(res.status).toBe(202)
  expect(res.headers.location).toBe('/api/jobs/' + res.body.job.id)
  expect(res.body).toMatchObject({ manualInputRequired: true, job: { status: 'pending', result: null } })
  expect(mockedCreate).not.toHaveBeenCalled()
  const worker = createWorker({ handlers })
  await worker.runOnce()
  const waiting = await observed(res.body.job.id)
  expect(waiting.body.job).toMatchObject({ status: 'retry_wait', attempts: 1, error: { code: 'PROVIDER_UNAVAILABLE' }, result: null })
  await BackgroundJob.updateOne({ _id: res.body.job.id }, { $set: { nextRunAt: new Date(0) } })
  await worker.runOnce()
  const failed = await observed(res.body.job.id)
  expect(failed.body.job).toMatchObject({ status: 'failed', attempts: 2, result: null, error: { code: 'PROVIDER_UNAVAILABLE' } })
  expect(JSON.stringify(failed.body)).not.toMatch(/provider unavailable|sk-ant-test|payload|stack|leaseToken/)
  expect(await Product.countDocuments()).toBe(0)
})

test('real AI handler publishes only reviewed descriptive draft fields through the protected job result', async () => {
  process.env.CLAUDE_API_KEY = 'sk-ant-test'
  mockedCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ title: 'حذاء أسود', category: 'أحذية', description: 'حذاء بلون أسود ظاهر في الصورة', suggestedPrice: 65, suggestedMoq: 12, inStock: true, features: ['جلد أصلي'], suggestedPriceTiers: [{ minQty: 12, price: 65 }] }) }] })
  const res = await attach('/api/product-ai/enhance').field('hasImageRights', 'true')
  uploaded.push(res.body.imageUrl)
  expect(res.status).toBe(202)
  expect(res.body.job).toMatchObject({ type: 'ai_product_draft', status: 'pending', result: null })
  expect(res.body.draft).toBeUndefined()
  expect(mockedCreate).not.toHaveBeenCalled()
  await createWorker({ handlers }).runOnce()
  const result = await observed(res.body.job.id)
  expect(result.status).toBe(200)
  expect(result.body.job).toMatchObject({ status: 'succeeded', attempts: 1, result: { analysisAvailable: true, manualInputRequired: true, imageUrl: res.body.imageUrl } })
  const draft = result.body.job.result.draft
  expect(draft.title).toBe('حذاء أسود')
  expect(draft.requiresSupplierReview).toBe(true)
  expect(draft.uncertainFields).toEqual(expect.arrayContaining(['price', 'currency', 'moq', 'unit', 'availability', 'materials', 'city']))
  for (const field of ['suggestedPrice', 'suggestedMoq', 'suggestedPriceTiers', 'inStock', 'features']) expect(draft[field]).toBeUndefined()
  expect(mockedCreate).toHaveBeenCalledTimes(1)
  expect(await Product.countDocuments()).toBe(0)
})

test('invalid provider JSON terminates safely and keeps manual entry available', async () => {
  process.env.CLAUDE_API_KEY = 'sk-ant-test'
  mockedCreate.mockResolvedValue({ content: [{ type: 'text', text: 'not a structured draft' }] })
  const response = await attach('/api/product-ai/enhance').field('hasImageRights', 'true')
  uploaded.push(response.body.imageUrl)
  expect(response.status).toBe(202)
  await createWorker({ handlers }).runOnce()
  const result = await observed(response.body.job.id)
  expect(result.body.job).toMatchObject({ status: 'failed', attempts: 1, result: null, error: { code: 'PROVIDER_UNAVAILABLE' } })
  expect(response.body.manualInputRequired).toBe(true)
  expect(fs.existsSync(path.join(temporaryDirectory, path.basename(response.body.imageUrl)))).toBe(true)
})

test('visual search works without a provider and never infers matches from filenames or popular titles', async () => {
  const product = await indexedProduct(png, { name: 'shoe red square', views: 9999 })
  const first = await request(app).post('/api/image-search').attach('image', differentImage, 'shoe red square.png')
  const second = await request(app).post('/api/image-search').attach('image', differentImage, 'unrelated-name.png')
  expect(first.status).toBe(200)
  expect(first.body).toMatchObject({ analysisAvailable: true, analysisMode: 'local_visual_vectors', total: 0, exactCount: 0 })
  expect(first.body.products).toEqual(second.body.products)
  expect(first.body.products.some(item => item._id === String(product._id))).toBe(false)
  expect(first.body.externalDiscovery.enabled).toBe(false)
  expect(mockedCreate).not.toHaveBeenCalled()
  const res = await request(app).post('/api/image-search').attach('image', png, 'shoe.png')
  expect(res.status).toBe(200)
  expect(res.body.products[0]).toMatchObject({ _id: String(product._id), matchBasis: 'exact_image', matchType: 'exact' })
  expect(res.body.detectedProduct).toBe('')
  expect((await request(app).post('/api/image-search').attach('image', Buffer.from('not an image'), 'shoe.png')).status).toBe(415)
})

test('pixel vector search distinguishes exact image bytes and similar images with disjoint pagination', async () => {
  process.env.CLAUDE_API_KEY = 'sk-ant-test'
  for (let i = 0; i < 4; i++) await indexedProduct()
  for (let i = 0; i < 3; i++) await indexedProduct(similarJpeg)
  const first = await request(app).post('/api/image-search?page=1&limit=3').attach('image', png, 'ignored-name.png')
  const second = await request(app).post('/api/image-search?page=2&limit=3').attach('image', png, 'another-name.png')
  expect(first.status).toBe(200)
  expect(first.body.total).toBe(7)
  expect(first.body.exactCount).toBe(4)
  expect(first.body.similarCount).toBe(3)
  expect(first.body.visualIdentityVerified).toBe(false)
  expect(first.body.products.every(p => p.matchType === 'exact' && p.matchBasis === 'exact_image')).toBe(true)
  expect(second.body.products).toHaveLength(3)
  expect(second.body.products.filter(p => p.matchType === 'similar' && p.matchBasis === 'similar_image')).toHaveLength(2)
  expect(second.body.products.some(p => first.body.products.map(x => x._id).includes(p._id))).toBe(false)
  expect(first.body.externalDiscovery).toMatchObject({ enabled: false, externalSources: [] })
  expect(first.body.visualSearch).toMatchObject({ adapter: 'local_feature_vectors', exactMeaning: 'same_image_bytes_not_verified_product_identity' })
  expect(mockedCreate).not.toHaveBeenCalled()
})

test('arbitrary external stock image picker is disabled', async () => {
  const res = await request(app).post('/api/product-ai/search-images').send({ productName: 'shoe' })
  expect(res.status).toBe(410)
  expect(res.body.images).toEqual([])
})

test('V4.9 visual request rejects insufficient detail, confirms version and disables external text discovery',async()=>{
  const flat=await sharp({create:{width:64,height:64,channels:3,background:'#ffffff'}}).png().toBuffer()
  const invalid=await request(app).post('/api/image-search').field('visualVersion','v49-1').attach('image',flat,'blank.png')
  expect(invalid.status).toBe(422);expect(invalid.body.code).toBe('VISUAL_INSUFFICIENT_DETAIL');expect(invalid.body).not.toHaveProperty('products')
  const unknown=await request(app).post('/api/image-search').field('visualVersion','unknown').attach('image',flat,'blank.png')
  expect(unknown.status).toBe(400)
  const pixels=Buffer.from(Array.from({length:64*64*3},(_,i)=>Math.floor(i/(64*3))%8<4?30:230))
  const detailed=await sharp(pixels,{raw:{width:64,height:64,channels:3}}).png().toBuffer()
  const result=await request(app).post('/api/image-search').field('visualVersion','v49-1').field('q','shoe').attach('image',detailed,'arbitrary.png')
  expect(result.status).toBe(200);expect(result.body).toMatchObject({visualVersion:'v49-1',queryQuality:'sufficient_detail',visualIdentityVerified:false,externalDiscovery:{enabled:false,reason:'visual_search_scope'}})
})
