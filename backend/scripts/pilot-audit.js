// Phase 2 browser fixture. Loopback only. No original database/config is used.
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-pilot-audit-'))
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled_original_connection',
  UPLOADS_DIR: path.join(sandbox, 'uploads'), LOG_DIR: path.join(sandbox, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false',
  BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1', CORS_ORIGIN: 'http://127.0.0.1:5057',
  TRUST_PROXY: '0'
})
fs.mkdirSync(process.env.UPLOADS_DIR)
fs.mkdirSync(process.env.LOG_DIR)
require('dotenv').config = () => ({ parsed: {} })
const express = require('express')
const mongoose = require('mongoose')
const sharp = require('sharp')
const bcrypt = require('bcryptjs')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const Store = require('../models/Store')
const Product = require('../models/Product')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const AuditLog = require('../models/AuditLog')
const Notification = require('../models/Notification')
const BackgroundJob = require('../models/BackgroundJob')
const { saveImage } = require('../middleware/upload')
const { indexProduct } = require('../services/visualIndex')
const evidenceDir = path.resolve(__dirname, '../../reports/pilot-evidence')
fs.mkdirSync(evidenceDir, { recursive: true })
const events = []
let database, server, worker, shuttingDown = false

async function snapshot() {
  return {
    isolated: true, sourceDatabaseUsed: false, externalProvidersEnabled: false,
    recordedAt: new Date().toISOString(),
    accounts: await Supplier.find().select('name role city organizationId isActive').lean(),
    organizations: await Organization.find().select('name ownerSupplierId city').lean(),
    memberships: await Membership.find().select('userId organizationId role status permissions').lean(),
    stores: await Store.find().select('name supplierId reviewStatus isActive adminSuspended').lean(),
    products: await Product.find().select('name supplierId storeId pricingMode price currency moq unit priceTiers isDraft hasImageRights approvedBy availability availabilityConfirmed').lean(),
    rfqs: await QuoteRequest.find().select('productId buyerId supplierId quantity currency status currentOfferId revision').lean(),
    offers: await QuoteOffer.find().select('quoteRequestId supplierId unitPrice currency status deliveryDays').lean(),
    notifications: await Notification.find().select('type resourceId readAt').lean(),
    jobs: await BackgroundJob.find().select('type status attempts error').lean(),
    audits: await AuditLog.find().select('action phase targetType targetId').lean()
  }
}

