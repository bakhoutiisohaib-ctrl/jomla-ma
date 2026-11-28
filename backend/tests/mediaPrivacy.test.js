// Independent integration checks for StrictDraftPrivacy. No application .env,
// existing database, existing uploads, or paid provider is used by this suite.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))

const fs = require('fs')
const fsp = fs.promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-phase-a-privacy-'))
const uploads = path.join(sandbox, 'uploads')
fs.mkdirSync(uploads)
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'synthetic-independent-media-privacy-secret'
process.env.UPLOADS_DIR = uploads
process.env.LOG_DIR = path.join(sandbox, 'logs')
process.env.LOG_LEVEL = 'error'
delete process.env.MONGODB_URI
delete process.env.RESTORE_MONGODB_URI
delete process.env.CLAUDE_API_KEY
delete process.env.BRAVE_SEARCH_API_KEY
delete process.env.REDIS_URL

const request = require('supertest')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const Store = require('../models/Store')
const Product = require('../models/Product')
const MediaAsset = require('../models/MediaAsset')
const BackgroundJob = require('../models/BackgroundJob')
const VisualEmbedding = require('../models/VisualEmbedding')
const { generateToken } = require('../middleware/auth')
const { indexProduct, searchImage } = require('../services/visualIndex')
const { createWorker, enqueueJob } = require('../services/jobQueue')
const handlers = require('../services/jobHandlers')
const { backupDatabase, restoreDatabase, validateBackup } = require('../services/backup')

jest.setTimeout(120000)
let mongo, a, b, buyer, admin, staff, org, membership, store, storeB, red, blue, serial = 0
const bearer = actor => ({ Authorization: 'Bearer ' + (typeof actor === 'string' ? actor : actor.token) })
const mediaPath = imageUrl => '/api/media/' + path.basename(imageUrl)
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const asBytes = (res, callback) => {
  const parts = []
  res.on('data', part => parts.push(part))
  res.on('end', () => callback(null, Buffer.concat(parts)))
}
async function image(imageUrl, actor, options = {}) {
  const req = request(app)[options.method || 'get'](options.path || mediaPath(imageUrl))
    .buffer(true).parse(asBytes)
  if (actor) req.set(bearer(actor))
  if (options.headers) req.set(options.headers)
  return req
}
function noImage(res, bytes, status = 404) {
  if (Array.isArray(status)) expect(status).toContain(res.status)
  else expect(res.status).toBe(status)
  expect(res.headers['content-type'] || '').not.toMatch(/^image\//)
  expect(Buffer.isBuffer(res.body) ? res.body.equals(bytes) : false).toBe(false)
  if (Buffer.isBuffer(res.body)) expect(res.body.includes(bytes)).toBe(false)
  expect(res.headers['cache-control']).toMatch(/no-store/)
}
async function hasImage(imageUrl, actor, bytes = red) {
  const res = await image(imageUrl, actor)
  expect(res.status).toBe(200)
  expect(res.headers['content-type']).toMatch(/^image\/png/)
  expect(res.body).toEqual(bytes)
  expect(res.headers['cache-control']).toMatch(/no-store/)
  expect(res.headers['cache-control']).toMatch(/private/)
  expect(res.headers.vary).toMatch(/Authorization/i)
  expect(res.headers).not.toHaveProperty('etag')
  expect(res.headers).not.toHaveProperty('last-modified')
  return res
}
async function account(role) {
  const user = await Supplier.create({ name: 'Synthetic ' + role, email: `privacy-${++serial}@synthetic.invalid`, password: 'synthetic-unused-hash', role, phone: '+212611111111' })
  return { user, token: generateToken(user) }
}
async function upload(actor = a, bytes = red, fields = {}) {
  let req = request(app).post('/api/product-ai/upload').set(bearer(actor)).field('hasImageRights', 'true')
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value)
  const res = await req.attach('image', bytes, { filename: 'synthetic.png', contentType: 'image/png' })
  expect(res.status).toBe(201)
  expect(res.body.imageUrl).toMatch(/^\/uploads\/product-[a-f0-9-]+\.png$/)
  return res.body.imageUrl
}
function publishedBody(imageUrl, extra = {}) {
  return { name: 'Synthetic privacy product', category: 'Synthetic', price: 75, currency: 'MAD', country: 'MA', city: 'فاس', moq: 1, unit: 'قطعة', description: 'Synthetic product used only in an isolated database.', imageUrl, images: [], isDraft: false, hasImageRights: true, imageRights: { source: 'owned' }, publishApproved: true, availability: 'in_stock', availabilityConfirmed: true, inStock: true, storeId: String(store._id), ...extra }
}
async function create(imageUrl, { actor = a, published = false, extra = {} } = {}) {
  const body = published ? publishedBody(imageUrl, extra) : { name: 'Private synthetic draft', imageUrl, ...extra }
  const res = await request(app).post('/api/products').set(bearer(actor)).send(body)
  expect(res.status).toBe(201)
  return res.body.product
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('phase_a_privacy_source'))
  await Promise.all([Supplier.init(), Organization.init(), Membership.init(), Store.init(), MediaAsset.init(), BackgroundJob.init(), VisualEmbedding.init()])
  red = await sharp({ create: { width: 13, height: 7, channels: 3, background: '#d61035' } }).png().toBuffer()
  blue = await sharp({ create: { width: 11, height: 8, channels: 3, background: '#0a31c9' } }).png().toBuffer()
})
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})))
  ;[a, b, buyer, admin, staff] = await Promise.all(['supplier', 'supplier', 'buyer', 'admin', 'staff'].map(account))
  org = await Organization.create({ name: 'Synthetic organization A', ownerSupplierId: a.user._id })
  membership = await Membership.create({ organizationId: org._id, userId: staff.user._id, invitedEmail: staff.user.email, invitedBy: a.user._id, role: 'staff', status: 'active', permissions: ['manage_products'] })
  store = await Store.create({ name: 'Synthetic store A', slug: 'privacy-a-' + serial, supplierId: a.user._id, isActive: true, reviewStatus: 'approved' })
  storeB = await Store.create({ name: 'Synthetic store B', slug: 'privacy-b-' + serial, supplierId: b.user._id, isActive: true, reviewStatus: 'approved' })
})
afterAll(async () => {
  require('../middleware/logger').logger.close()
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  // Cleanup is limited to the uniquely created, verified temporary directory.
  const resolved = path.resolve(sandbox)
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('jomla-phase-a-privacy-')) await fsp.rm(resolved, { recursive: true, force: true })
})

