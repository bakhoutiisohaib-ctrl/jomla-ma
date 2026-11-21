// H5: actual Express middleware, HTTP, disposable MongoDB and synthetic images.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
jest.mock('morgan', () => () => (_req, _res, next) => next())
jest.mock('../middleware/logger', () => ({ requestLogger: (_req, _res, next) => next(), logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }))
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-h5-rate-'))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'h5-isolated-synthetic-session-secret', DISABLE_REDIS: '1',
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(sandbox, 'uploads'),
  CLAUDE_API_KEY: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const request = require('supertest'), bcrypt = require('bcryptjs'), mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server'), fixtures = require('./helpers/tradeFixtures')
const { mediaFixture } = require('./helpers/mediaFixture')
const Supplier = require('../models/Supplier'), Product = require('../models/Product')
const Sourcing = require('../models/SourcingRequest'), RFQ = require('../models/QuoteRequest')
const Thread = require('../models/MessageThread'), Notification = require('../models/Notification')
const { definition } = require('../services/sourcingCreationIndex')
const { generateToken } = require('../middleware/auth')
const measure = {}, password = 'H5-synthetic-login-only'
let mongo, server, f, ip, serial = 0
jest.setTimeout(180000)
const route = url => '/api/media/' + path.basename(url)
const auth = token => ({ Authorization: 'Bearer ' + token })
const get = (url, token, extra = {}) => {
  const req = request(server).get(url).set('X-Forwarded-For', ip).set(extra)
  return token ? req.set(auth(token)) : req
}
async function raw(url, { method = 'GET', headers = {}, port = server.address().port } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers, agent: false }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }))
    })
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('Isolated H5 HTTP timeout'))); req.end()
  })
}
async function repeat(count, operation, parallel = 20) {
  const statuses = {}
  for (let n = 0; n < count; n += parallel) {
    const rows = await Promise.all(Array.from({ length: Math.min(parallel, count - n) }, (_, i) => operation(n + i)))
    for (const r of rows) statuses[r.status] = (statuses[r.status] || 0) + 1
  }
  return statuses
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'h5_rate_limits', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('h5_rate_limits'))
  await Promise.all([Supplier.init(), Sourcing.init(), RFQ.init(), Thread.init(), Notification.init()])
  await Sourcing.collection.createIndex(definition.key, definition.options)
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
})
beforeEach(async () => {
  app.set('trust proxy', 1) // Test the application's opt-in one-hop proxy policy.
  ip = '198.51.100.' + ++serial
  f = await fixtures()
})
afterAll(async () => {
  if (process.env.H5_TEST_EVIDENCE) fs.writeFileSync(process.env.H5_TEST_EVIDENCE, JSON.stringify(measure, null, 2))
  if (server) await new Promise(resolve => server.close(resolve))
  await mongoose.disconnect(); if (mongo) await mongo.stop()
  // Leave this small sandbox with the external test evidence; no source cleanup.
})

test('shared IP media traffic preserves real login, RFQ and Sourcing creation budgets', async () => {
  const images = [f.product.imageUrl]
  for (let n = 1; n < 12; n++) images.push(await mediaFixture(f.supplier))
  await Product.updateOne({ _id: f.product._id }, { $set: { images: images.slice(1) } })
  await Supplier.updateOne({ _id: f.buyer._id }, { $set: { password: await bcrypt.hash(password, 4) } })
  const start = Date.now(), count = 4 * 12 * 61
  // Four browser identities behind one IP; 12 images, initial + 60 refreshes.
  // Requests are accelerated, not a 15-minute production throughput benchmark.
  const statuses = await repeat(count, i => get(route(images[i % 12]), i % 4 === 0 ? f.tokens.buyer : undefined,
    { 'User-Agent': 'Synthetic-browser-' + (i % 4), Cookie: 'h5-browser=' + (i % 4) }), 24)
  const login = await request(server).post('/api/suppliers/login').set('X-Forwarded-For', ip).send({ email: f.buyer.email, password })
  const rfq = await request(server).post('/api/rfq').set('X-Forwarded-For', ip).set(auth(f.tokens.buyer))
    .set('Idempotency-Key', crypto.randomUUID()).send({ productId: String(f.product._id), quantity: 20, buyerPhone: '+212655443322' })
  const sourcing = await request(server).post('/api/sourcing').set('X-Forwarded-For', ip).set(auth(f.tokens.buyer))
    .set('Idempotency-Key', crypto.randomUUID()).send({ productName: 'H5 synthetic requirement', buyerPhone: '+212655443322', quantity: 20, unit: 'pair' })
  measure.sharedIp = { requests: count, browsers: 4, images: 12, cycles: 61, mediaStatuses: statuses, login: login.status,
    rfq: rfq.status, sourcing: sourcing.status, businessRemaining: sourcing.headers['ratelimit-remaining'], elapsedMs: Date.now() - start }
  expect(statuses).toEqual({ 200: count })
  expect(login.status).toBe(200); expect(rfq.status).toBe(201); expect(sourcing.status).toBe(201)
  expect(Number(sourcing.headers['ratelimit-remaining'])).toBe(997)
})

