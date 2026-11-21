// C2 synthetic production-build fixture. Loopback only, no project dotenv/data.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-c2-preview-'))
for (const dir of ['uploads', 'logs']) fs.mkdirSync(path.join(root, dir))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1' })
require('dotenv').config = () => ({ parsed: {} })
const express = require('express'), mongoose = require('mongoose'), bcrypt = require('bcryptjs'), sharp = require('sharp')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier'), Organization = require('../models/Organization'), Store = require('../models/Store')
const Product = require('../models/Product'), QuoteRequest = require('../models/QuoteRequest'), Review = require('../models/Review')
const { saveImage } = require('../middleware/upload')
const evidenceRun = ['capture-recheck', 'final-recheck'].includes(process.argv[2]) ? process.argv[2] : '.'
const evidence = path.resolve(__dirname, '../../reports/phase-c2-evidence', evidenceRun)
fs.mkdirSync(evidence, { recursive: true })
const controlFile = path.join(evidence, 'preview-control.json'), base = 'http://127.0.0.1:5058'
let mongo, server, timer, supplier, buyer, store, product, draft, busy = false, stopping = false
const history = []
const write = (name, data) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(data, null, 2))
async function probe(route, html = false) {
  const response = await fetch(base + route, { headers: { Accept: html ? 'text/html' : 'application/json' }, cache: 'no-store' })
  const buffer = Buffer.from(await response.arrayBuffer()), text = buffer.toString('utf8')
  return { route, status: response.status, contentType: response.headers.get('content-type'),
    title: /<title>([^<]+)<\/title>/.exec(text)?.[1], containsProductNameInRawHtml: html && text.includes(product.name),
    includesOgImage: html && /property=["']og:image/.test(text), bytes: buffer.length }
}
async function control() {
  if (busy || stopping || !fs.existsSync(controlFile)) return
  busy = true
  try {
    const { action } = JSON.parse(fs.readFileSync(controlFile, 'utf8')); fs.rmSync(controlFile)
    if (action === 'stop') { await shutdown(); return }
    const actions = {
      unpublish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: true } }),
      publish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: false } }),
      deleteProduct: () => Product.deleteOne({ _id: product._id }),
      suspendStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: true } }),
      restoreStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: false } }),
      suspendSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: false } }),
      restoreSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: true } })
    }
    if (!actions[action]) throw new Error('Unknown fixture control')
    await actions[action]()
    history.push({ action, at: new Date(), product: await probe('/api/products/' + product._id),
      store: await probe('/api/stores/' + store._id), logo: await probe('/api/media/' + path.basename(store.logoUrl)) })
    write('preview-control-history.json', history); write('preview-control-result.json', history.at(-1))
    console.log('C2_FIXTURE_CONTROL ' + action)
  } catch { console.error('C2 fixture control failed') }
  finally { busy = false }
}
async function main() {
  fs.rmSync(controlFile, { force: true })
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'phase_c2_browser', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('phase_c2_browser'))
  const password = await bcrypt.hash('C2-LocalOnly123!', 4)
  supplier = await Supplier.create({ name: '[تجريبي C2] مورد الأحذية / Fournisseur', role: 'supplier', email: 'supplier@c2.test', password,
    city: 'الرباط', phone: '+212600000001', description: 'معلومات عامة اصطناعية / Profil public synthétique', verificationDoc: 'C2_PRIVATE_DOCUMENT' })
  buyer = await Supplier.create({ name: '[تجريبي C2] مشتري / Acheteur', role: 'buyer', email: 'buyer@c2.test', password, phone: '+212600000010', city: 'الرباط' })
  const otherBuyer = await Supplier.create({ name: '[تجريبي C2] مشتري آخر', role: 'buyer', email: 'buyer2@c2.test', password, phone: '+212600000011' })
  const org = await Organization.create({ name: '[تجريبي C2] شركة', ownerSupplierId: supplier._id })
  const identity = { id: String(supplier._id), ownerId: String(supplier._id), role: 'supplier', organizationId: String(org._id), permissions: ['all'] }
  const refs = []
  for (const color of ['#129b80', '#345fc4', '#e3a340', '#bc386b']) {
    const buffer = await sharp({ create: { width: 360, height: 240, channels: 3, background: color } }).png().toBuffer()
    refs.push(await saveImage({ buffer, mimetype: 'image/png' }, identity))
  }
  store = await Store.create({ name: '[تجريبي C2] متجر الجملة / Boutique de gros', slug: 'c2-local', supplierId: supplier._id,
    organizationId: org._id, isActive: true, reviewStatus: 'approved', city: 'الرباط', address: 'عنوان عام تجريبي / Adresse de test',
    phone: '+212600000001', logoUrl: refs[2], description: 'متجر اصطناعي لفحص الروابط فقط. Boutique synthétique, sans vente réelle.', reviewReason: 'C2_PRIVATE_STORE_NOTE' })
  const common = { supplierId: supplier._id, storeId: store._id, category: 'أحذية / Chaussures', city: 'الرباط', country: 'MA',
    price: 120, currency: 'MAD', unit: 'زوج / paire', moq: 10,
    description: 'منتج اصطناعي لفحص الصفحة والصور وشرائح الجملة، وليس عرض بيع حقيقياً. Produit de test uniquement.',
    isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true, hasImageRights: true,
    imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() }, approvedBy: supplier._id, approvedAt: new Date() }
  product = await Product.create({ ...common, name: '[تجريبي C2] حذاء جملة / Chaussure en gros', imageUrl: refs[0], images: [refs[1]],
    priceTiers: [{ minQty: 10, maxQty: 49, price: 110 }, { minQty: 50, price: 100 }] })
  for (let i = 1; i <= 12; i++) await Product.create({ ...common, name: '[تجريبي C2] صنف ' + i + ' / Article ' + i, imageUrl: refs[1] })
  draft = await Product.create({ name: 'C2_PRIVATE_DRAFT', supplierId: supplier._id, imageUrl: refs[3], isDraft: true })
  const pendingStore = await Store.create({ name: 'C2_PRIVATE_PENDING_STORE', slug: 'c2-pending', supplierId: supplier._id, reviewStatus: 'pending', isActive: false })
  await Review.create({ supplierId: supplier._id, productId: product._id, buyerId: buyer._id, userName: buyer.name, stars: 4, comment: 'تقييم اصطناعي / Avis synthétique' })
  await Review.create({ supplierId: supplier._id, productId: product._id, buyerId: otherBuyer._id, userName: otherBuyer.name, stars: 5, comment: 'اختبار فقط / Test uniquement' })
  const web = express(), build = path.resolve(__dirname, '../../frontend/build')
  // Preserve API prefixes. Never serve index.html for API, media, uploads or a
  // missing static asset; only document routes receive the SPA shell.
  web.use((req, res, next) => {
    if (!/^\/(?:api|health|uploads)(?:\/|$)/i.test(req.path)) return next()
    app(req, res, err => err ? next(err) : res.status(404).json({ message: 'Not found' }))
  })
  web.use(express.static(build))
  web.get(/.*/, (req, res) => {
    if (!req.accepts('html') || path.extname(req.path)) return res.status(404).json({ message: 'Not found' })
    res.sendFile(path.join(build, 'index.html'))
  })
  server = web.listen(5058, '127.0.0.1', async () => {
    write('preview-runtime.json', { pid: process.pid, temporaryRoot: root, port: 5058, isolated: true, originalDatabaseUsed: false,
      productId: product._id, storeId: store._id, draftId: draft._id, pendingStoreId: pendingStore._id,
      productUrl: base + '/products/' + product._id, storeUrl: base + '/stores/' + store._id })
    write('spa-http-probes.json', await Promise.all([
      probe('/products/' + product._id, true), probe('/stores/' + store._id, true), probe('/api/products/' + product._id),
      probe('/api/products/' + draft._id), probe('/api/stores/' + pendingStore._id), probe('/api/not-found', true),
      probe('/static/missing-c2.js', true), probe(product.imageUrl, true), probe('/unknown-client-route', true) ]))
    console.log('PHASE_C2_PREVIEW_READY ' + base)
  })
  server.on('error', () => shutdown(1))
  timer = setInterval(control, 200)
  process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown())
}
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true; clearInterval(timer)
  if (server?.listening) { const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections?.(); await closed }
  if (mongoose.connection.readyState === 1 && buyer && product && draft) write('browser-db-result.json', { synthetic: true, originalDatabaseUsed: false,
    rfqCreatedByFixtureBuyer: await QuoteRequest.countDocuments({ buyerId: buyer._id, productId: product._id }),
    privateDraftUnpublished: (await Product.findById(draft._id).lean())?.isDraft === true })
  await mongoose.disconnect(); if (mongo) await mongo.stop()
  require('../middleware/logger').logger.close()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-c2-preview-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary Windows log handle only */ }
  }
  fs.rmSync(controlFile, { force: true })
  write('preview-shutdown.json', { stopped: true, temporaryDirectoryRemoved: !fs.existsSync(root), originalDatabaseUsed: false })
  console.log('PHASE_C2_PREVIEW_STOPPED'); process.exit(code)
}
main().catch(async () => { console.error('Isolated C2 preview failed'); await shutdown(1) })
