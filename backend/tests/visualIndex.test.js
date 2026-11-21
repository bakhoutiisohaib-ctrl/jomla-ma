const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const sharp = require('sharp')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const VisualEmbedding = require('../models/VisualEmbedding')
const { VERSION, VECTOR_LENGTH, describeImage, compareDescriptors, indexProduct, searchImage, localImagePath } = require('../services/visualIndex')
const { benchmark, parseArguments } = require('../scripts/index-visuals')
const { mediaFixture } = require('./helpers/mediaFixture')
const { detectImageType } = require('../middleware/upload')

let database, temporaryDirectory, supplier, store, redImage, blueImage
let sequence = 0
const oldUploads = process.env.UPLOADS_DIR
const oldThreshold = process.env.VISUAL_SEARCH_MIN_SCORE
const oldMax = process.env.VISUAL_SEARCH_MAX_CANDIDATES

async function sampleImage(colour, variant = 'square') {
  const pixels = Buffer.alloc(64 * 64 * 3, 255)
  for (let y = 6; y < 58; y++) for (let x = 6; x < 58; x++) {
    if (variant === 'square' || (x - 32) ** 2 + (y - 32) ** 2 < 25 ** 2) {
      for (let c = 0; c < 3; c++) pixels[(y * 64 + x) * 3 + c] = colour[c]
    }
  }
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer()
}

async function imageFile(buffer = redImage) {
  const mimetype = detectImageType(buffer)
  const imageUrl = await mediaFixture(supplier, { buffer: mimetype ? buffer : redImage, mimetype: mimetype || 'image/png' })
  if (!mimetype) await fs.writeFile(localImagePath(imageUrl), buffer)
  return imageUrl
}

async function published(extra = {}) {
  const imageUrl = extra.imageUrl || await imageFile()
  return Product.create({
    name: 'منتج بصري ' + ++sequence, category: 'اختبار', price: 100, currency: 'MAD', city: 'الرباط',
    moq: 1, description: 'وصف كاف لمنتج اختبار البحث البصري', supplierId: supplier._id, storeId: store._id,
    imageUrl, hasImageRights: true, imageRights: { source: 'owned', declaredBy: supplier._id, declaredAt: new Date() },
    approvedBy: supplier._id, approvedAt: new Date(), isDraft: false, inStock: true, availability: 'in_stock', availabilityConfirmed: true,
    ...extra
  })
}

beforeAll(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jomla-visual-test-'))
  process.env.UPLOADS_DIR = temporaryDirectory
  process.env.VISUAL_SEARCH_MIN_SCORE = '0.82'
  database = await MongoMemoryServer.create()
  await mongoose.connect(database.getUri())
  await VisualEmbedding.init()
  redImage = await sampleImage([230, 20, 20])
  blueImage = await sampleImage([10, 30, 230], 'circle')
})

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})))
  process.env.VISUAL_SEARCH_MAX_CANDIDATES = '5000'
  supplier = await Supplier.create({ name: 'مورد بصري', email: 'visual@test.ma', password: 'fixture-hash', role: 'supplier' })
  store = await Store.create({ supplierId: supplier._id, name: 'متجر بصري', slug: 'visual', reviewStatus: 'approved', isActive: true })
})

afterAll(async () => {
  await mongoose.disconnect()
  if (database) await database.stop()
  // Only this test's verified temporary directory is removed.
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('jomla-visual-test-')) await fs.rm(temporaryDirectory, { recursive: true, force: true })
  for (const [name, previous] of [['UPLOADS_DIR', oldUploads], ['VISUAL_SEARCH_MIN_SCORE', oldThreshold], ['VISUAL_SEARCH_MAX_CANDIDATES', oldMax]]) {
    if (previous == null) delete process.env[name]
    else process.env[name] = previous
  }
})