test('upload registers immutable tenant provenance before product attachment and serves exact original bytes to A', async () => {
  const url = await upload(a, red, { ownerSupplierId: String(b.user._id), uploadedBy: String(b.user._id) })
  const asset = await MediaAsset.findOne({ imageUrl: url }).lean()
  expect(asset.filename).toBe(path.basename(url))
  expect(String(asset.ownerSupplierId)).toBe(String(a.user._id))
  expect(String(asset.uploadedBy)).toBe(String(a.user._id))
  expect(String(asset.organizationId)).toBe(String(org._id))
  expect(asset).toMatchObject({ mimetype: 'image/png', size: red.length, sha256: digest(red) })
  expect(await Product.countDocuments()).toBe(0)
  expect(await fsp.readFile(path.join(uploads, asset.filename))).toEqual(red)
  await hasImage(url, a)
})

test('known unattached image URL denies B, buyer and visitor; retired static path denies even A', async () => {
  const url = await upload()
  for (const actor of [b, buyer]) noImage(await image(url, actor), red)
  noImage(await image(url), red, 401)
  for (const actor of [undefined, a, b]) noImage(await image(url, actor, { path: url }), red)
})

test('draft main and secondary images both remain private to their owner', async () => {
  const main = await upload(), secondary = await upload(a, blue)
  const product = await create(main, { extra: { images: [secondary] } })
  expect(product.isDraft).toBe(true)
  for (const [url, bytes] of [[main, red], [secondary, blue]]) {
    await hasImage(url, a, bytes)
    for (const actor of [b, buyer]) noImage(await image(url, actor), bytes)
    noImage(await image(url), bytes, 401)
  }
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
})

