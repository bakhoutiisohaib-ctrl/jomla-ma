// All state belongs to a disposable MongoDB and a new temporary media directory.
// Mock dotenv before importing the application: never read the project .env.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs')
const os = require('os')
const path = require('path')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-pilot-security-'))
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'pilot-isolated-session-secret-2026-only',
  MONGODB_URI: 'mongodb://127.0.0.1:1/never_used_pilot_security', DISABLE_REDIS: '1',
  UPLOADS_DIR: path.join(temporaryRoot, 'uploads'), LOG_DIR: path.join(temporaryRoot, 'logs'),
  TRUST_PROXY: '0', CORS_ORIGIN: 'http://localhost:3000',
  CLAUDE_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '',
  EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: ''
})
const request = require('supertest')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const BackgroundJob = require('../models/BackgroundJob')
const Product = require('../models/Product')
const { generateToken } = require('../middleware/auth')
const { enqueueJob, assertJobPermission } = require('../services/jobQueue')
const { createFirstAdmin } = require('../scripts/create-admin')

let mongo, hash, png
let sequence = 0
const auth = token => ({ Authorization: 'Bearer ' + token })
async function account(role = 'supplier') {
  const user = await Supplier.create({ name: 'حساب اختبار الأمان', role,
    email: `pilot-security-${++sequence}@example.test`, password: hash, city: 'الرباط', phone: '+212600000000' })
  return { user, token: generateToken(user) }
}
const registration = (email, password) => ({ name: 'مورد اختبار معزول', city: 'الرباط', phone: '+212600000000', email, password, role: 'supplier' })
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'pilot_security_isolated' } })
  const uri = mongo.getUri()
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) throw new Error('Only disposable loopback MongoDB is allowed')
  await mongoose.connect(uri, { dbName: 'pilot_security_isolated' })
  await Promise.all([Supplier.init(), Organization.init(), Membership.init(), BackgroundJob.init()])
  hash = await bcrypt.hash('Isolated-Password-2026', 4)
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#a44222' } }).png().toBuffer()
})
afterAll(async () => {
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  // This path is produced by mkdtemp, never derived from a real environment variable.
  if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir())) throw new Error('Unsafe test cleanup')
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
})

test('new account credentials reject bcrypt truncation, including Arabic byte length', async () => {
  // bcrypt silently treats these distinct inputs as the same password.
  const prefix = 'a'.repeat(72)
  expect(await bcrypt.compare(prefix + '-different', await bcrypt.hash(prefix + '-original', 4))).toBe(true)
  for (const [index, password] of [prefix + '-original', 'س'.repeat(37)].entries()) {
    const result = await request(app).post('/api/suppliers/register').send(registration(`too-long-${index}@example.test`, password))
    expect(result.status).toBe(400)
    expect(await Supplier.exists({ email: `too-long-${index}@example.test` })).toBeNull()
  }
  expect((await request(app).post('/api/suppliers/register').send(registration('short-password@example.test', 'sixsix'))).status).toBe(400)
  for (const [index, password] of ['b'.repeat(72), 'س'.repeat(36)].entries()) {
    expect((await request(app).post('/api/suppliers/register').send(registration(`valid-boundary-${index}@example.test`, password))).status).toBe(201)
  }
})

test('password replacement and local administrator setup reject truncation before any write', async () => {
  const owner = await account()
  const response = await request(app).put('/api/suppliers/me/password').set(auth(owner.token))
    .send({ currentPassword: 'Isolated-Password-2026', newPassword: 'س'.repeat(37) })
  expect(response.status).toBe(400)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(owner.token))).status).toBe(200)
  await expect(createFirstAdmin({ name: 'Test admin', email: 'long-admin@example.test', password: 'b'.repeat(73) })).rejects.toThrow()
  expect(await Supplier.countDocuments({ role: 'admin' })).toBe(0)
})

test('legacy credentials remain usable: no account migration or login format change', async () => {
  const user = await Supplier.create({ name: 'Legacy synthetic account', email: 'legacy-long@example.test', password: await bcrypt.hash('c'.repeat(80), 4), role: 'buyer' })
  expect((await request(app).post('/api/suppliers/login').send({ email: user.email, password: 'c'.repeat(80) })).status).toBe(200)
})

