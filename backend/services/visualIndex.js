const { effectivePrice } = require('../utils/productPricing')
const { createHash } = require('crypto')
const mongoose = require('mongoose')
const sharp = require('sharp')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const VisualEmbedding = require('../models/VisualEmbedding')
const { uploadsDirectory, localImagePath } = require('./mediaStorage')
const { ownedAsset, readAssetBytes } = require('./mediaPrivacy')
const { PUBLIC_FIELDS, publicCatalogFilter, parseOptions, searchWords, badRequest, categoryPredicate } = require('../utils/catalog')
const { declaredBusinessTypes } = require('../utils/businessTypes')
const { escapeRegex } = require('../utils/constants')

const VERSION = 'local-color-spatial-edge-v1'
const ADAPTER = 'local_feature_vectors'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const MAX_DIMENSION = 12000
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])
const SIZE = 32
const VECTOR_LENGTH = 64 + 4 * 4 * 3 + 4 * 4 * 8
const digest = value => createHash('sha256').update(value).digest('hex')
const imageError = message => Object.assign(new Error(message), { status: 415 })
const capacityError = () => Object.assign(new Error('الفهرس البصري المحلي تجاوز سعته المحددة؛ يلزم تقسيم الفهرس أو استخدام مخزن متجهات قبل توسيع الكتالوج'), { status: 503, code: 'VISUAL_INDEX_CAPACITY' })

async function readLocalImage(imageUrl, ownerSupplierId) {
  if (!localImagePathForCheck(imageUrl)) return { reason: 'remote_or_unsupported_source' }
  const asset = await ownedAsset(imageUrl, ownerSupplierId)
  if (!asset) return { reason: 'unmanaged_or_foreign_asset' }
  const buffer = await readAssetBytes(asset)
  return buffer ? { buffer } : { reason: 'image_unavailable' }
}

function localImagePathForCheck(imageUrl) {
  try { return localImagePath(imageUrl) } catch { return null }
}

function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  return magnitude ? values.map(value => value / magnitude) : values.map(() => 0)
}

async function describeImage(buffer, { requireDetail = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > MAX_BYTES) throw imageError('صورة البحث غير صالحة أو تجاوزت 10 ميغابايت')
  let metadata, data
  try {
    const options = { limitInputPixels: MAX_PIXELS, failOn: 'warning', sequentialRead: true, pages: 1 }
    metadata = await sharp(buffer, options).metadata()
    if (!FORMATS.has(metadata.format) || !metadata.width || !metadata.height || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) throw new Error('Unsupported dimensions or format')
    // Decode pixels; headers/file names/MIME guesses never form a descriptor.
    data = await sharp(buffer, options).rotate().flatten({ background: '#ffffff' })
      .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' }).toColourspace('srgb').removeAlpha().raw().toBuffer()
    if (data.length !== SIZE * SIZE * 3) throw new Error('Unexpected pixel layout')
  } catch { throw imageError('تعذر فك صورة JPEG/PNG/WebP/GIF آمنة وصالحة') }

  // V4.9 input quality gate: use the already decoded pixels, not a second
  // descriptor or filename heuristic. Scale to the reference 0..255 units.
  // This is only a conservative detail check, not object recognition.
  if (requireDetail) {
    let sum=0, sq=0, edge=0
    const n=SIZE*SIZE, grayAt=i=>(data[i*3]+data[i*3+1]+data[i*3+2])/3
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      const i=y*SIZE+x,v=grayAt(i)
      sum+=v;sq+=v*v
      if(x>0)edge+=Math.abs(v-grayAt(i-1))
      if(y>0)edge+=Math.abs(v-grayAt(i-SIZE))
    }
    const spread=Math.sqrt(Math.max(0,sq/n-(sum/n)**2))
    if(spread<7||edge/(2*n)<1.5)throw Object.assign(
      new Error('الصورة فارغة أو تفاصيلها غير كافية. جرّب صورة واضحة للمنتج.'),
      {status:422,code:'VISUAL_INSUFFICIENT_DETAIL'}
    )
  }

  const histogram = new Array(64).fill(0)
  const spatial = new Array(4 * 4 * 3).fill(0)
  const edges = new Array(4 * 4 * 8).fill(0)
  const gray = new Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const p = (y * SIZE + x) * 3
    const r = data[p], g = data[p + 1], b = data[p + 2]
    histogram[(r >> 6) * 16 + (g >> 6) * 4 + (b >> 6)]++
    const cell = Math.floor(y / 8) * 4 + Math.floor(x / 8)
    spatial[cell * 3] += r / (255 * 64)
    spatial[cell * 3 + 1] += g / (255 * 64)
    spatial[cell * 3 + 2] += b / (255 * 64)
    gray[y * SIZE + x] = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  }
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
    const gx = gray[y * SIZE + x + 1] - gray[y * SIZE + x - 1]
    const gy = gray[(y + 1) * SIZE + x] - gray[(y - 1) * SIZE + x]
    const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI
    const bin = Math.min(7, Math.floor(angle / Math.PI * 8))
    const cell = Math.floor(y / 8) * 4 + Math.floor(x / 8)
    edges[cell * 8 + bin] += Math.hypot(gx, gy)
  }
  const vector = normalize([
    ...normalize(histogram.map(count => Math.sqrt(count / (SIZE * SIZE)))).map(value => value * Math.sqrt(0.45)),
    ...normalize(spatial).map(value => value * Math.sqrt(0.35)),
    ...normalize(edges).map(value => value * Math.sqrt(0.20))
  ]).map(value => Number(value.toFixed(8)))
  // dHash is diagnostic only; equality does not prove file/product identity.
  let hash = 0n
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const left = gray[(y * 4 + 2) * SIZE + x * 4]
    const right = gray[(y * 4 + 2) * SIZE + Math.min(SIZE - 1, x * 4 + 4)]
    hash = (hash << 1n) | (left > right ? 1n : 0n)
  }
  return { version: VERSION, sha256: digest(buffer), perceptualHash: hash.toString(16).padStart(16, '0'), vector, format: metadata.format, width: metadata.width, height: metadata.height }
}