test('foreign assets cannot be attached as main or secondary even when A has published them', async () => {
  const foreign = await upload()
  await create(foreign, { published: true })
  const own = await upload(b, blue)
  await hasImage(foreign, b)
  for (const body of [{ imageUrl: foreign }, { imageUrl: own, images: [foreign] }, publishedBody(foreign, { storeId: String(storeB._id) })]) {
    const res = await request(app).post('/api/products').set(bearer(b)).send(body)
    expect(res.status).toBe(400)
  }
  const draft = await create(own, { actor: b })
  const edit = await request(app).put('/api/products/' + draft._id).set(bearer(b)).send({ images: [foreign] })
  expect(edit.status).toBe(400)
  expect((await Product.findById(draft._id)).images).toHaveLength(0)
})

test.each(['https://images.synthetic.invalid/private.png', 'http://images.synthetic.invalid/private.png', '//images.synthetic.invalid/private.png', 'data:image/png;base64,AAAA', 'blob:http://localhost/private', '/api/media/fake.png'])('remote or alternate source %s cannot enter main or secondary product fields', async source => {
  const own = await upload()
  for (const body of [{ imageUrl: source }, { imageUrl: own, images: [source] }]) {
    const res = await request(app).post('/api/products').set(bearer(a)).send(body)
    expect(res.status).toBe(400)
  }
  expect(await Product.countDocuments()).toBe(0)
})

test('legacy files without provenance fail closed without adoption or file mutation', async () => {
  const url = '/uploads/legacy-synthetic-' + serial + '.png'
  const filename = path.join(uploads, path.basename(url))
  await fsp.writeFile(filename, red)
  for (const actor of [a, b, buyer, admin]) noImage(await image(url, actor), red)
  const res = await request(app).post('/api/products').set(bearer(a)).send({ imageUrl: url })
  expect(res.status).toBe(400)
  expect(await MediaAsset.countDocuments({ imageUrl: url })).toBe(0)
  expect(await fsp.readFile(filename)).toEqual(red)
})

test('staff upload belongs to the organization owner; current permissions and membership control private reads', async () => {
  const url = await upload(staff)
  const asset = await MediaAsset.findOne({ imageUrl: url }).lean()
  expect(String(asset.ownerSupplierId)).toBe(String(a.user._id))
  expect(String(asset.uploadedBy)).toBe(String(staff.user._id))
  await hasImage(url, a)
  await hasImage(url, staff)
  await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_rfq'] } })
  noImage(await image(url, staff), red)
  await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_products'] } })
  await hasImage(url, staff)
  await Membership.updateOne({ _id: membership._id }, { $set: { status: 'revoked' } })
  noImage(await image(url, staff), red)
})

test('membership revocation API invalidates old JWT and a newly issued staff JWT still lacks private access', async () => {
  const url = await upload()
  await hasImage(url, staff)
  const res = await request(app).patch('/api/suppliers/me/memberships/' + membership._id).set(bearer(a)).send({ status: 'revoked' })
  expect(res.status).toBe(200)
  noImage(await image(url, staff), red, 401)
  const current = await Supplier.findById(staff.user._id).select('+tokenVersion')
  noImage(await image(url, generateToken(current)), red)
})

test('moving staff to another organization removes old organization images from the same signed session', async () => {
  const url = await upload()
  await hasImage(url, staff)
  const orgB = await Organization.create({ name: 'Synthetic B organization', ownerSupplierId: b.user._id })
  await Membership.updateOne({ _id: membership._id }, { $set: { organizationId: orgB._id } })
  noImage(await image(url, staff), red)
})

test('expired, logged-out, deactivated and deleted identities lose image access immediately', async () => {
  const url = await upload()
  const expired = jwt.sign({ id: String(a.user._id), tokenVersion: 0 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -1 })
  noImage(await image(url, expired), red, 401)
  await hasImage(url, a)
  const logout = await request(app).post('/api/suppliers/logout').set(bearer(a))
  expect(logout.status).toBe(200)
  noImage(await image(url, a), red, 401)
  const current = await Supplier.findById(a.user._id).select('+tokenVersion')
  const renewed = generateToken(current)
  await hasImage(url, renewed)
  await Supplier.updateOne({ _id: a.user._id }, { $set: { isActive: false } })
  noImage(await image(url, renewed), red, 401)
  await Supplier.deleteOne({ _id: a.user._id })
  noImage(await image(url, renewed), red, 401)
})

