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

module.exports = { ownedAsset, assertProductImagesOwned, mayReadAsset, readAssetBytes }
