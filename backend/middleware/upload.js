const multer = require('multer')
const fs = require('fs')
const path = require('path')
const { randomUUID, createHash } = require('crypto')
const { inflateSync } = require('zlib')
const sharp = require('sharp')
const { uploadsDirectory, localImagePath } = require('../services/mediaStorage')
const MediaAsset = require('../models/MediaAsset')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const imageError = message => Object.assign(new Error(message), { status: 415 })
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let crc = i
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function validPng(buffer) {
  try {
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20)
    if (!width || !height || width * height > 25000000 || width > 12000 || height > 12000) return false
    const depth = buffer[24], color = buffer[25], interlaced = buffer[28]
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color]
    const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16]
    if (!channels || !depths.includes(depth) || buffer[26] !== 0 || buffer[27] !== 0 || interlaced > 1) return false
    let offset = 8, ended = false
    const compressed = []
    while (offset + 12 <= buffer.length) {
      const size = buffer.readUInt32BE(offset)
      if (offset + size + 12 > buffer.length) return false
      const type = buffer.toString('ascii', offset + 4, offset + 8)
      if (crc32(buffer.subarray(offset + 4, offset + 8 + size)) !== buffer.readUInt32BE(offset + 8 + size)) return false
      if (offset === 8 && (type !== 'IHDR' || size !== 13)) return false
      if (type === 'IDAT') compressed.push(buffer.subarray(offset + 8, offset + 8 + size))
      offset += size + 12
      if (type === 'IEND') { ended = size === 0 && offset === buffer.length; break }
    }
    if (!ended || !compressed.length) return false
    const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: 128 * 1024 * 1024 })
    const passes = interlaced ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]]
    let rowOffset = 0
    for (const [x, y, dx, dy] of passes) {
      const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy))
      if (!w || !h) continue
      const rowBytes = Math.ceil(w * channels * depth / 8) + 1
      for (let row = 0; row < h; row++) {
        if (rowOffset >= raw.length || raw[rowOffset] > 4) return false
        rowOffset += rowBytes
      }
    }
    return rowOffset === raw.length
  } catch { return false }
}

// Validate file signatures and dimensions independently of the client supplied MIME.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) return null
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.length >= 45 &&
      buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND') {
    return validPng(buffer) ? 'image/png' : null
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff &&
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9 && buffer.includes(Buffer.from([0xff, 0xda]))) {
    let offset = 2
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 0xff) break
      const marker = buffer[offset + 1]
      if (marker === 0xda || marker === 0xd9) break
      const length = buffer.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > buffer.length) return null
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        const h = buffer.readUInt16BE(offset + 5), w = buffer.readUInt16BE(offset + 7)
        return w > 0 && h > 0 && w <= 12000 && h <= 12000 ? 'image/jpeg' : null
      }
      offset += length + 2
    }
  }
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6)) && buffer[buffer.length - 1] === 0x3b) {
    const w = buffer.readUInt16LE(6), h = buffer.readUInt16LE(8)
    return w > 0 && h > 0 && w <= 12000 && h <= 12000 ? 'image/gif' : null
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' &&
      buffer.readUInt32LE(4) + 8 === buffer.length && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) return 'image/webp'
  return null
}

function validateImage(file) {
  const actualType = detectImageType(file.buffer)
  if (!actualType || actualType !== file.mimetype) throw imageError('الصورة غير صالحة أو نوع الملف لا يطابق محتواه')
  file.mimetype = actualType
  return file
}

async function decodeImage(file) {
  validateImage(file)
  try {
    const image = sharp(file.buffer, { failOn: 'warning', limitInputPixels: 25000000, pages: 1 })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000 || (metadata.pages || 1) > 1) throw new Error('Image dimensions or animation not supported')
    // Force a complete decode; a valid header alone does not establish validity.
    await image.raw().toBuffer()
    return file
  } catch { throw imageError('تعذر فك الصورة بالكامل. استخدم صورة ثابتة سليمة لا تتجاوز 25 مليون بكسل.') }
}

async function saveImage(file, identity) {
  if (!identity || !['supplier', 'staff', 'admin'].includes(identity.role) ||
      !/^[a-f0-9]{24}$/i.test(String(identity.id || '')) ||
      !/^[a-f0-9]{24}$/i.test(String(identity.ownerId || identity.id)) ||
      (identity.role === 'staff' && (!identity.organizationId || !identity.permissions?.includes('manage_products')))) {
    throw Object.assign(new Error('رفع الصورة يحتاج هوية مالك مصادقاً عليها'), { status: 403 })
  }
  await decodeImage(file)
  const uploadDir = uploadsDirectory()
  fs.mkdirSync(uploadDir, { recursive: true })
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[file.mimetype]
  const filename = `product-${randomUUID()}${ext}`
  const imageUrl = `/uploads/${filename}`
  const target = localImagePath(imageUrl)
  fs.writeFileSync(target, file.buffer, { flag: 'wx', mode: 0o600 })
  try {
    await MediaAsset.create({ filename, imageUrl, ownerSupplierId: identity.ownerId || identity.id,
      organizationId: identity.organizationId || null, uploadedBy: identity.id,
      mimetype: file.mimetype, size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') })
  } catch (error) {
    // An unregistered file must never be returned to the caller or adopted later.
    try { fs.unlinkSync(target) } catch { /* still inaccessible without a registry entry */ }
    throw error
  }
  return imageUrl
}

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 6, fields: 20, fieldSize: 16000 },
  fileFilter: (req, file, cb) => allowedTypes.has(file.mimetype) ? cb(null, true) : cb(imageError('نوع الصورة غير مدعوم'))
})
function makeUpload(persist) {
  const wrap = parse => (req, res, next) => parse(req, res, async err => {
    if (err) { err.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 400); return next(err) }
    try {
      const files = req.file ? [req.file] : (req.files || [])
      for (const file of files) { await decodeImage(file); if (persist) file.filename = path.basename(await saveImage(file, req.supplier)) }
      next()
    } catch (error) { next(error) }
  })
  return { single: name => wrap(parser.single(name)), array: (name, count) => wrap(parser.array(name, count)) }
}
module.exports = makeUpload(true)
module.exports.memoryUpload = makeUpload(false)
module.exports.saveImage = saveImage
module.exports.detectImageType = detectImageType
module.exports.decodeImage = decodeImage
module.exports.MAX_IMAGE_BYTES = MAX_IMAGE_BYTES