test('published main and secondary bytes are readable by visitors and authenticated accounts under the C1 policy', async () => {
  const main = await upload(), secondary = await upload(a, blue)
  await create(main, { published: true, extra: { images: [secondary] } })
  expect((await request(app).get('/api/products')).body.data).toHaveLength(1)
  for (const [url, bytes] of [[main, red], [secondary, blue]]) {
    for (const actor of [a, b, buyer, admin]) await hasImage(url, actor, bytes)
    await hasImage(url, undefined, bytes)
  }
})

test('publishing and unpublishing update authorization without changing stored image references', async () => {
  const url = await upload(), draft = await create(url)
  noImage(await image(url, buyer), red)
  const published = await request(app).put('/api/products/' + draft._id).set(bearer(a)).send(publishedBody(url))
  expect(published.status).toBe(200)
  expect(published.body.product.imageUrl).toBe(url)
  await hasImage(url, buyer)
  const unpublished = await request(app).put('/api/products/' + draft._id).set(bearer(a)).send({ isDraft: true })
  expect(unpublished.status).toBe(200)
  noImage(await image(url, buyer, { headers: { 'If-None-Match': '*', 'If-Modified-Since': new Date().toUTCString(), Range: 'bytes=0-15' } }), red)
  await hasImage(url, a)
})

test.each([
  ['store suspended', 'store', { isActive: false }],
  ['store admin suspended', 'store', { adminSuspended: true }],
  ['store unapproved', 'store', { reviewStatus: 'pending' }],
  ['owner deactivated', 'supplier', { isActive: false }],
  ['owner loses supplier role', 'supplier', { role: 'buyer' }],
  ['product hidden', 'product', { moderationStatus: 'hidden' }],
  ['product out of stock', 'product', { inStock: false, availability: 'out_of_stock' }],
  ['image rights withdrawn', 'product', { hasImageRights: false }]
])('%s immediately removes published image access from other accounts', async (_label, kind, changes) => {
  const url = await upload(), product = await create(url, { published: true })
  await hasImage(url, buyer)
  const Model = kind === 'store' ? Store : kind === 'supplier' ? Supplier : Product
  const id = kind === 'store' ? store._id : kind === 'supplier' ? a.user._id : product._id
  await Model.updateOne({ _id: id }, { $set: changes })
  noImage(await image(url, buyer), red)
  noImage(await image(url, b), red)
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
})

test('deleting the last product reference revokes catalog access while preserving owner access to its own asset', async () => {
  const url = await upload(), product = await create(url, { published: true })
  await hasImage(url, buyer)
  expect((await request(app).delete('/api/products/' + product._id).set(bearer(a))).status).toBe(200)
  noImage(await image(url, buyer), red)
  await hasImage(url, a)
  expect(await MediaAsset.countDocuments({ imageUrl: url })).toBe(1)
})

test('product reassignment never transfers immutable image provenance or authorizes the new owner', async () => {
  const url = await upload(), product = await create(url, { published: true })
  await hasImage(url, buyer)
  await Product.updateOne({ _id: product._id }, { $set: { supplierId: b.user._id, storeId: storeB._id } })
  noImage(await image(url, b), red)
  noImage(await image(url, buyer), red)
  await hasImage(url, a)
  expect(String((await MediaAsset.findOne({ imageUrl: url })).ownerSupplierId)).toBe(String(a.user._id))
})

test('removing secondary attachment revokes its catalog access independently from the main image', async () => {
  const main = await upload(), secondary = await upload(a, blue)
  const product = await create(main, { published: true, extra: { images: [secondary] } })
  await hasImage(secondary, buyer, blue)
  await Product.updateOne({ _id: product._id }, { $set: { images: [] } })
  noImage(await image(secondary, buyer), blue)
  await hasImage(main, buyer)
  await hasImage(secondary, a, blue)
})

test('same-owner draft copies reuse their managed asset without making either draft public', async () => {
  const main = await upload(), secondary = await upload(a, blue)
  const original = await create(main, { extra: { images: [secondary] } })
  const copy = await create(main, { extra: { name: 'Synthetic copy', images: [...original.images] } })
  expect(copy._id).not.toBe(original._id)
  expect(copy.imageUrl).toBe(main)
  expect(copy.images).toEqual([secondary])
  await hasImage(main, a)
  await hasImage(secondary, a, blue)
  noImage(await image(main, b), red)
  noImage(await image(secondary, buyer), blue)
  expect(await MediaAsset.countDocuments()).toBe(2)
})

