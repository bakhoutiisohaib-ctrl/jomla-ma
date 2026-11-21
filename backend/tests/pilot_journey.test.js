// The application and every model use only this disposable MongoDB instance.
// dotenv is disabled so no credentials or database URI from the owner's .env
// can enter the exercise; provider calls fail the test if unexpectedly reached.
jest.mock('dotenv', () => ({ config: jest.fn() }))
jest.mock('@anthropic-ai/sdk', () => jest.fn(() => { throw new Error('Live AI is forbidden in this isolated pilot exercise') }))
const fs = require('fs')
const os = require('os')
const path = require('path')
const sharp = require('sharp')
const request = require('supertest')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const Anthropic = require('@anthropic-ai/sdk')
const { performance } = require('perf_hooks')
const { MongoMemoryServer } = require('mongodb-memory-server')

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-pilot-api-'))
const uploadRoot = path.join(temporaryRoot, 'uploads')
fs.mkdirSync(uploadRoot)
const overridden = {
  NODE_ENV: 'test', JWT_SECRET: 'Pilot-Only-JWT-Secret-2026-No-Production-Use',
  MONGODB_URI: '', UPLOADS_DIR: uploadRoot, LOG_DIR: path.join(temporaryRoot, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false',
  BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1', VISUAL_SEARCH_MIN_SCORE: '0.82'
}
const previousEnvironment = Object.fromEntries(Object.keys(overridden).map(key => [key, process.env[key]]))
Object.assign(process.env, overridden)

const app = require('../server')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const Store = require('../models/Store')
const Organization = require('../models/Organization')
const BackgroundJob = require('../models/BackgroundJob')
const VisualEmbedding = require('../models/VisualEmbedding')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const AuditLog = require('../models/AuditLog')
const { createWorker } = require('../services/jobQueue')
const handlers = require('../services/jobHandlers')
const { logger } = require('../middleware/logger')
const password = 'Pilot-Test-Only-2026!'
const auth = account => ({ Authorization: 'Bearer ' + account.token })
const timings = []
const completedChecks = []
let mongo, admin, supplier, competitor, buyer, otherBuyer, redImage, resizedRedImage, blueImage
let legacyId, oldLegacy, mainProductId, competitorProductId, privateDraftId, rfqId, acceptedOfferId
let worker

async function timed(label, operation) {
  const started = performance.now()
  const result = await operation()
  timings.push({ operation: label, milliseconds: Math.round((performance.now() - started) * 10) / 10 })
  return result
}

async function register(role, suffix, name) {
  const result = await request(app).post('/api/suppliers/register').send({
    role, name, email: suffix + '@pilot-isolated.test', password, city: 'الدار البيضاء', phone: '+212600000001'
  })
  expect(result.status).toBe(201)
  expect(result.body.supplier.role).toBe(role)
  expect(result.body.supplier.password).toBeUndefined()
  return { ...result.body.supplier, token: result.body.token }
}

async function upload(account, buffer, filename) {
  const result = await request(app).post('/api/product-ai/upload').set(auth(account))
    .field('hasImageRights', 'true').attach('image', buffer, { filename, contentType: 'image/png' })
  expect(result.status).toBe(201)
  expect(result.body.imageUrl).toMatch(/^\/uploads\/product-[a-f0-9-]+\.png$/)
  expect(fs.readFileSync(path.join(uploadRoot, path.basename(result.body.imageUrl))).equals(buffer)).toBe(true)
  return result.body.imageUrl
}

async function createStore(account, name) {
  const company = await request(app).put('/api/suppliers/me/organization').set(auth(account)).send({
    name, city: 'الدار البيضاء', country: 'MA', description: 'شركة وهمية واضحة لاختبار التجربة التجارية فقط'
  })
  expect(company.status).toBe(200)
  expect(String((await Organization.findById(company.body.organization._id)).ownerSupplierId)).toBe(account._id)
  const result = await request(app).post('/api/stores').set(auth(account)).send({
    name: 'متجر تجريبي ' + name, city: 'الدار البيضاء', address: 'عنوان وهمي للاختبار', categories: ['ملابس'],
    description: 'متجر تجريبي لا يعرض سلعاً أو مخزوناً حقيقياً'
  })
  expect(result.status).toBe(201)
  expect(result.body.store).toMatchObject({ reviewStatus: 'pending', isActive: false })
  return result.body.store._id
}

async function approveStore(storeId) {
  const result = await request(app).put('/api/admin/stores/' + storeId + '/review').set(auth(admin))
    .send({ action: 'approve', reason: 'اعتماد متجر وهمي لاختبار معزول فقط' })
  expect(result.status).toBe(200)
  expect(result.body.store).toMatchObject({ reviewStatus: 'approved', isActive: true })
}

function publishPayload(storeId, imageUrl, extra = {}) {
  return {
    name: 'قميص تجريبي أحمر / Chemise pilote rouge', category: 'ملابس',
    description: 'منتج وبيانات وهمية للاختبار فقط، يؤكدها المورد التجريبي دون بيع حقيقي.',
    storeId, imageUrl, images: [imageUrl], currency: 'MAD', country: 'MA', unit: 'قطعة', moq: 12,
    city: 'الدار البيضاء', pricingMode: 'fixed', price: 60,
    priceTiers: [{ minQty: 12, maxQty: 49, price: 60 }, { minQty: 50, price: 54 }],
    availability: 'in_stock', inStock: true, availabilityConfirmed: true,
    hasImageRights: true, imageRights: { source: 'owned' }, publishApproved: true, isDraft: false,
    ...extra
  }
}

async function drainQueue() {
  let handled = 0
  while (handled < 20 && await worker.runOnce()) handled++
  expect(handled).toBeLessThan(20)
  expect(await BackgroundJob.countDocuments({ status: { $in: ['pending', 'running', 'retry_wait', 'failed'] } })).toBe(0)
}

beforeAll(async () => {
  // Actual local image decoding and actual MongoDB, not mocked persistence.
  redImage = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#de1b2c' } }).png().toBuffer()
  resizedRedImage = await sharp(redImage).resize(120, 120).jpeg({ quality: 90 }).toBuffer()
  blueImage = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#123be9' } }).png().toBuffer()
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'jomla_pilot_isolated', storageEngine: 'wiredTiger' } })
  process.env.MONGODB_URI = mongo.getUri()
  await mongoose.connect(mongo.getUri())
  await Promise.all([Supplier.init(), BackgroundJob.init(), VisualEmbedding.init()])
  const adminDocument = await Supplier.create({ role: 'admin', name: 'مشرف اختبار وهمي', email: 'admin@pilot-isolated.test', password: await bcrypt.hash(password, 4) })
  const login = await request(app).post('/api/admin/login').send({ email: adminDocument.email, password })
  expect(login.status).toBe(200)
  admin = { _id: String(adminDocument._id), token: login.body.token }
  // Deliberately malformed old data. No migration or automatic approval is run.
  const inserted = await Product.collection.insertOne({ name: 'OLD DO NOT PUBLISH / قديم لا تنشر', isDraft: true, hasImageRights: false, availabilityConfirmed: false, createdAt: new Date('2020-01-01T00:00:00Z') })
  legacyId = inserted.insertedId
  oldLegacy = await Product.collection.findOne({ _id: legacyId })
  worker = createWorker({ handlers })
}, 120000)

