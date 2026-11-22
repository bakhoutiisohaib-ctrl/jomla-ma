const fs = require('fs/promises')
const { constants } = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const MediaAsset = require('../models/MediaAsset')
const Product = require('../models/Product')
const Store = require('../models/Store')
const { localImagePath, uploadsDirectory } = require('./mediaStorage')
const { publicCatalogFilter, imageUrlAllowed, badRequest } = require('../utils/catalog')

const sameId = (left, right) => left != null && right != null && String(left) === String(right)

async function ownedAsset(imageUrl, ownerSupplierId) {
  if (!imageUrlAllowed(imageUrl) || !/^[a-f0-9]{24}$/i.test(String(ownerSupplierId || ''))) return null
  return MediaAsset.findOne({ imageUrl, ownerSupplierId }).lean()
}

async function assertProductImagesOwned(product) {
  const references = [...new Set([product.imageUrl, ...(product.images || [])].filter(value => value !== undefined && value !== ''))]
  for (const imageUrl of references) {
    if (!imageUrlAllowed(imageUrl)) throw badRequest('الخصوصية الصارمة تقبل صوراً مرفوعة ومدارة محلياً فقط')
    const asset = await ownedAsset(imageUrl, product.supplierId)
    if (!asset || !await readAssetBytes(asset)) throw badRequest('الصورة غير موجودة أو لا تملك أصلها المرفوع')
  }
}

async function mayReadAsset(asset, account) {
  // An account, when present, has passed live authentication. Anonymous readers
  // get only the catalog branch; they never inherit a private role/ownership.
  if (account?.role === 'admin') return true
  if (account?.role === 'supplier' && sameId(account.id, asset.ownerSupplierId)) return true
  if (account?.role === 'staff' && account.permissions.includes('manage_products') &&
      sameId(account.ownerId, asset.ownerSupplierId) && sameId(account.organizationId, asset.organizationId)) return true
  // Scope stores to the asset's owner as well as the product. Even an invalid
  // legacy product pointing to another supplier's approved store cannot expose it.
  const catalog = await publicCatalogFilter({ supplierId: asset.ownerSupplierId })
  if (await Product.exists({ $and: [catalog, { supplierId: asset.ownerSupplierId },
    { $or: [{ imageUrl: asset.imageUrl }, { images: asset.imageUrl }] }] })) return true
  // C2 adds only an explicitly linked, managed logo of an eligible same-owner
  // store. Pending/suspended stores, banners and unattached assets stay private.
  return !!await Store.exists({ _id: catalog.storeId, supplierId: asset.ownerSupplierId, logoUrl: asset.imageUrl })
}

// Read through an opened descriptor into a bounded buffer, then verify immutable
// metadata. sendFile/static and path-dependent reopens are deliberately avoided.
async function readAssetBytes(asset) {
  let handle
  try {
    const filename = localImagePath(asset.imageUrl)
    if (!filename || path.basename(filename) !== asset.filename) return null
    const [realRoot, realFile] = await Promise.all([fs.realpath(uploadsDirectory()), fs.realpath(filename)])
    if (path.dirname(realFile) !== realRoot) return null
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== asset.size || stat.size < 20 || stat.size > 10 * 1024 * 1024) return null
    const buffer = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) return null
      offset += bytesRead
    }
    const after = await handle.stat()
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs ||
        createHash('sha256').update(buffer).digest('hex') !== asset.sha256) return null
    return buffer
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code) ||
        /symbolic link|Invalid image storage entry/.test(error.message)) return null
    throw error
  } finally { if (handle) await handle.close() }
}

// Snapshot verified bytes to a private temporary file before HTTP headers.
// Streaming the original path after hashing would reopen a mutation race.
async function verifiedAssetStream(asset) {
  let original, snapshot, directory
  const cleanup = async () => {
    if (snapshot) { await snapshot.close().catch(() => {}); snapshot = null }
    if (directory) {
      await fs.unlink(path.join(directory, 'verified')).catch(() => {})
      await fs.rmdir(directory).catch(() => {})
    }
  }
  try {
    const filename = localImagePath(asset.imageUrl)
    if (!filename || path.basename(filename) !== asset.filename) return null
    const [realRoot, realFile] = await Promise.all([fs.realpath(uploadsDirectory()), fs.realpath(filename)])
    if (path.dirname(realFile) !== realRoot) return null
    original = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const before = await original.stat()
    if (!before.isFile() || before.size !== asset.size || before.size < 20 || before.size > 10 * 1024 * 1024) return null
    directory = await fs.mkdtemp(path.join(require('os').tmpdir(), 'jomla-verified-media-'))
    snapshot = await fs.open(path.join(directory, 'verified'), 'wx+', 0o600)
    const chunk = Buffer.alloc(64 * 1024), hash = createHash('sha256')
    let offset = 0
    while (offset < before.size) {
      const { bytesRead } = await original.read(chunk, 0, Math.min(chunk.length, before.size - offset), offset)
      if (!bytesRead) { await cleanup(); return null }
      hash.update(chunk.subarray(0, bytesRead))
      let written = 0
      while (written < bytesRead) {
        const result = await snapshot.write(chunk, written, bytesRead - written, offset + written)
        if (!result.bytesWritten) throw new Error('Incomplete media snapshot')
        written += result.bytesWritten
      }
      offset += bytesRead
    }
    const after = await original.stat()
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || hash.digest('hex') !== asset.sha256) { await cleanup(); return null }
    const stream = snapshot.createReadStream({ start: 0, autoClose: false })
    stream.once('close', () => { cleanup().catch(() => {}) })
    return { stream, size: before.size, close: async () => { stream.destroy(); await cleanup() } }
  } catch (error) {
    await cleanup()
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code) || /symbolic link|Invalid image storage entry/.test(error.message)) return null
    throw error
  } finally { if (original) await original.close() }
}

module.exports = { ownedAsset, assertProductImagesOwned, mayReadAsset, readAssetBytes, verifiedAssetStream }