test('JWT query parameters, cookies and non-Bearer headers cannot authorize media', async () => {
  const url = await upload()
  for (const suffix of ['?token=' + a.token, '?access_token=' + a.token, '?jwt=' + a.token]) noImage(await image(url, undefined, { path: mediaPath(url) + suffix }), red, 401)
  noImage(await image(url, undefined, { headers: { Cookie: 'token=' + a.token } }), red, 401)
  noImage(await image(url, undefined, { headers: { Authorization: 'Basic ' + a.token } }), red, 401)
  const spoofed = jwt.sign({ id: String(a.user._id), role: 'admin', tokenVersion: 0 }, 'wrong-synthetic-secret')
  noImage(await image(url, spoofed), red, 401)
})

test('HEAD, Range and conditional requests perform authorization before returning any image metadata', async () => {
  const url = await upload()
  for (const actor of [b, buyer]) {
    noImage(await image(url, actor, { method: 'head' }), red)
    noImage(await image(url, actor, { headers: { Range: 'bytes=0-4' } }), red)
    noImage(await image(url, actor, { headers: { 'If-None-Match': '*', 'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT' } }), red)
  }
  const head = await image(url, a, { method: 'head' })
  expect(head.status).toBe(200)
  expect(head.headers['cache-control']).toMatch(/no-store/)
  expect(head.headers).not.toHaveProperty('etag')
  expect(head.headers).not.toHaveProperty('last-modified')
  await hasImage(url, a)
})

test('encoded traversal, alternate separators and double-encoded paths never return private bytes', async () => {
  const url = await upload(), filename = path.basename(url)
  for (const attempted of ['/api/media/..%2F' + filename, '/api/media/%2e%2e%5c' + filename, '/api/media/%252e%252e%252f' + filename, '/api/media/' + filename + '%00.png', '/api/media/sub%2f' + filename, '/uploads/%2e%2e%2fuploads%2f' + filename, '/UPLOADS/' + filename]) {
    noImage(await image(url, b, { path: attempted }), red, [400, 404])
  }
})

test('server-side byte replacement cannot reuse a valid registry entry to expose unrelated content', async () => {
  const url = await upload()
  await hasImage(url, a)
  await fsp.writeFile(path.join(uploads, path.basename(url)), blue)
  noImage(await image(url, a), blue)
  expect((await MediaAsset.findOne({ imageUrl: url })).sha256).toBe(digest(red))
})

test('account switch receives no conditional cached image from the former owner session', async () => {
  const url = await upload()
  const prior = await hasImage(url, a)
  expect(prior.headers['cache-control']).toMatch(/no-store/)
  noImage(await image(url, b, { headers: { 'If-None-Match': '*', 'If-Modified-Since': new Date().toUTCString() } }), red)
  noImage(await image(url), red, 401)
  await hasImage(url, a)
})

test('real indexing worker and visual search read managed local bytes and never expose drafts', async () => {
  const url = await upload(), draft = await create(url)
  const worker = createWorker({ handlers, concurrency: 1, leaseMs: 5000, heartbeatMs: 1000 })
  try {
    expect(await worker.runOnce()).toBeTruthy()
    const job = await BackgroundJob.findOne({ 'payload.productId': draft._id })
    expect(job.status).toBe('succeeded')
    expect(job.result.status).toBe('indexed')
    expect((await VisualEmbedding.findOne({ productId: draft._id })).sha256).toBe(digest(red))
    expect((await searchImage(red)).total).toBe(0)
    const published = await request(app).put('/api/products/' + draft._id).set(bearer(a)).send(publishedBody(url))
    expect(published.status).toBe(200)
    const search = await request(app).post('/api/image-search').attach('image', red, { filename: 'query.png', contentType: 'image/png' })
    expect(search.status).toBe(200)
    expect(search.body.exactMatches.map(p => p._id)).toEqual([draft._id])
    expect(search.body.exactMatches[0].imageUrl).toBe(url)
    await hasImage(url, buyer)
    await Product.updateOne({ _id: draft._id }, { $set: { isDraft: true } })
    expect((await searchImage(red)).total).toBe(0)
    noImage(await image(url, buyer), red)
  } finally { await worker.stop({ graceMs: 1000 }) }
})