test('descriptors decode real supported formats into finite normalized image feature vectors', async () => {
  for (const format of ['png', 'jpeg', 'webp', 'gif']) {
    const buffer = await sharp(redImage).toFormat(format).toBuffer()
    const descriptor = await describeImage(buffer)
    expect(descriptor.format).toBe(format)
    expect(descriptor.version).toBe(VERSION)
    expect(descriptor.vector).toHaveLength(VECTOR_LENGTH)
    expect(descriptor.vector.every(Number.isFinite)).toBe(true)
    expect(Math.sqrt(descriptor.vector.reduce((sum, n) => sum + n * n, 0))).toBeCloseTo(1, 6)
    expect(descriptor.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(descriptor.perceptualHash).toMatch(/^[a-f0-9]{16}$/)
  }
})

test('rejects fake, truncated, unsupported, oversized and overdimension images without text/filename fallback', async () => {
  for (const buffer of [Buffer.from('not an image; a red square product.jpg'), redImage.subarray(0, 60), Buffer.from('<svg width="12" height="12"><rect width="12" height="12"/></svg>'), Buffer.alloc(10 * 1024 * 1024 + 1)]) {
    await expect(describeImage(buffer)).rejects.toMatchObject({ status: 415 })
  }
  const tooWide = await sharp({ create: { width: 12001, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
  await expect(describeImage(tooWide)).rejects.toMatchObject({ status: 415 })
  expect(compareDescriptors({ vector: [], version: VERSION }, { vector: [], version: VERSION })).toBe(0)
})

test('same bytes are exact_image; resized/recompressed pixels are similar_image; different fixture is ranked lower', async () => {
  const original = await published()
  const resizedBytes = await sharp(redImage).resize(128, 128).jpeg({ quality: 90 }).toBuffer()
  const resized = await published({ imageUrl: await imageFile(resizedBytes) })
  const different = await published({ imageUrl: await imageFile(blueImage) })
  for (const product of [original, resized, different]) await indexProduct(product._id, { actorId: supplier._id })
  const result = await searchImage(redImage)
  expect(String(result.products[0]._id)).toBe(String(original._id))
  expect(result.products[0]).toMatchObject({ matchType: 'exact', matchBasis: 'exact_image', similarityScore: 1 })
  const similar = result.products.find(product => String(product._id) === String(resized._id))
  expect(similar).toMatchObject({ matchType: 'similar', matchBasis: 'similar_image' })
  expect(similar.similarityScore).toBeGreaterThanOrEqual(0.82)
  const differentScore = compareDescriptors(await describeImage(redImage), await describeImage(blueImage))
  expect(differentScore).toBeLessThan(similar.similarityScore)
  expect(result.products.some(product => String(product._id) === String(different._id))).toBe(false)
  expect(result.exactCount).toBe(1)
})

test('public results never return private approval/index documents or supplier secrets', async () => {
  const product = await published({ moderationReason: 'INTERNAL-REASON' })
  await indexProduct(product._id, { actorId: supplier._id })
  const internal = await VisualEmbedding.findOne({ productId: product._id }).select('+vector').lean()
  expect(internal.vector).toHaveLength(VECTOR_LENGTH)
  expect(String(internal.indexedBy)).toBe(String(supplier._id))
  const result = await searchImage(redImage)
  const body = result.products[0]
  for (const field of ['hasImageRights', 'imageRights', 'approvedBy', 'approvedAt', 'moderationReason', 'vector', 'sha256', 'perceptualHash', 'indexedBy', 'sourceFingerprint']) expect(body).not.toHaveProperty(field)
  expect(body.supplierId.name).toBe(supplier.name)
  expect(body.supplierId).not.toHaveProperty('password')
  expect(body.supplierId).not.toHaveProperty('email')
  expect(result.visualSearch).toMatchObject({ adapter: 'local_feature_vectors', exactMeaning: 'same_image_bytes_not_verified_product_identity' })
})

test('draft/hidden/inactive-store/unapproved-store/suspended-store/inactive-supplier indexes stay private', async () => {
  const visible = await published()
  const draft = await published({ isDraft: true })
  const hidden = await published()
  await Product.updateOne({ _id: hidden._id }, { $set: { moderationStatus: 'hidden' } })
  const denied = [draft, hidden]
  for (const settings of [{ isActive: false }, { reviewStatus: 'pending' }, { adminSuspended: true }]) {
    const disabledStore = await Store.create({ supplierId: supplier._id, name: 'مغلق', slug: 'closed-' + ++sequence, reviewStatus: 'approved', isActive: true, ...settings })
    denied.push(await published({ storeId: disabledStore._id }))
  }
  const disabledSupplier = await Supplier.create({ name: 'معطل', email: 'disabled@test.ma', password: 'hash', role: 'supplier', isActive: false })
  const disabledStore = await Store.create({ supplierId: disabledSupplier._id, name: 'مغلق', slug: 'disabled', reviewStatus: 'approved', isActive: true })
  denied.push(await published({ supplierId: disabledSupplier._id, storeId: disabledStore._id }))
  for (const product of [visible, ...denied]) await indexProduct(product._id)
  const result = await searchImage(redImage)
  expect(result.total).toBe(1)
  expect(String(result.products[0]._id)).toBe(String(visible._id))
  // Revocation is immediate; index cleanup is not required to hide a product.
  await Store.updateOne({ _id: store._id }, { $set: { isActive: false } })
  expect((await searchImage(redImage)).total).toBe(0)
})

test('remote/missing/unsafe image sources remain unindexed and are never fetched or inferred from titles', async () => {
  const remote = await published({ imageUrl: 'https://127.0.0.1/private.png', name: 'red square exact photo' })
  const missing = await published({ imageUrl: '/uploads/does-not-exist.png' })
  const unsafe = await published({ imageUrl: '/uploads/../private.png' })
  const corrupt = await published({ imageUrl: await imageFile(Buffer.from('not real photo pixels with product name')) })
  expect(await indexProduct(remote._id)).toMatchObject({ status: 'unindexed', reason: 'remote_or_unsupported_source' })
  expect(await indexProduct(missing._id)).toMatchObject({ status: 'unindexed', reason: 'unmanaged_or_foreign_asset' })
  expect(await indexProduct(unsafe._id)).toMatchObject({ status: 'unindexed', reason: 'remote_or_unsupported_source' })
  expect(await indexProduct(corrupt._id)).toMatchObject({ status: 'unindexed', reason: 'image_unavailable' })
  for (const value of ['https://example.com/file.png', '/uploads/%2e%2e%2fsecret.png', '/uploads/../private.png', 'C:\\secret.png']) expect(localImagePath(value)).toBeNull()
  expect((await searchImage(redImage)).total).toBe(0)
  expect((await searchImage(redImage)).visualSearch.unindexedCount).toBe(4)
})

test('changing URL, replacing bytes at the same URL, deleting files, and old versions never expose stale matches', async () => {
  const changedUrl = await published()
  const replacedBytes = await published()
  const missingFile = await published()
  const oldVersion = await published()
  for (const product of [changedUrl, replacedBytes, missingFile, oldVersion]) await indexProduct(product._id)
  await Product.updateOne({ _id: changedUrl._id }, { $set: { imageUrl: await imageFile(blueImage) } })
  await fs.writeFile(localImagePath(replacedBytes.imageUrl), blueImage)
  await fs.unlink(localImagePath(missingFile.imageUrl))
  await VisualEmbedding.updateOne({ productId: oldVersion._id }, { $set: { version: 'previous-version' } })
  const result = await searchImage(redImage)
  expect(result.total).toBe(0)
  expect(result.visualSearch.staleCount).toBe(3)
  // Immutable managed assets cannot silently adopt replacement bytes. A new
  // upload is required before the changed image can be reindexed.
  expect(await indexProduct(replacedBytes._id)).toMatchObject({ status: 'unindexed', reason: 'image_unavailable' })
  await Product.updateOne({ _id: replacedBytes._id }, { $set: { imageUrl: await imageFile(blueImage) } })
  await indexProduct(replacedBytes._id)
  const reindexed = await searchImage(blueImage)
  expect(reindexed.products.some(p => String(p._id) === String(replacedBytes._id) && p.matchBasis === 'exact_image')).toBe(true)
})

test('pagination counts all threshold matches before slicing and is stable across requests', async () => {
  for (let index = 0; index < 5; index++) await indexProduct((await published())._id)
  const first = await searchImage(redImage, { pagination: { page: 1, limit: 2 } })
  const second = await searchImage(redImage, { pagination: { page: 2, limit: 2 } })
  expect(first.total).toBe(5)
  expect(first.exactCount).toBe(5)
  expect(second.products).toHaveLength(2)
  expect(second.pagination).toEqual({ page: 2, limit: 2, total: 5, pages: 3, hasNextPage: true, hasPrevPage: true })
  const repeated = await searchImage(redImage, { pagination: { page: 2, limit: 2 } })
  expect(repeated.products.map(p => String(p._id))).toEqual(second.products.map(p => String(p._id)))
  expect(new Set([...first.products, ...second.products].map(p => String(p._id))).size).toBe(4)
})

test('filters apply quantity/MOQ, price tiers, text, city, category, currency and supplier before result counts', async () => {
  const discounted = await published({ name: 'قميص أحمر', price: 100, moq: 5, priceTiers: [{ minQty: 10, price: 50 }] })
  const plain = await published({ name: 'قميص آخر', price: 80 })
  const onRequest = await published({ pricingMode: 'on_request', price: undefined })
  for (const product of [discounted, plain, onRequest]) await indexProduct(product._id)
  const result = await searchImage(redImage, { filters: { q: 'أحمر', city: 'الرباط', category: 'اختبار', currency: 'MAD', supplier: String(supplier._id), quantity: 12, minPrice: 40, maxPrice: 60 } })
  expect(result.total).toBe(1)
  expect(String(result.products[0]._id)).toBe(String(discounted._id))
  expect(result.products[0].effectiveUnitPrice).toBe(50)
  expect((await searchImage(redImage, { filters: { quantity: 2, minPrice: 90 } })).total).toBe(0)
  expect((await searchImage(redImage, { filters: { currency: 'EUR' } })).total).toBe(0)
  expect((await searchImage(redImage, { filters: { supplier: 'اسم غير موجود' } })).total).toBe(0)
  const descending = await searchImage(redImage, { filters: { order: 'price_desc', quantity: 12 } })
  expect(descending.products.map(p => String(p._id))).toEqual([String(plain._id), String(discounted._id), String(onRequest._id)])
})

test('indexing is idempotent and invalidation removes old vectors when an image becomes unavailable', async () => {
  const product = await published()
  await Promise.all([indexProduct(product._id), indexProduct(product._id)])
  expect(await VisualEmbedding.countDocuments()).toBe(1)
  await Product.updateOne({ _id: product._id }, { $set: { imageUrl: 'https://example.com/new.png' } })
  expect(await indexProduct(product._id)).toMatchObject({ status: 'unindexed' })
  expect(await VisualEmbedding.findOne({ productId: product._id }).select('+vector').lean()).not.toHaveProperty('vector')
  await Product.deleteOne({ _id: product._id })
  expect(await indexProduct(product._id)).toMatchObject({ reason: 'product_not_found' })
  expect(await VisualEmbedding.countDocuments()).toBe(0)
})

test('awaits job permission/cancellation hook before every index write, invalidation, and deletion', async () => {
  const product = await published()
  const rejectWrite = jest.fn(async () => { throw Object.assign(new Error('job permission revoked'), { code: 'JOB_REJECTED' }) })
  await expect(indexProduct(product._id, { beforeWrite: rejectWrite })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
  expect(await VisualEmbedding.countDocuments()).toBe(0)
  let allowed = false
  const allowWrite = jest.fn(async () => { await Promise.resolve(); allowed = true })
  await indexProduct(product._id, { beforeWrite: allowWrite })
  expect(allowed).toBe(true)
  expect(allowWrite).toHaveBeenCalledTimes(1)
  await Product.updateOne({ _id: product._id }, { $set: { imageUrl: 'https://example.com/new.png' } })
  await expect(indexProduct(product._id, { beforeWrite: rejectWrite })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
  expect((await VisualEmbedding.findOne({ productId: product._id }).lean()).status).toBe('indexed')
  await Product.deleteOne({ _id: product._id })
  await expect(indexProduct(product._id, { beforeWrite: rejectWrite })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
  expect(await VisualEmbedding.countDocuments()).toBe(1)
  expect(rejectWrite).toHaveBeenCalledTimes(3)
})

test('capacity and malformed filters fail clearly instead of silently truncating or accepting injected filters', async () => {
  await published()
  await published()
  process.env.VISUAL_SEARCH_MAX_CANDIDATES = '1'
  await expect(searchImage(redImage)).rejects.toMatchObject({ status: 503, code: 'VISUAL_INDEX_CAPACITY' })
  await expect(searchImage(redImage, { filters: { city: { $ne: '' } } })).rejects.toMatchObject({ status: 400 })
})

test('operator benchmark is database-independent synthetic evidence and CLI mutations require --apply', async () => {
  const results = await benchmark()
  expect(results.scope).toBe('synthetic_local_only_not_field_accuracy')
  expect(results.top1Correct).toBe(results.total)
  expect(results.rows.every(row => !row.byteIdentical)).toBe(true)
  expect(parseArguments([])).toMatchObject({ apply: false, limit: 500 })
  expect(parseArguments(['--apply', '--public-only', '--limit', '10'])).toMatchObject({ apply: true, publicOnly: true, limit: 10 })
  expect(() => parseArguments(['--limit', '999999'])).toThrow()
  expect(() => parseArguments(['--product', 'invalid'])).toThrow()
})
