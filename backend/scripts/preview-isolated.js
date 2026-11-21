// Disposable local preview; no connection to the configured application database.
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'isolated-preview-only-no-real-user-data'
process.env.CLAUDE_API_KEY = ''
process.env.GOOGLE_VISION_KEY = ''
process.env.EXTERNAL_DISCOVERY_ENABLED = 'false'
// Do not import any credential or original database setting during preview.
require('dotenv').config = () => ({ parsed: {} })
const path = require('path')
const fs = require('fs')
const os = require('os')
process.env.UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-preview-media-'))
process.env.LOG_DIR = path.join(process.env.UPLOADS_DIR, 'logs')
process.env.DISABLE_REDIS = '1'
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/disabled-original'
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

async function main() {
  const database = await MongoMemoryServer.create()
  await mongoose.connect(database.getUri())
  const password = await bcrypt.hash('LocalPreview-Only123!', 10)
  const supplier = await Supplier.create({ name: 'مورد التجربة المحلية', email: 'supplier@local.test', password, role: 'supplier', city: 'الرباط', phone: '+212600000001' })
  const supplierB = await Supplier.create({ name: 'مورد الاختبار الثاني', email: 'supplier-b@local.test', password, role: 'supplier', city: 'الرباط' })
  await Supplier.create({ name: 'مشتري التجربة المحلية', email: 'buyer@local.test', password, role: 'buyer', city: 'الرباط', phone: '+212600000002' })
  await Supplier.create({ name: 'مشرف التجربة المحلية', email: 'admin@local.test', password, role: 'admin' })
  const organization = await Organization.create({ name: 'شركة التجربة المحلية', ownerSupplierId: supplier._id, city: 'الرباط' })
  const organizationB = await Organization.create({ name: 'شركة الاختبار الثانية', ownerSupplierId: supplierB._id, city: 'الرباط' })
  await Supplier.updateOne({ _id: supplier._id }, { $set: { organizationId: organization._id } })
  const store = await Store.create({ name: 'متجر التجربة المعتمد', supplierId: supplier._id, organizationId: organization._id, slug: 'local-preview', reviewStatus: 'approved', isActive: true, city: 'الرباط', description: 'بيانات اختبار محلية مؤقتة لا تمثل عروضاً تجارية.' })
  const imageUrl = await saveImage({
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    mimetype: 'image/png'
  }, { id: String(supplier._id), ownerId: String(supplier._id), organizationId: String(organization._id), role: 'supplier', permissions: ['all'] })
  const product = await Product.create({
    name: 'منتج جملة للتجربة المحلية', category: 'اختبار', description: 'منتج تجريبي لا يمثل مخزوناً أو سعراً تجارياً حقيقياً.',
    supplierId: supplier._id, storeId: store._id, price: 25, currency: 'MAD', moq: 10, unit: 'قطعة', city: 'الرباط', imageUrl,
    isDraft: false, hasImageRights: true, imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() },
    approvedBy: supplier._id, approvedAt: new Date(), availability: 'in_stock', availabilityConfirmed: true, inStock: true
  })
  for (const [owner, org, color, name] of [[supplier, organization, '#16a085', 'مسودة خاصة للمورد A'], [supplierB, organizationB, '#275bd0', 'مسودة خاصة للمورد B']]) {
    const buffer = await sharp({ create: { width: 96, height: 64, channels: 3, background: color } }).png().toBuffer()
    const privateImage = await saveImage({ buffer, mimetype: 'image/png' }, { id: String(owner._id), ownerId: String(owner._id), organizationId: String(org._id), role: 'supplier', permissions: ['all'] })
    await Product.create({ name, supplierId: owner._id, organizationId: org._id, imageUrl: privateImage, isDraft: true })
  }
  const { enqueueJob, createWorker } = require('../services/jobQueue')
  await enqueueJob({ type: 'visual_index_product', ownerId: String(supplier._id), requestedBy: String(supplier._id),
    organizationId: String(organization._id), payload: { productId: String(product._id) }, idempotencyKey: 'preview-image' })
  const worker = createWorker({ handlers: require('../services/jobHandlers'), pollMs: 200 }).start()
  const web = express()
  const build = path.resolve(__dirname, '../../frontend/build')
  web.get('/', (_req, res) => res.sendFile(path.join(build, 'index.html')))
  web.use(express.static(build))
  web.use(app)
  const server = web.listen(5055, '127.0.0.1', () => {
    console.log('ISOLATED_PREVIEW_READY http://127.0.0.1:5055')
    console.log('SYNTHETIC_PREVIEW_IMAGE ' + path.join(process.env.UPLOADS_DIR, path.basename(imageUrl)))
  })
  async function shutdown() {
    server.close()
    await worker.stop({ graceMs: 1000 })
    await mongoose.disconnect()
    await database.stop()
    require('../middleware/logger').logger.close()
    const previewRoot = path.resolve(process.env.UPLOADS_DIR)
    // This unique temporary directory contains only the synthetic fixture.
    if (path.dirname(previewRoot) === fs.realpathSync(os.tmpdir()) && path.basename(previewRoot).startsWith('jomla-preview-media-')) {
      try { fs.rmSync(previewRoot, { recursive: true, force: true }) } catch { /* Windows log handles may briefly retain temporary files */ }
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
