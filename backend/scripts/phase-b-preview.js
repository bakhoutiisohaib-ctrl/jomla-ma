// Disposable production-build verification fixture. Loopback only; no dotenv,
// original database, original files or external providers. Stop via stdin: stop,
// or by creating reports/phase-b-evidence/preview.stop.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-phase-b-browser-'))
for (const name of ['uploads', 'logs', 'mongo']) fs.mkdirSync(path.join(root, name))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'),
  LOG_DIR: path.join(root, 'logs'), CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '',
  EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1' })
require('dotenv').config = () => ({ parsed: {} })
const express = require('express')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Store = require('../models/Store')
const Product = require('../models/Product')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const { saveImage } = require('../middleware/upload')
const { captureOfferContext } = require('../services/commercialAgreement')
const { createDecisionRecovery } = require('../services/rfqDecision')
const evidence = path.resolve(__dirname, '../../reports/phase-b-evidence')
fs.mkdirSync(evidence, { recursive: true })
const stopFile = path.join(evidence, 'preview.stop')
let mongo, server, recovery, stopTimer, rfqId, originalUpdate, shuttingDown = false

async function main() {
  fs.rmSync(stopFile, { force: true })
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'phase_b_browser', storageEngine: 'wiredTiger', dbPath: path.join(root, 'mongo') } })
  await mongoose.connect(mongo.getUri('phase_b_browser'))
  const password = await bcrypt.hash('PhaseB-Only123!', 4)
  const supplier = await Supplier.create({ name: '[تجريبي] مورد الاتفاق', email: 'supplier@phase-b.test', password, role: 'supplier', phone: '+212600000001' })
  const buyer = await Supplier.create({ name: '[تجريبي] مشتري الاتفاق', email: 'buyer@phase-b.test', password, role: 'buyer', phone: '+212600000002' })
  const organization = await Organization.create({ ownerSupplierId: supplier._id, name: '[تجريبي] شركة الاتفاق' })
  const store = await Store.create({ supplierId: supplier._id, organizationId: organization._id, name: '[تجريبي] المتجر', slug: 'phase-b-fixture', reviewStatus: 'approved', isActive: true })
  const buffer = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#118066' } }).png().toBuffer()
  const imageUrl = await saveImage({ buffer, mimetype: 'image/png' }, { id: String(supplier._id), ownerId: String(supplier._id), organizationId: String(organization._id), role: 'supplier', permissions: ['all'] })
  const product = await Product.create({ supplierId: supplier._id, storeId: store._id, imageUrl,
    name: '[تجريبي] المنتج كما عُرض', category: 'اختبار', description: 'تعريف اصطناعي ثابت للمنتج وقت عرض السعر، لا يمثل بيعاً حقيقياً.',
    price: 25, currency: 'MAD', unit: 'زوج', moq: 10, city: 'الرباط', isDraft: false,
    hasImageRights: true, imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() },
    approvedBy: supplier._id, approvedAt: new Date(), availability: 'in_stock', availabilityConfirmed: true, inStock: true })
  const rfq = await QuoteRequest.create({ buyerId: buyer._id, supplierId: supplier._id, productId: product._id,
    buyerName: buyer.name, buyerPhone: buyer.phone, buyerCity: 'الرباط', quantity: 20, currency: 'MAD', notes: 'متطلبات اصطناعية متفق عليها' })
  rfqId = rfq._id
  const offer = await QuoteOffer.create({ ...(await captureOfferContext(rfq)), rfqId, supplierId: supplier._id,
    unitPrice: 19, totalPrice: 380, quantity: 20, currency: 'MAD', deliveryDays: 4, paymentTerms: 'شروط تجريبية ثابتة دون تنفيذ دفع' })
  await MessageThread.create({ rfqId, productId: product._id, supplierId: supplier._id, buyerId: buyer._id,
    buyerName: buyer.name, buyerPhone: buyer.phone, subject: product.name, messages: [] })
  await QuoteRequest.updateOne({ _id: rfqId }, { $set: { currentOfferId: offer._id, status: 'responded', revision: 1,
    offer: { unitPrice: 19, totalPrice: 380, deliveryDays: 4, productSnapshot: offer.productSnapshot } } })
  // The quote, rather than this later catalog edit, defines the agreement unit.
  await Product.updateOne({ _id: product._id }, { $set: { name: '[تجريبي] اسم كتالوج تغير لاحقاً', unit: 'صندوق' } })

  originalUpdate = QuoteOffer.updateOne
  let failOnce = true
  QuoteOffer.updateOne = function (query, update, ...rest) {
    if (failOnce && String(query._id) === String(offer._id) && update.$set?.status === 'accepted') {
      failOnce = false
      return Promise.reject(new Error('Synthetic preview failure before offer projection'))
    }
    return originalUpdate.call(this, query, update, ...rest)
  }
  // A slower poll leaves a clear window to inspect 202 and use the existing PUT
  // retry in the browser. Recovery remains automatic without the browser retry.
  recovery = createDecisionRecovery({ pollMs: 10000 }).start()
  const web = express(), build = path.resolve(__dirname, '../../frontend/build')
  web.use(express.static(build))
  web.use(app)
  server = web.listen(5056, '127.0.0.1', () => {
    fs.writeFileSync(path.join(evidence, 'preview-runtime.json'), JSON.stringify({ pid: process.pid, temporaryRoot: root, port: 5056, isolated: true }))
    console.log('PHASE_B_PREVIEW_READY http://127.0.0.1:5056')
  })
  server.on('error', () => shutdown(1))
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', text => { if (text.trim() === 'stop') shutdown() })
  stopTimer = setInterval(() => { if (fs.existsSync(stopFile)) shutdown() }, 250)
  stopTimer.unref()
  process.on('SIGINT', () => shutdown())
  process.on('SIGTERM', () => shutdown())
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(stopTimer)
  fs.rmSync(stopFile, { force: true })
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  if (recovery) await recovery.stop()
  if (originalUpdate) QuoteOffer.updateOne = originalUpdate
  if (mongoose.connection.readyState === 1 && rfqId) {
    const rfq = await QuoteRequest.findById(rfqId).lean()
    const offer = await QuoteOffer.findById(rfq?.currentOfferId).lean()
    const thread = await MessageThread.findOne({ rfqId }).lean()
    fs.writeFileSync(path.join(evidence, 'browser-db-result.json'), JSON.stringify({ isolated: true, originalDatabaseUsed: false,
      rfqStatus: rfq?.status, offerStatus: offer?.status, threadStatus: thread?.status,
      decision: rfq?.decision, decisionMessageCount: thread?.messages.filter(m => String(m._id) === String(rfq?.decision?.id)).length,
      decisionNotificationCount: await Notification.countDocuments({ resourceId: rfqId, type: 'offer_decision' }) }, null, 2))
  }
  await mongoose.disconnect()
  if (mongo) await mongo.stop()
  require('../middleware/logger').logger.close()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-phase-b-browser-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary log handles only */ }
  }
  fs.writeFileSync(path.join(evidence, 'preview-shutdown.json'), JSON.stringify({ stopped: true, originalDatabaseUsed: false, temporaryDirectoryRemoved: !fs.existsSync(root) }))
  console.log('PHASE_B_PREVIEW_STOPPED')
  process.exit(code)
}
main().catch(async () => { console.error('Isolated Phase B fixture startup failed'); await shutdown(1) })