test('unsigned, wrongly signed, expired and wrong-algorithm session tokens fail closed', async () => {
  const owner = await account()
  const claims = { id: String(owner.user._id), tokenVersion: 0 }
  const tokens = [
    jwt.sign(claims, '', { algorithm: 'none' }),
    jwt.sign(claims, 'wrong-secret', { algorithm: 'HS256' }),
    jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -1 }),
    jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS384' })
  ]
  for (const token of tokens) expect((await request(app).get('/api/suppliers/me/profile').set(auth(token))).status).toBe(401)
  expect((await request(app).get('/api/suppliers/me/profile').set(auth(owner.token))).status).toBe(200)
})

test('public registration cannot request admin or grant staff permissions', async () => {
  for (const [index, extra] of [{ role: 'admin' }, { role: 'staff', permissions: ['all'] }, { role: 'staff', organizationId: new mongoose.Types.ObjectId() }].entries()) {
    const result = await request(app).post('/api/suppliers/register').send({ ...registration(`forged-${index}@example.test`, 'Safe-Password-2026'), ...extra })
    expect(result.status).toBe(400)
  }
  expect(await Supplier.countDocuments({ role: 'admin' })).toBe(0)
})

test('supplier ownership is derived from the session and blocks cross-tenant draft access', async () => {
  const owner = await account(), outsider = await account()
  const created = await request(app).post('/api/products').set(auth(owner.token)).send({ name: 'مسودة خاصة', isDraft: true, supplierId: outsider.user._id, organizationId: new mongoose.Types.ObjectId() })
  expect(created.status).toBe(201)
  expect(created.body.product.supplierId).toBe(String(owner.user._id))
  const id = created.body.product._id
  expect((await request(app).put('/api/products/' + id).set(auth(outsider.token)).send({ name: 'استيلاء' })).status).toBe(404)
  expect((await request(app).delete('/api/products/' + id).set(auth(outsider.token))).status).toBe(404)
  expect((await request(app).get('/api/products/mine').set(auth(outsider.token))).body.data).toHaveLength(0)
  expect((await Product.findById(id)).name).toBe('مسودة خاصة')
})

test('job details are tenant-bound and serialized without raw provider/internal credentials', async () => {
  const owner = await account(), outsider = await account()
  const { job } = await enqueueJob({ type: 'ai_product_draft', ownerId: String(owner.user._id), requestedBy: String(owner.user._id), payload: { imageUrl: '/uploads/test.png' }, idempotencyKey: 'pilot-status-test' })
  await BackgroundJob.updateOne({ _id: job._id }, { $set: { status: 'succeeded', result: { draft: { name: 'مرئي' }, apiKey: 'synthetic-secret-value', raw: 'Bearer synthetic-secret-value' } } })
  expect((await request(app).get('/api/jobs/' + job._id)).status).toBe(401)
  expect((await request(app).get('/api/jobs/' + job._id).set(auth(outsider.token))).status).toBe(404)
  const result = await request(app).get('/api/jobs/' + job._id).set(auth(owner.token))
  expect(result.status).toBe(200)
  expect(result.body.job.result.draft.name).toBe('مرئي')
  expect(JSON.stringify(result.body)).not.toContain('synthetic-secret-value')
  for (const key of ['payload', 'payloadHash', 'idempotencyKey', 'workerId', 'leaseToken', 'ownerId', 'requestedBy']) expect(result.body.job).not.toHaveProperty(key)
})