async function main() {
  database = await MongoMemoryServer.create({ instance: { dbName: 'pilot_audit_only' } })
  process.env.MONGODB_URI = database.getUri('pilot_audit_only')
  await mongoose.connect(process.env.MONGODB_URI)
  const password = await bcrypt.hash('Pilot-Only-2026!', 6)
  await Supplier.create({ name: '[تجريبي] مشرف التدقيق', email: 'admin@pilot.test', password, role: 'admin' })
  // A clearly marked comparison fixture; the audited supplier registers through UI.
  const supplier = await Supplier.create({ name: '[تجريبي] مورد المقارنة', email: 'comparison@pilot.test', password, role: 'supplier', city: 'الرباط', phone: '+212600000011' })
  const org = await Organization.create({ name: '[تجريبي] شركة المقارنة', ownerSupplierId: supplier._id, city: 'الرباط', country: 'MA' })
  await Supplier.updateOne({ _id: supplier._id }, { $set: { organizationId: org._id } })
  const store = await Store.create({ name: '[تجريبي] متجر المقارنة', supplierId: supplier._id, organizationId: org._id, slug: 'pilot-comparison', reviewStatus: 'approved', isActive: true, city: 'الرباط', description: 'بيانات اختبار محلية، ليست عروضاً تجارية.' })
  const pixels = Buffer.alloc(96 * 96 * 3, 255)
  for (let y = 18; y < 78; y++) for (let x = 26; x < 70; x++) { const p = (y * 96 + x) * 3; pixels[p] = 195; pixels[p + 1] = 35; pixels[p + 2] = 45 }
  const image = await sharp(pixels, { raw: { width: 96, height: 96, channels: 3 } }).png().toBuffer()
  const imageUrl = await saveImage({ buffer: image, mimetype: 'image/png' }, { id: String(supplier._id), ownerId: String(supplier._id), organizationId: String(org._id), role: 'supplier', permissions: ['all'] })
  const fixture = path.join(sandbox, 'owned-red-test.png')
  const similarFixture = path.join(sandbox, 'owned-red-resized.jpg')
  fs.writeFileSync(fixture, image)
  fs.writeFileSync(similarFixture, await sharp(image).resize(192, 192).jpeg({ quality: 90 }).toBuffer())
  const product = await Product.create({ name: '[تجريبي] عبوة حمراء للمقارنة', category: 'اختبار', description: 'شكل اصطناعي للاختبار فقط، لا يمثل مخزوناً أو عرضاً تجارياً.',
    supplierId: supplier._id, organizationId: org._id, storeId: store._id, price: 27, pricingMode: 'fixed', currency: 'MAD', moq: 20, unit: 'قطعة', city: 'الرباط', country: 'MA',
    imageUrl, isDraft: false, hasImageRights: true, imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() },
    approvedBy: supplier._id, approvedAt: new Date(), availability: 'in_stock', availabilityConfirmed: true, inStock: true })
  await indexProduct(product._id, { actorId: supplier._id })
  worker = require('../services/jobQueue').createWorker({ handlers: require('../services/jobHandlers'), pollMs: 200 }).start()
  const web = express()
  web.use((req, res, next) => {
    const start = Date.now()
    // Capture before a mounted Express application changes req.url/path.
    const apiPath = req.path
    res.on('finish', () => {
      if (apiPath.startsWith('/api/')) events.push({ method: req.method, path: apiPath, status: res.statusCode, durationMs: Date.now() - start })
    })
    next()
  })
  web.get('/__audit/state', async (_req, res) => {
    const data = await snapshot()
    fs.writeFileSync(path.join(evidenceDir, 'browser-db-state.json'), JSON.stringify(data, null, 2))
    fs.writeFileSync(path.join(evidenceDir, 'browser-api-events.json'), JSON.stringify({ isolated: true, events }, null, 2))
    res.json(data)
  })
  web.post('/__audit/stop', (_req, res) => { res.json({ stopping: true }); setTimeout(shutdown, 100) })
  const build = path.resolve(__dirname, '../../frontend/build')
  web.get('/', (_req, res) => res.sendFile(path.join(build, 'index.html')))
  web.use(express.static(build))
  web.use(app)
  server = web.listen(5057, '127.0.0.1', () => {
    fs.writeFileSync(path.join(evidenceDir, 'isolation.json'), JSON.stringify({ isolated: true, database: 'MongoMemoryServer', binding: '127.0.0.1:5057', originalEnvLoaded: false, sourceDatabaseUsed: false, externalProvidersEnabled: false, fixturesSynthetic: true }, null, 2))
    console.log(JSON.stringify({ status: 'PILOT_AUDIT_READY', url: 'http://127.0.0.1:5057', fixture, similarFixture }))
  })
}
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  fs.writeFileSync(path.join(evidenceDir, 'browser-db-state.json'), JSON.stringify(await snapshot(), null, 2))
  fs.writeFileSync(path.join(evidenceDir, 'browser-api-events.json'), JSON.stringify({ isolated: true, events }, null, 2))
  if (worker) await worker.stop({ graceMs: 2000 })
  if (server) await new Promise(resolve => server.close(resolve))
  await mongoose.disconnect()
  if (database) await database.stop()
  fs.writeFileSync(path.join(evidenceDir, 'shutdown.json'), JSON.stringify({ stopped: true, sourceDatabaseUsed: false }, null, 2))
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
main().catch(() => { console.error('PILOT_AUDIT_FAILED: no source database was used'); shutdown().catch(() => process.exit(1)) })