afterAll(async () => {
  if (worker) await worker.stop({ graceMs: 1000 })
  const report = {
    date: new Date().toISOString().slice(0, 10), environment: 'isolated MongoMemoryServer; no dotenv; temporary image/log directories',
    realLocalComponents: ['Express routes', 'JWT authentication and bcrypt', 'MongoDB persistence', 'sharp image decoder', 'MongoDB durable queue and real handlers', 'local visual vectors', 'RFQ and notification persistence'],
    simulatedOrUnavailable: ['synthetic accounts, businesses, stores, products and owned generated images', 'AI deliberately unavailable; no live provider call', 'external discovery deliberately disabled', 'supertest HTTP client; no device/browser usability claim'],
    noOriginalDatabaseConnection: true, noOriginalImagesWritten: true,
    completedChecks, allThreeJourneysPassed: completedChecks.length === 3,
    timingsInformationalOnly: timings
  }
  // Regressions must not replace the historical Phase 2 audit evidence.
  if (process.env.PILOT_TEST_EVIDENCE_FILE) fs.writeFileSync(process.env.PILOT_TEST_EVIDENCE_FILE, JSON.stringify(report, null, 2) + '\n')
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  logger.close()
  if (path.dirname(temporaryRoot) === fs.realpathSync(os.tmpdir()) && path.basename(temporaryRoot).startsWith('jomla-pilot-api-')) fs.rmSync(temporaryRoot, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('pilot supplier: registration, company, pending store, manual fallback, private draft, explicit approval and publication', async () => {
  expect((await request(app).get('/health/live')).status).toBe(200)
  expect((await request(app).get('/health/ready')).body.status).toBe('ready')
  supplier = await timed('supplier registration', () => register('supplier', 'supplier', 'مورد وهمي للتجربة'))
  competitor = await register('supplier', 'competitor', 'مورد منافس وهمي')
  buyer = await register('buyer', 'buyer', 'مشتري وهمي للتجربة')
  otherBuyer = await register('buyer', 'other-buyer', 'مشتري آخر وهمي')
  const storeId = await timed('company and pending store creation', () => createStore(supplier, 'شركة تجريبية أولى'))
  const competitorStoreId = await createStore(competitor, 'شركة تجريبية ثانية')
  expect((await request(app).get('/api/stores/' + storeId)).status).toBe(404)
  const imageUrl = await timed('real local image upload', () => upload(supplier, redImage, 'pilot-owned-generated.png'))
  expect((await request(app).get(imageUrl)).status).toBe(404)
  const served = await request(app).get('/api/media/' + path.basename(imageUrl)).set(auth(supplier))
  expect(served.status).toBe(200)
  expect(served.headers['x-content-type-options']).toBe('nosniff')
  expect(served.body.equals(redImage)).toBe(true)
  const tooSoon = await request(app).post('/api/products').set(auth(supplier)).send(publishPayload(storeId, imageUrl))
  expect(tooSoon.status).toBe(400)
  expect(await Product.countDocuments({ supplierId: supplier._id })).toBe(0)
  expect((await request(app).put('/api/admin/stores/' + storeId + '/review').set(auth(supplier)).send({ action: 'approve' })).status).toBe(403)

  const unavailable = await request(app).post('/api/product-ai/enhance').set(auth(supplier))
    .field('hasImageRights', 'true').attach('image', redImage, { filename: 'manual-only.png', contentType: 'image/png' })
  expect(unavailable.status).toBe(503)
  expect(unavailable.body).toMatchObject({ analysisAvailable: false, manualInputRequired: true })
  expect(unavailable.body.draft).toBeUndefined()
  expect(unavailable.body.job).toBeUndefined()
  expect(fs.existsSync(path.join(uploadRoot, path.basename(unavailable.body.imageUrl)))).toBe(true)
  expect(Anthropic).not.toHaveBeenCalled()

  const draft = await request(app).post('/api/products').set(auth(supplier)).send({ name: 'قميص تجريبي أحمر / Chemise pilote rouge', storeId, imageUrl: unavailable.body.imageUrl, hasImageRights: true, imageRights: { source: 'owned' }, isDraft: true })
  expect(draft.status).toBe(201)
  expect(draft.body.visualIndex.status).toBe('queued')
  expect(draft.body.product.updatedAt).toEqual(expect.any(String))
  mainProductId = draft.body.product._id
  expect(draft.body.product).toMatchObject({ isDraft: true, availabilityConfirmed: false })
  expect((await request(app).get('/api/products/search?q=pilote')).body.data).toHaveLength(0)
  expect((await request(app).get('/api/products/mine').set(auth(supplier))).body.data.some(p => p._id === mainProductId)).toBe(true)
  expect((await request(app).get('/api/products/mine').set(auth(competitor))).body.data).toHaveLength(0)
  expect((await request(app).put('/api/products/' + mainProductId).set(auth(competitor)).send({ name: 'اختراق' })).status).toBe(404)
  expect((await request(app).get('/api/jobs/' + draft.body.visualIndex.job.id).set(auth(competitor))).status).toBe(404)
  await approveStore(storeId)
  await approveStore(competitorStoreId)
  const noExplicitApproval = await request(app).put('/api/products/' + mainProductId).set(auth(supplier))
    .send({ ...publishPayload(storeId, imageUrl), publishApproved: false })
  expect(noExplicitApproval.status).toBe(400)
  expect((await Product.findById(mainProductId)).isDraft).toBe(true)
  const published = await timed('explicit product publication', () => request(app).put('/api/products/' + mainProductId).set(auth(supplier)).send(publishPayload(storeId, imageUrl)))
  expect(published.status).toBe(200)
  expect(published.body.product.createdAt).toBe(draft.body.product.createdAt)
  expect(Date.parse(published.body.product.updatedAt)).toBeGreaterThanOrEqual(Date.parse(draft.body.product.updatedAt))
  expect(published.body.visualIndex.job.id).not.toBe(draft.body.visualIndex.job.id)
  expect(published.body.product).toMatchObject({ isDraft: false, approvedBy: supplier._id, storeId, hasImageRights: true, availabilityConfirmed: true })
  expect(published.body.visualIndex).toMatchObject({ status: 'queued', job: { status: 'pending' } })
  const blueUrl = await upload(competitor, blueImage, 'pilot-owned-blue.png')
  const competing = await request(app).post('/api/products').set(auth(competitor)).send(publishPayload(competitorStoreId, blueUrl, {
    name: 'قميص تجريبي أزرق / Chemise pilote bleue', price: 62, priceTiers: [{ minQty: 12, maxQty: 49, price: 62 }, { minQty: 50, price: 52 }]
  }))
  expect(competing.status).toBe(201)
  competitorProductId = competing.body.product._id
  const privateDraft = await request(app).post('/api/products').set(auth(supplier)).send({ name: 'قميص مسودة خاصة / Chemise private', imageUrl, storeId, isDraft: true })
  expect(privateDraft.status).toBe(201)
  privateDraftId = privateDraft.body.product._id
  await timed('durable visual index worker all queued jobs', drainQueue)
  expect(await VisualEmbedding.countDocuments({ status: 'indexed' })).toBe(3)
  expect(await Product.collection.findOne({ _id: legacyId })).toEqual(oldLegacy)
  expect(await Product.countDocuments({ isDraft: false })).toBe(2)
  completedChecks.push('supplier_registration_to_explicit_publication_and_indexing')
}, 60000)

test('pilot buyer: bilingual text data, quantity tiers, comparison data, exact/similar visual results and private-product exclusion', async () => {
  const ar = await timed('Arabic text search and tier filters', () => request(app).get('/api/products/search').query({ q: 'قميص', city: 'الدار البيضاء', currency: 'MAD', quantity: 50, order: 'price_asc' }))
  expect(ar.status).toBe(200)
  expect(ar.body.data.map(p => p._id)).toEqual([competitorProductId, mainProductId])
  expect(ar.body.data.map(p => p.effectiveUnitPrice)).toEqual([52, 54])
  for (const product of ar.body.data) expect(product).toMatchObject({ currency: 'MAD', unit: 'قطعة', moq: 12, pricingMode: 'fixed' })
  // The comparison component consumes this same unit/currency/tier data. DOM
  // rendering and click interactions are deliberately left to browser checks.
  const fr = await timed('French text search', () => request(app).post('/api/ai-search').send({ query: 'Chemise pilote', quantity: 50, currency: 'MAD', page: 1, limit: 12 }))
  expect(fr.status).toBe(200)
  expect(fr.body.products.map(p => p._id).sort()).toEqual([mainProductId, competitorProductId].sort())
  expect((await request(app).get('/api/products/search').query({ q: 'Chemise', quantity: 11 })).body.data).toHaveLength(0)
  const range = await request(app).get('/api/products/search').query({ q: 'Chemise', quantity: 50, minPrice: 53, maxPrice: 55 })
  expect(range.body.data.map(p => p._id)).toEqual([mainProductId])
  const first = await request(app).get('/api/products/search').query({ q: 'Chemise', quantity: 50, limit: 1, page: 1, order: 'price_asc' })
  const second = await request(app).get('/api/products/search').query({ q: 'Chemise', quantity: 50, limit: 1, page: 2, order: 'price_asc' })
  expect(first.body.data[0]._id).not.toBe(second.body.data[0]._id)
  const exact = await timed('exact-image API search', () => request(app).post('/api/image-search').field('quantity', '50')
    .attach('image', redImage, { filename: 'unrelated-name.png', contentType: 'image/png' }))
  expect(exact.status).toBe(200)
  expect(exact.body).toMatchObject({ analysisMode: 'local_visual_vectors', visualIdentityVerified: false, exactCount: 1, total: 1 })
  expect(exact.body.products[0]).toMatchObject({ _id: mainProductId, matchBasis: 'exact_image', effectiveUnitPrice: 54 })
  expect(exact.body.products.some(p => [privateDraftId, String(legacyId)].includes(p._id))).toBe(false)
  const similar = await timed('resized/reencoded-image API search', () => request(app).post('/api/image-search').field('quantity', '50')
    .attach('image', resizedRedImage, { filename: 'same-design.jpg', contentType: 'image/jpeg' }))
  expect(similar.status).toBe(200)
  expect(similar.body).toMatchObject({ exactCount: 0, similarCount: 1 })
  expect(similar.body.products[0]).toMatchObject({ _id: mainProductId, matchBasis: 'similar_image', matchType: 'similar' })
  expect(similar.body.externalDiscovery).toMatchObject({ enabled: false, externalSources: [] })
  expect(Anthropic).not.toHaveBeenCalled()
  completedChecks.push('buyer_text_visual_filters_and_comparison_data')
}, 30000)

test('pilot RFQ: correct parties, persisted revised offers, explicit current-offer acceptance, notifications and closed conversation', async () => {
  expect((await request(app).post('/api/rfq').set(auth(buyer)).send({ productId: mainProductId, quantity: 11, buyerPhone: buyer.phone })).status).toBe(400)
  expect((await request(app).post('/api/rfq').set(auth(supplier)).send({ productId: mainProductId, quantity: 50, buyerPhone: buyer.phone })).status).toBe(403)
  const created = await timed('buyer creates RFQ', () => request(app).post('/api/rfq').set(auth(buyer)).send({ productId: mainProductId, quantity: 50, buyerPhone: buyer.phone, buyerCity: 'الرباط', notes: 'RFQ وهمي للاختبار فقط', buyerId: otherBuyer._id, buyerName: 'انتحال' }))
  expect(created.status).toBe(201)
  rfqId = created.body.rfq._id
  expect(created.body.rfq).toMatchObject({ buyerId: buyer._id, buyerName: buyer.name, supplierId: supplier._id, quantity: 50, currency: 'MAD', status: 'pending' })
  expect((await request(app).get('/api/rfq/supplier').set(auth(supplier))).body.data.map(item => item._id)).toContain(rfqId)
  expect((await request(app).get('/api/rfq/supplier').set(auth(competitor))).body.data).toHaveLength(0)
  for (const outsider of [competitor, otherBuyer]) {
    expect((await request(app).get('/api/rfq/' + rfqId).set(auth(outsider))).status).toBe(403)
    expect((await request(app).get('/api/rfq/' + rfqId + '/thread').set(auth(outsider))).status).toBe(403)
    expect((await request(app).post('/api/rfq/' + rfqId + '/messages').set(auth(outsider)).send({ content: 'غير مسموح' })).status).toBe(403)
  }
  expect((await request(app).put('/api/rfq/' + rfqId + '/respond').set(auth(competitor)).send({ unitPrice: 1, deliveryDays: 1 })).status).toBe(403)
  const first = await request(app).put('/api/rfq/' + rfqId + '/respond').set(auth(supplier)).send({ unitPrice: 53, deliveryDays: 4, paymentTerms: 'شروط تجريبية فقط' })
  expect(first.status).toBe(200)
  const revised = await timed('supplier revises offer', () => request(app).put('/api/rfq/' + rfqId + '/respond').set(auth(supplier)).send({ unitPrice: 51, deliveryDays: 3, paymentTerms: 'لا دفع حقيقي في الاختبار' }))
  expect(revised.status).toBe(200)
  acceptedOfferId = revised.body.offer._id
  expect(revised.body.offer).toMatchObject({ quantity: 50, unitPrice: 51, totalPrice: 2550, currency: 'MAD', status: 'active' })
  expect((await QuoteOffer.findById(first.body.offer._id)).status).toBe('superseded')
  const buyerOffers = await request(app).get('/api/rfq/' + rfqId + '/thread').set(auth(buyer))
  expect(buyerOffers.body.offers).toHaveLength(2)
  const staleAccept = await request(app).put('/api/rfq/' + rfqId + '/action').set(auth(buyer)).send({ action: 'accept', offerId: first.body.offer._id })
  expect(staleAccept.status).toBe(409)
  expect((await request(app).put('/api/rfq/' + rfqId + '/action').set(auth(otherBuyer)).send({ action: 'accept', offerId: acceptedOfferId })).status).toBe(403)
  const message = await request(app).post('/api/rfq/' + rfqId + '/messages').set(auth(buyer)).send({ content: 'رسالة تجريبية حول العرض الأخير', senderRole: 'admin', senderName: 'مزور' })
  expect(message.status).toBe(201)
  expect(message.body.thread.messages.at(-1)).toMatchObject({ senderRole: 'buyer', senderName: buyer.name, senderId: buyer._id })
  const accepted = await timed('buyer accepts current offer', () => request(app).put('/api/rfq/' + rfqId + '/action').set(auth(buyer)).send({ action: 'accept', offerId: acceptedOfferId }))
  expect(accepted.status).toBe(200)
  expect((await QuoteRequest.findById(rfqId)).status).toBe('accepted')
  expect((await QuoteRequest.findById(rfqId)).currentOfferId.toString()).toBe(acceptedOfferId)
  expect((await QuoteOffer.findById(acceptedOfferId)).status).toBe('accepted')
  expect((await MessageThread.findOne({ rfqId })).status).toBe('closed')
  expect((await request(app).post('/api/rfq/' + rfqId + '/messages').set(auth(buyer)).send({ content: 'بعد الإغلاق' })).status).toBe(409)
  expect((await request(app).put('/api/rfq/' + rfqId + '/respond').set(auth(supplier)).send({ unitPrice: 50, deliveryDays: 1 })).status).toBe(409)
  const supplierInbox = await request(app).get('/api/notifications').set(auth(supplier))
  expect(supplierInbox.body.data.some(item => item.resourceId === rfqId && item.type === 'rfq_created')).toBe(true)
  expect(supplierInbox.body.data.some(item => item.resourceId === rfqId && item.type === 'offer_decision')).toBe(true)
  const buyerInbox = await timed('buyer receives persisted bilingual notification', () => request(app).get('/api/notifications').set(auth(buyer)))
  const notice = buyerInbox.body.data.find(item => item.resourceId === rfqId && item.type === 'offer_received')
  expect(notice).toBeDefined()
  expect(notice.titleAr).toBeTruthy()
  expect(notice.titleFr).toBeTruthy()
  expect((await request(app).put('/api/notifications/' + notice._id + '/read').set(auth(otherBuyer))).status).toBe(404)
  expect((await request(app).put('/api/notifications/' + notice._id + '/read').set(auth(buyer))).status).toBe(200)
  expect((await Notification.findById(notice._id)).readAt).toBeInstanceOf(Date)
  expect((await request(app).get('/api/notifications').set(auth(otherBuyer))).body.data).toHaveLength(0)
  expect(await Product.collection.findOne({ _id: legacyId })).toEqual(oldLegacy)
  expect(await AuditLog.countDocuments({ phase: { $ne: 'completed' } })).toBe(0)
  for (const action of ['ACCOUNT_REGISTERED', 'ORGANIZATION_UPDATED', 'STORE_CREATED', 'STORE_REVIEWED']) expect(await AuditLog.countDocuments({ action, phase: 'completed' })).toBeGreaterThan(0)
  expect(Anthropic).not.toHaveBeenCalled()
  completedChecks.push('rfq_offer_acceptance_notifications_isolation_and_legacy_unchanged')
}, 30000)