function compareDescriptors(left, right) {
  if (!Array.isArray(left?.vector) || !Array.isArray(right?.vector) || left.vector.length !== VECTOR_LENGTH || right.vector.length !== VECTOR_LENGTH || left.version !== VERSION || right.version !== VERSION || left.vector.some(v => !Number.isFinite(v)) || right.vector.some(v => !Number.isFinite(v))) return 0
  const score = left.vector.reduce((sum, value, index) => sum + value * right.vector[index], 0)
  return Math.max(0, Math.min(1, score))
}

async function saveUnindexed(product, reason, actorId, beforeWrite) {
  const value = { productId: product._id, imageUrl: product.imageUrl || '', sourceFingerprint: digest(product.imageUrl || ''), version: VERSION, status: 'unindexed', reason, indexedAt: new Date() }
  if (mongoose.isValidObjectId(actorId)) value.indexedBy = actorId
  await upsertIndex(product._id, { $set: value, $unset: { vector: 1, sha256: 1, perceptualHash: 1, format: 1, width: 1, height: 1 } }, beforeWrite)
  return { productId: String(product._id), status: 'unindexed', reason, version: VERSION }
}

async function upsertIndex(productId, update, beforeWrite) {
  if (beforeWrite) await beforeWrite()
  try { await VisualEmbedding.updateOne({ productId }, update, { upsert: true }) }
  catch (error) {
    // Two queue deliveries may race at the unique product index. Both are safe to retry.
    if (error.code !== 11000) throw error
    if (beforeWrite) await beforeWrite()
    await VisualEmbedding.updateOne({ productId }, update)
  }
}

async function indexProduct(productId, { actorId, beforeWrite } = {}) {
  if (!mongoose.isValidObjectId(productId)) throw badRequest('معرف المنتج غير صالح')
  const product = await Product.findById(productId).select('_id imageUrl supplierId').lean()
  if (!product) {
    if (beforeWrite) await beforeWrite()
    await VisualEmbedding.deleteOne({ productId })
    return { productId: String(productId), status: 'unindexed', reason: 'product_not_found', version: VERSION }
  }
  const { buffer, reason } = await readLocalImage(product.imageUrl, product.supplierId)
  if (!buffer) return saveUnindexed(product, reason, actorId, beforeWrite)
  let descriptor
  try { descriptor = await describeImage(buffer) }
  catch (error) {
    if (error.status === 415) return saveUnindexed(product, 'invalid_image', actorId, beforeWrite)
    throw error
  }
  // Concurrent jobs cannot make an old URL searchable for a newly updated product.
  const stillCurrent = await Product.exists({ _id: product._id, imageUrl: product.imageUrl, supplierId: product.supplierId })
  if (!stillCurrent) return { productId: String(productId), status: 'stale', reason: 'image_changed', version: VERSION }
  const value = { productId: product._id, imageUrl: product.imageUrl, sourceFingerprint: digest(product.imageUrl), status: 'indexed', ...descriptor, indexedAt: new Date() }
  if (mongoose.isValidObjectId(actorId)) value.indexedBy = actorId
  await upsertIndex(product._id, { $set: value, $unset: { reason: 1 } }, beforeWrite)
  return { productId: String(productId), status: 'indexed', version: VERSION }
}

function integerSetting(name, fallback, max) {
  const number = Number(process.env[name])
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, max) : fallback
}

function minScore() {
  const score = Number(process.env.VISUAL_SEARCH_MIN_SCORE)
  return Number.isFinite(score) && score >= 0.5 && score <= 1 ? score : 0.82
}

const { applyTaxonomyFilter } = require('../utils/taxonomy')