test('commercial API still exhausts at 1000 while media keeps an independent allowance', async () => {
  const statuses = await repeat(1000, () => get('/api/rfq/buyer'))
  expect(statuses).toEqual({ 401: 1000 })
  const blocked = await get('/api/sourcing/mine'), media = await get(route(f.product.imageUrl))
  expect(blocked.status).toBe(429); expect(blocked.headers['ratelimit-limit']).toBe('1000')
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  expect(media.status).toBe(200); expect(media.headers['ratelimit-limit']).toBe('6000')
  measure.business = { requests: 1000, statuses, next: blocked.status, mediaAfter: media.status }
})

test('authentication retains its separate 30-attempt limit without borrowing media quota', async () => {
  const statuses = await repeat(30, () => request(server).post('/api/suppliers/login').set('X-Forwarded-For', ip)
    .send({ email: 'missing@h5.test', password: 'synthetic-wrong-password' }))
  expect(statuses).toEqual({ 401: 30 })
  const blocked = await request(server).post('/api/suppliers/login').set('X-Forwarded-For', ip).send({})
  expect(blocked.status).toBe(429); expect(blocked.headers['ratelimit-limit']).toBe('30')
  expect((await get(route(f.product.imageUrl))).status).toBe(200)
  measure.authentication = { requests: 30, statuses, next: blocked.status }
})

test('media abuse, including denied or nonexistent assets, reaches its own limit and remains no-store', async () => {
  const first = await get(route(f.product.imageUrl))
  expect(first.status).toBe(200); expect(first.headers['ratelimit-limit']).toBe('6000')
  const denied = await repeat(5999, () => get('/api/media/h5-missing.png'))
  expect(denied).toEqual({ 401: 5999 })
  const blocked = await get(route(f.product.imageUrl))
  expect(blocked.status).toBe(429); expect(blocked.headers['cache-control']).toBe('private, no-store')
  expect(blocked.headers.pragma).toBe('no-cache'); expect(blocked.headers.vary).toMatch(/Authorization/i)
  expect(blocked.headers.etag).toBeUndefined(); expect(blocked.headers['ratelimit-remaining']).toBe('0')
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  const commercial = await get('/api/rfq/buyer', f.tokens.buyer)
  expect(commercial.status).toBe(200); expect(commercial.headers['ratelimit-remaining']).toBe('999')
  expect((await request(server).get('/health/live')).status).toBe(200)
  measure.mediaAbuse = { allowedBudget: 6000, statuses: denied, next: blocked.status, commercialAfter: commercial.status }
})

test('only the mounted media path receives the separate budget; similar paths cannot exempt other API calls', async () => {
  for (const target of ['/api/media-other', '/api/media.json', '/api/media%2Ffile.png', '/api//media/file.png', '/uploads/h5.png', '/api/rfq/buyer?media=true']) {
    const r = await raw(target, { headers: { 'X-Forwarded-For': ip, 'X-Media-Budget': 'true' } })
    expect(r.headers['ratelimit-limit']).toBe('1000'); expect([401, 404]).toContain(r.status)
  }
  for (const target of [route(f.product.imageUrl), route(f.product.imageUrl).replace('/api/media/', '/API/MeDiA/'), '/api/media', '/api/media/../rfq/buyer']) {
    const r = await raw(target, { headers: { 'X-Forwarded-For': ip } })
    expect(r.headers['ratelimit-limit']).toBe('6000')
    if (target.includes('..')) expect(r.status).toBe(404)
  }
})

test('HEAD and failed authentication consume media quota without bypassing authorization or cache policy', async () => {
  const head = await raw(route(f.product.imageUrl), { method: 'HEAD', headers: { 'X-Forwarded-For': ip } })
  expect(head.status).toBe(200); expect(head.bytes.length).toBe(0)
  const invalid = await get(route(f.product.imageUrl), 'h5-invalid-token')
  expect(invalid.status).toBe(401); expect(invalid.headers['ratelimit-remaining']).toBe('5998')
  expect(invalid.headers['cache-control']).toBe('private, no-store')
  const notReadable = await get('/uploads/' + path.basename(f.product.imageUrl))
  expect(notReadable.status).toBe(404); expect(notReadable.headers['ratelimit-limit']).toBe('1000')
})