test('queued indexing rejects staff whose product permission was removed after enqueue', async () => {
  const url = await upload(staff), draft = await create(url, { actor: staff })
  await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_rfq'] } })
  const worker = createWorker({ handlers, concurrency: 1, leaseMs: 5000, heartbeatMs: 1000 })
  try {
    expect(await worker.runOnce()).toBeTruthy()
    const job = await BackgroundJob.findOne({ 'payload.productId': draft._id })
    expect(job.status).toBe('failed')
    expect(job.error.code).toBe('JOB_REJECTED')
    expect(await VisualEmbedding.countDocuments({ productId: draft._id })).toBe(0)
  } finally { await worker.stop({ graceMs: 1000 }) }
})

test('forged AI job cannot read a different supplier asset even with a known local reference', async () => {
  const url = await upload()
  const { job } = await enqueueJob({ type: 'ai_product_draft', ownerId: String(b.user._id), requestedBy: String(b.user._id),
    requiredPermission: 'manage_products', payload: { imageUrl: url, mimetype: 'image/png' }, idempotencyKey: 'foreign-asset-' + serial })
  const worker = createWorker({ handlers })
  try {
    expect(await worker.runOnce()).toBeTruthy()
    const current = await BackgroundJob.findById(job._id)
    expect(current.status).toBe('failed')
    expect(current.error.code).toBe('JOB_REJECTED')
    expect(current.result).toBeFalsy()
    await hasImage(url, a)
    noImage(await image(url, b), red)
  } finally { await worker.stop({ graceMs: 1000 }) }
})

test('catalog reassignment cannot expose private pixels through an old index or a fresh indexing request', async () => {
  const url = await upload(), product = await create(url, { published: true })
  expect((await indexProduct(product._id)).status).toBe('indexed')
  expect((await searchImage(red)).total).toBe(1)
  await Product.updateOne({ _id: product._id }, { $set: { supplierId: b.user._id, storeId: storeB._id } })
  expect((await searchImage(red)).total).toBe(0)
  expect(await indexProduct(product._id)).toMatchObject({ status: 'unindexed', reason: 'unmanaged_or_foreign_asset' })
  noImage(await image(url, b), red)
})

test('backup and restore preserve registry identity, exact files and private authorization in a separate target', async () => {
  const url = await upload(), secondary = await upload(a, blue)
  const draft = await create(url, { extra: { images: [secondary] } })
  expect((await indexProduct(draft._id, { actorId: a.user._id })).status).toBe('indexed')
  const sourceUri = mongo.getUri('phase_a_privacy_source')
  const archive = path.join(sandbox, 'phase-a-backup')
  const mediaTarget = path.join(sandbox, 'phase-a-restored-uploads')
  const { manifest } = await backupDatabase({ uri: sourceUri, uploads, output: archive })
  expect(manifest.collections.find(c => c.name === MediaAsset.collection.name).documents).toBe(2)
  expect((await validateBackup(archive)).manifest.status).toBe('complete')
  const target = 'phase_a_privacy_restored'
  const restored = await restoreDatabase({ uri: sourceUri, configuredProductionUri: sourceUri, archive, targetDatabase: target, confirmTarget: target, mediaTarget, outcome: path.join(sandbox, 'phase-a-restore-outcome.json') })
  expect(restored.outcome.status).toBe('complete')
  expect(await fsp.readFile(path.join(mediaTarget, path.basename(url)))).toEqual(red)
  expect(await fsp.readFile(path.join(mediaTarget, path.basename(secondary)))).toEqual(blue)
  const sourceAsset = await MediaAsset.findOne({ imageUrl: url }).lean()
  await mongoose.disconnect()
  process.env.UPLOADS_DIR = mediaTarget
  try {
    await mongoose.connect(mongo.getUri(target))
    const restoredAsset = await MediaAsset.findOne({ imageUrl: url }).lean()
    expect(restoredAsset).toEqual(sourceAsset)
    await hasImage(url, a)
    await hasImage(secondary, a, blue)
    noImage(await image(url, b), red)
    noImage(await image(url, buyer), red)
    noImage(await image(url), red, 401)
    expect((await indexProduct(draft._id, { actorId: a.user._id })).status).toBe('indexed')
    expect((await searchImage(red)).total).toBe(0)
  } finally {
    await mongoose.disconnect()
    process.env.UPLOADS_DIR = uploads
    await mongoose.connect(sourceUri)
  }
})