async function candidateFilter(options) {
  const filter = await publicCatalogFilter({ businessType: options.businessType, supplierTrust: options.supplierTrust })
  if (options.q) {
    const words = searchWords(options.q).map(word => new RegExp(escapeRegex(word), 'i'))
    filter.$or = [{ name: { $in: words } }, { category: { $in: words } }, { description: { $in: words } }]
  }
  if (options.city) filter.city = new RegExp(escapeRegex(options.city), 'i')
  if (options.category) filter.category = categoryPredicate(options)
  if (options.currency) filter.currency = options.currency
  if (options.quantity) filter.moq = { $lte: options.quantity }
  if (options.supplier) {
    if (mongoose.isValidObjectId(options.supplier)) filter.$and = [{ supplierId: new mongoose.Types.ObjectId(options.supplier) }]
    else {
      const ids = await Supplier.find({ name: new RegExp(escapeRegex(options.supplier), 'i') }).select('_id').lean()
      filter.$and = [{ supplierId: { $in: ids.map(s => s._id) } }]
    }
  }
  applyTaxonomyFilter(filter, options.taxonomyPath)
  return filter
}


async function searchImage(buffer, { filters = {}, pagination = {}, requireDetail = false } = {}) {
  const query = await describeImage(buffer, { requireDetail })
  const options = parseOptions({ ...filters, ...pagination })
  const filter = await candidateFilter(options)
  const maxCandidates = integerSetting('VISUAL_SEARCH_MAX_CANDIDATES', 5000, 20000)
  const candidates = await Product.find(filter).select(PUBLIC_FIELDS).sort({ _id: 1 }).limit(maxCandidates + 1).lean()
  if (candidates.length > maxCandidates) throw capacityError()
  const indexed = await VisualEmbedding.find({ productId: { $in: candidates.map(p => p._id) }, status: 'indexed', version: VERSION }).select('+vector').lean()
  const indexMap = new Map(indexed.map(item => [String(item.productId), item]))
  const threshold = minScore()
  const matches = []
  let unindexedCount = 0, staleCount = 0
  for (const product of candidates) {
    product.effectiveUnitPrice = effectivePrice(product, options.quantity)
    if ((options.minPrice != null || options.maxPrice != null) && (product.pricingMode !== 'fixed' || product.effectiveUnitPrice == null || options.minPrice != null && product.effectiveUnitPrice < options.minPrice || options.maxPrice != null && product.effectiveUnitPrice > options.maxPrice)) continue
    const item = indexMap.get(String(product._id))
    if (!item) { unindexedCount++; continue }
    if (item.imageUrl !== product.imageUrl || item.sourceFingerprint !== digest(product.imageUrl || '')) { staleCount++; continue }
    const exact = item.sha256 === query.sha256
    const score = exact ? 1 : compareDescriptors(query, item)
    if (score < threshold) continue
    // Recheck bytes even for an unchanged URL; a replaced/missing file cannot leak a stale match.
    const current = await readLocalImage(product.imageUrl, product.supplierId)
    if (!current.buffer || digest(current.buffer) !== item.sha256) { staleCount++; continue }
    matches.push({ ...product, matchType: exact ? 'exact' : 'similar', matchBasis: exact ? 'exact_image' : 'similar_image', similarityScore: Number(score.toFixed(6)) })
  }
  const compare = (a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1
    if (options.order === 'price_asc' || options.order === 'price_desc') {
      const aMissing = a.pricingMode === 'on_request' || a.effectiveUnitPrice == null
      const bMissing = b.pricingMode === 'on_request' || b.effectiveUnitPrice == null
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      const diff = (a.effectiveUnitPrice ?? 0) - (b.effectiveUnitPrice ?? 0)
      if (diff) return options.order === 'price_desc' ? -diff : diff
    }
    if (options.order === 'newest') {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (diff) return diff
    }
    return b.similarityScore - a.similarityScore || String(a._id).localeCompare(String(b._id))
  }
  matches.sort(compare)
  const total = matches.length
  const exactCount = matches.filter(p => p.matchType === 'exact').length
  let products = matches.slice(options.skip, options.skip + options.limit)
  // Populate only the same explicitly public supplier fields as text search.
  products = await Product.populate(products, { path: 'supplierId', select: 'name city phone isVerified verificationStatus businessTypes', options: { lean: true } })
  products = products.map(product => ({ ...product, supplierId: product.supplierId ? { ...product.supplierId, businessTypes: declaredBusinessTypes(product.supplierId.businessTypes) } : null }))
  return {
    products, total, exactCount, similarCount: total - exactCount, page: options.page, limit: options.limit,
    pagination: { page: options.page, limit: options.limit, total, pages: Math.ceil(total / options.limit), hasNextPage: options.page * options.limit < total, hasPrevPage: options.page > 1 },
    visualSearch: { adapter: ADAPTER, version: VERSION, minScore: threshold, scoreMeaning: 'feature_vector_cosine_similarity_not_probability', exactMeaning: 'same_image_bytes_not_verified_product_identity', indexedCandidates: indexed.length, unindexedCount, staleCount, animatedImages: 'first_frame_only' }
  }
}

module.exports = { VERSION, ADAPTER, MAX_BYTES, MAX_PIXELS, VECTOR_LENGTH, describeImage, compareDescriptors, indexProduct, searchImage, uploadsDirectory, localImagePath }
