// Explicit operator command; no production data is touched by --benchmark or --help.
if (require.main === module) require('dotenv').config({ quiet: true })
const mongoose = require('mongoose')
const sharp = require('sharp')
const Product = require('../models/Product')
const VisualEmbedding = require('../models/VisualEmbedding')
const { VERSION, describeImage, compareDescriptors, indexProduct } = require('../services/visualIndex')
const { publicCatalogFilter } = require('../utils/catalog')

async function benchmark() {
  // Controlled fixtures measure this descriptor, not real product/market accuracy.
  const colours = [[220, 20, 20], [20, 190, 30], [20, 40, 225], [225, 140, 10], [150, 20, 190], [10, 160, 180]]
  const images = []
  for (let index = 0; index < colours.length; index++) {
    const pixels = Buffer.alloc(64 * 64 * 3, 255)
    for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) {
      const draw = index % 2 ? (x - 32) ** 2 + (y - 32) ** 2 < 24 ** 2 : x > 15 && x < 49
      if (draw) colours[index].forEach((value, channel) => { pixels[(y * 64 + x) * 3 + channel] = value })
    }
    images.push(await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer())
  }
  const descriptors = await Promise.all(images.map(describeImage))
  const rows = []
  for (let index = 0; index < images.length; index++) {
    const resized = await sharp(images[index]).resize(128, 128).jpeg({ quality: 90 }).toBuffer()
    const query = await describeImage(resized)
    const ranking = descriptors.map((descriptor, candidate) => ({ candidate, score: compareDescriptors(query, descriptor) })).sort((a, b) => b.score - a.score)
    rows.push({ fixture: index + 1, top1: ranking[0].candidate + 1, expectedScore: Number(ranking.find(item => item.candidate === index).score.toFixed(6)), top1Correct: ranking[0].candidate === index, byteIdentical: query.sha256 === descriptors[index].sha256 })
  }
  return { scope: 'synthetic_local_only_not_field_accuracy', version: VERSION, fixtures: images.length, queryTransform: '2x_resize_jpeg_quality90', top1Correct: rows.filter(row => row.top1Correct).length, total: rows.length, rows }
}

function parseArguments(args) {
  const options = { apply: false, limit: 500, publicOnly: false }
  const flags = new Set(['--help', '--benchmark', '--apply', '--public-only'])
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flags.has(flag)) {
      if (flag === '--help') options.help = true
      if (flag === '--benchmark') options.benchmark = true
      if (flag === '--apply') options.apply = true
      if (flag === '--public-only') options.publicOnly = true
    } else if (['--product', '--after', '--limit', '--actor'].includes(flag)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag)
      if (flag === '--limit') {
        options.limit = Number(value)
        if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 5000) throw new Error('--limit must be 1–5000')
      } else {
        if (!mongoose.isValidObjectId(value)) throw new Error(flag + ' must be a valid ObjectId')
        options[flag.slice(2)] = value
      }
    } else throw new Error('Unknown argument: ' + flag)
  }
  return options
}

async function runIndex(options) {
  const filter = options.publicOnly ? await publicCatalogFilter() : {}
  if (options.product) filter._id = new mongoose.Types.ObjectId(options.product)
  else if (options.after) filter._id = { $gt: new mongoose.Types.ObjectId(options.after) }
  const products = await Product.find(filter).select('_id imageUrl').sort({ _id: 1 }).limit(options.limit + 1).lean()
  const batch = products.slice(0, options.limit)
  const summary = { mode: options.apply ? 'apply' : 'dry_run', version: VERSION, processed: batch.length, indexed: 0, unindexed: 0, stale: 0, hasMore: products.length > options.limit, nextAfter: products.length > options.limit ? String(batch.at(-1)._id) : null }
  if (options.apply) {
    for (const product of batch) {
      const result = await indexProduct(product._id, { actorId: options.actor })
      summary[result.status]++
    }
  } else {
    summary.existingIndexed = await VisualEmbedding.countDocuments({ productId: { $in: batch.map(p => p._id) }, status: 'indexed', version: VERSION })
  }
  return summary
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write('Usage: node scripts/index-visuals.js [--apply] [--public-only] [--limit 500] [--after ObjectId] [--product ObjectId] [--actor ObjectId]\n       node scripts/index-visuals.js --benchmark\nWithout --apply, reads metadata only. Remote images are never fetched.\n')
    return
  }
  if (options.benchmark) {
    process.stdout.write(JSON.stringify(await benchmark(), null, 2) + '\n')
    return
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for catalog indexing; --benchmark needs no database.')
  await mongoose.connect(process.env.MONGODB_URI)
  try { process.stdout.write(JSON.stringify(await runIndex(options), null, 2) + '\n') }
  finally { await mongoose.disconnect() }
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
module.exports = { benchmark, parseArguments, runIndex }
