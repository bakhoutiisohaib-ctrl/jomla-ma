// Disposable loopback-only C1 production-build check. Never reads project dotenv.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-c1-preview-'))
for (const part of ['uploads', 'logs']) fs.mkdirSync(path.join(root, part))
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  MONGODB_URI: 'mongodb://127.0.0.1:1/disabled-original', UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', BRAVE_SEARCH_API_KEY: '', DISABLE_REDIS: '1' })
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
const { saveImage } = require('../middleware/upload')
const { indexProduct } = require('../services/visualIndex')
const { generateToken } = require('../middleware/auth')
const evidence = path.resolve(__dirname, '../../reports/phase-c1-evidence')
fs.mkdirSync(evidence, { recursive: true })
const controlFile = path.join(evidence, 'preview-control.json')
let mongo, server, timer, supplier, store, product, privateRef, busy = false, stopping = false
const history = []
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))
const mediaPath = ref => '/api/media/' + path.basename(ref)
async function probe(ref, owner = false) {
  const response = await fetch('http://127.0.0.1:5057' + mediaPath(ref), {
    headers: owner ? { Authorization: 'Bearer ' + generateToken(supplier) } : {}, cache: 'no-store' })
  const bytes = await response.arrayBuffer()
  return { status: response.status, contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'), bytes: bytes.byteLength }
}
async function control() {
  if (busy || stopping || !fs.existsSync(controlFile)) return
  busy = true
  try {
    const { action } = JSON.parse(fs.readFileSync(controlFile, 'utf8'))
    fs.rmSync(controlFile)
    if (action === 'stop') { await shutdown(); return }
    const actions = {
      unpublish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: true } }),
      publish: () => Product.updateOne({ _id: product._id }, { $set: { isDraft: false } }),
      suspendStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: true } }),
      restoreStore: () => Store.updateOne({ _id: store._id }, { $set: { adminSuspended: false } }),
      suspendSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: false } }),
      restoreSupplier: () => Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: true } })
    }
    if (!actions[action]) throw new Error('Unknown synthetic fixture control')
    await actions[action]()
    history.push({ action, at: new Date(), anonymousPublicReference: await probe(product.imageUrl),
      anonymousPrivateReference: await probe(privateRef) })
    write('preview-control-history.json', history)
    write('preview-control-result.json', history.at(-1))
    console.log('C1_FIXTURE_CONTROL ' + action)
  } catch { console.error('C1 fixture control failed') }
  finally { busy = false }
}
async function main() {
  fs.rmSync(controlFile, { force: true })
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'phase_c1_browser' } })
  await mongoose.connect(mongo.getUri('phase_c1_browser'))
  const password = await bcrypt.hash('C1-LocalOnly123!', 4)
  supplier = await Supplier.create({ role: 'supplier', name: '[تجريبي C1] Fournisseur / مورد',
    email: 'supplier@c1.test', password, city: 'الرباط', phone: '+212600000001' })
  const organization = await Organization.create({ ownerSupplierId: supplier._id, name: '[تجريبي C1] شركة' })
  store = await Store.create({ supplierId: supplier._id, organizationId: organization._id, name: '[تجريبي C1] Boutique / متجر',
    slug: 'c1-local-test', reviewStatus: 'approved', isActive: true, city: 'الرباط', description: 'بيانات اصطناعية / Données synthétiques' })
  const identity = { id: String(supplier._id), ownerId: String(supplier._id), role: 'supplier',
    organizationId: String(organization._id), permissions: ['all'] }
  const picture = color => sharp({ create: { width: 320, height: 200, channels: 3, background: color } }).png().toBuffer()
  const refs = []
  for (const color of ['#20a181', '#315dc8', '#c4376c', '#d58a17']) refs.push(await saveImage({ buffer: await picture(color), mimetype: 'image/png' }, identity))
  const published = { supplierId: supplier._id, storeId: store._id, category: 'اختبار / Test', city: 'الرباط', price: 25,
    currency: 'MAD', moq: 10, unit: 'قطعة / pièce', description: 'منتج اصطناعي فقط، ليس عرض بيع. Produit synthétique, sans vente réelle.',
    isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true, hasImageRights: true,
    imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() }, approvedBy: supplier._id, approvedAt: new Date() }
  product = await Product.create({ ...published, name: '[تجريبي C1] منتج أخضر / Produit vert', imageUrl: refs[0], images: [refs[1]] })
  const other = await Product.create({ ...published, name: '[تجريبي C1] منتج أزرق / Produit bleu', imageUrl: refs[1] })
  privateRef = refs[2]
  await Product.create({ supplierId: supplier._id, name: '[خاص C1] مسودة / Brouillon privé', isDraft: true, imageUrl: privateRef })
  await indexProduct(product._id); await indexProduct(other._id)
  const web = express()
  web.use(express.static(path.resolve(__dirname, '../../frontend/build')))
  web.use(app)
  server = web.listen(5057, '127.0.0.1', async () => {
    write('preview-runtime.json', { pid: process.pid, temporaryRoot: root, port: 5057, isolated: true,
      originalDatabaseUsed: false, productId: product._id, storeId: store._id, supplierId: supplier._id,
      publicReference: product.imageUrl, secondaryReference: refs[1], privateReference: privateRef, unattachedReference: refs[3] })
    write('preview-initial-probes.json', { public: await probe(product.imageUrl), private: await probe(privateRef),
      ownerPrivate: await probe(privateRef, true), unattached: await probe(refs[3]) })
    console.log('PHASE_C1_PREVIEW_READY http://127.0.0.1:5057')
  })
  server.on('error', () => shutdown(1))
  timer = setInterval(control, 200)
  process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown())
}
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true; clearInterval(timer)
  if (server?.listening) { const closed = new Promise(resolve => server.close(resolve)); server.closeIdleConnections?.(); await closed }
  await mongoose.disconnect(); if (mongo) await mongo.stop()
  require('../middleware/logger').logger.close()
  const checked = path.resolve(root)
  if (path.dirname(checked) === fs.realpathSync(os.tmpdir()) && path.basename(checked).startsWith('jomla-c1-preview-')) {
    try { fs.rmSync(checked, { recursive: true, force: true }) } catch { /* temporary log handle only */ }
  }
  fs.rmSync(controlFile, { force: true })
  write('preview-shutdown.json', { stopped: true, temporaryDirectoryRemoved: !fs.existsSync(root), originalDatabaseUsed: false })
  console.log('PHASE_C1_PREVIEW_STOPPED')
  process.exit(code)
}
main().catch(async () => { console.error('Isolated C1 preview failed'); await shutdown(1) })