test('staff job access and execution lose authorization immediately after permission removal', async () => {
  const owner = await account(), staff = await account('staff')
  const organization = await Organization.create({ ownerSupplierId: owner.user._id, name: 'شركة اختبار' })
  const membership = await Membership.create({ organizationId: organization._id, userId: staff.user._id, invitedEmail: staff.user.email, invitedBy: owner.user._id, role: 'staff', status: 'active', permissions: ['manage_products'] })
  const { job } = await enqueueJob({ type: 'ai_product_draft', ownerId: String(owner.user._id), requestedBy: String(staff.user._id), organizationId: String(organization._id), requiredPermission: 'manage_products', payload: { imageUrl: '/uploads/test.png' }, idempotencyKey: 'pilot-staff-test' })
  expect((await request(app).get('/api/jobs/' + job._id).set(auth(staff.token))).status).toBe(200)
  await expect(assertJobPermission(job)).resolves.toBeDefined()
  await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_rfq'] } })
  expect((await request(app).get('/api/jobs/' + job._id).set(auth(staff.token))).status).toBe(404)
  await expect(assertJobPermission(job)).rejects.toMatchObject({ code: 'JOB_REJECTED' })
})

test('anonymous users, buyers, rights omissions and false MIME cannot persist media', async () => {
  const owner = await account(), buyer = await account('buyer')
  const upload = token => { const call = request(app).post('/api/product-ai/upload'); return token ? call.set(auth(token)) : call }
  expect((await upload().field('hasImageRights', 'true').attach('image', png, { filename: 'test.png', contentType: 'image/png' })).status).toBe(401)
  expect((await upload(buyer.token).field('hasImageRights', 'true').attach('image', png, { filename: 'test.png', contentType: 'image/png' })).status).toBe(403)
  expect((await upload(owner.token).attach('image', png, { filename: 'test.png', contentType: 'image/png' })).status).toBe(400)
  const bad = await upload(owner.token).field('hasImageRights', 'true').attach('image', Buffer.from('<svg><script>alert(1)</script></svg>'), { filename: 'fake.png', contentType: 'image/png' })
  expect(bad.status).toBe(415)
  const truncated = await upload(owner.token).field('hasImageRights', 'true').attach('image', png.subarray(0, png.length - 10), { filename: 'truncated.png', contentType: 'image/png' })
  expect(truncated.status).toBe(415)
  expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false)
})

test('media size cap rejects 10 MiB plus one byte before writing', async () => {
  const owner = await account()
  const response = await request(app).post('/api/product-ai/upload').set(auth(owner.token)).field('hasImageRights', 'true')
    .attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'too-large.png', contentType: 'image/png' })
  expect(response.status).toBe(413)
})

test('uploaded draft media needs owner authorization even with a known storage reference', async () => {
  const owner = await account()
  const result = await request(app).post('/api/product-ai/upload').set(auth(owner.token)).field('hasImageRights', 'true')
    .attach('image', png, { filename: 'synthetic-only.png', contentType: 'image/png' })
  expect(result.status).toBe(201)
  const imageUrl = result.body.imageUrl
  expect((await request(app).get(imageUrl)).status).toBe(404)
  const mediaUrl = '/api/media/' + path.basename(imageUrl)
  expect((await request(app).get(mediaUrl)).status).toBe(401)
  const served = await request(app).get(mediaUrl).set(auth(owner.token))
  expect(served.status).toBe(200)
  expect(served.headers['x-content-type-options']).toBe('nosniff')
  expect(served.body.equals(png)).toBe(true)
  const draft = await request(app).post('/api/products').set(auth(owner.token)).send({ imageUrl, name: 'مسودة صورة خاصة', isDraft: true })
  expect(draft.status).toBe(201)
  expect((await request(app).get('/api/products')).body.data.some(item => item._id === draft.body.product._id)).toBe(false)
})

test('same-origin attack headers do not bypass the login IP limiter when trust proxy is disabled', async () => {
  const statuses = []
  for (let i = 0; i < 32; i++) statuses.push((await request(app).post('/api/suppliers/login').set('X-Forwarded-For', `192.0.2.${i + 1}`).send({ email: 'absent@example.test', password: 'No-account-password' })).status)
  const firstBlocked = statuses.indexOf(429)
  // Earlier registration/login requests intentionally share this same IP bucket.
  expect(firstBlocked).toBeGreaterThan(0)
  expect(firstBlocked).toBeLessThanOrEqual(30)
  expect(statuses.slice(0, firstBlocked).every(status => status === 401)).toBe(true)
  expect(statuses.slice(firstBlocked).every(status => status === 429)).toBe(true)
})