test('private ownership, withdrawal and expired or revoked sessions survive independent media limiting', async () => {
  const privateUrl = route(await mediaFixture(f.supplier))
  expect((await get(privateUrl, f.tokens.supplier)).status).toBe(200)
  for (const token of [undefined, f.tokens.buyer, f.tokens.otherSupplier]) {
    const denied = await get(privateUrl, token)
    expect(denied.status).toBe(token ? 404 : 401); expect(denied.headers['cache-control']).toMatch(/no-store/)
  }
  await Product.updateOne({ _id: f.product._id }, { $set: { isDraft: true } })
  const revoked = await get(route(f.product.imageUrl), undefined, { 'If-None-Match': '*', Range: 'bytes=0-4' })
  expect(revoked.status).toBe(401); expect(revoked.headers['cache-control']).toMatch(/private, no-store/)
  expect(revoked.headers['content-type']).not.toMatch(/^image\//)
  expect(revoked.headers['last-modified']).toBeUndefined()
  await Supplier.updateOne({ _id: f.supplier._id }, { $inc: { tokenVersion: 1 } })
  expect((await get(privateUrl, f.tokens.supplier)).status).toBe(401)
  const fresh = await Supplier.findById(f.supplier._id).select('+tokenVersion')
  expect((await get(privateUrl, generateToken(fresh))).status).toBe(200)
  const expired = require('jsonwebtoken').sign({ id: String(f.supplier._id), tokenVersion: fresh.tokenVersion }, process.env.JWT_SECRET, { expiresIn: -1, algorithm: 'HS256' })
  expect((await get(privateUrl, expired)).status).toBe(401)
})

test('direct mode ignores spoofed forwarding identities for both independent budgets', async () => {
  app.set('trust proxy', false)
  const statuses = await repeat(1000, i => raw('/api/rfq/buyer', { headers: { 'X-Forwarded-For': '203.0.113.' + (i % 250 + 1), 'X-Real-IP': '192.0.2.' + (i % 250 + 1), Forwarded: 'for=192.0.2.200' } }))
  expect(statuses).toEqual({ 401: 1000 })
  const blocked = await raw('/api/rfq/buyer', { headers: { 'X-Forwarded-For': '203.0.113.251' } })
  expect(blocked.status).toBe(429)
  const mediaA = await raw(route(f.product.imageUrl), { headers: { 'X-Forwarded-For': '203.0.113.9' } })
  const mediaB = await raw(route(f.product.imageUrl), { headers: { 'X-Forwarded-For': '203.0.113.10' } })
  expect(mediaA.status).toBe(200); expect(mediaB.status).toBe(200)
  expect(mediaA.headers['ratelimit-remaining']).toBe('5999'); expect(mediaB.headers['ratelimit-remaining']).toBe('5998')
  measure.directSpoof = { statuses, next: blocked.status, mediaRemaining: [mediaA.headers['ratelimit-remaining'], mediaB.headers['ratelimit-remaining']] }
})

test('a real single-hop proxy overwrites attacker forwarding headers and preserves JWT authorization', async () => {
  app.set('trust proxy', 1)
  const proxy = http.createServer((req, res) => {
    const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http' }
    delete headers.forwarded; delete headers['x-real-ip']
    const upstream = http.request({ hostname: '127.0.0.1', port: server.address().port, method: req.method, path: req.url, headers }, answer => {
      res.writeHead(answer.statusCode, answer.headers); answer.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() }); req.pipe(upstream)
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  try {
    const port = proxy.address().port, privateUrl = route(await mediaFixture(f.supplier))
    const headers = { 'X-Forwarded-For': '198.51.100.250, 203.0.113.250', 'X-Real-IP': '192.0.2.250', Forwarded: 'for=192.0.2.251' }
    // Fill this real peer's budget even when the test is run by itself.
    await repeat(1000, () => raw('/api/rfq/buyer', { port, headers }))
    // Forged headers cannot give this caller a fresh budget through the proxy.
    expect((await raw('/api/rfq/buyer', { port, headers })).status).toBe(429)
    const a = await raw(privateUrl, { port, headers: { ...headers, ...auth(f.tokens.supplier) } })
    const b = await raw(privateUrl, { port, headers: { ...headers, 'X-Forwarded-For': '192.0.2.249', ...auth(f.tokens.buyer) } })
    expect(a.status).toBe(200); expect(b.status).toBe(404)
    expect(Number(b.headers['ratelimit-remaining'])).toBe(Number(a.headers['ratelimit-remaining']) - 1)
    measure.proxy = { authorized: a.status, foreign: b.status, forgedCommercial: 429, samePeerRemainingDelta: 1 }
  } finally { await new Promise(resolve => proxy.close(resolve)) }
})
