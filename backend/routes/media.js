const router = require('express').Router()
const MediaAsset = require('../models/MediaAsset')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { mayReadAsset, verifiedAssetStream } = require('../services/mediaPrivacy')

function noStore(_req, res, next) {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff' })
  res.vary('Authorization')
  next()
}

// Missing credentials permit the public-catalog check only. Supplied credentials
// must still be valid; a revoked/expired JWT never becomes private access.
router.use(noStore, (req, res, next) => req.headers.authorization !== undefined ? authenticate(req, res, next) : next())
router.get('/:filename', asyncHandler(async (req, res) => {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(req.params.filename)) return res.status(404).json({ message: 'الصورة غير متاحة' })
  const asset = await MediaAsset.findOne({ filename: req.params.filename }).lean()
  if (!asset || !await mayReadAsset(asset, req.supplier)) return res.status(req.supplier ? 404 : 401).json({ message: 'الصورة غير متاحة' })
  const verified = await verifiedAssetStream(asset)
  if (!verified) return res.status(404).json({ message: 'الصورة غير متاحة' })
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(asset.mimetype)) {
    await verified.close(); return res.status(404).json({ message: 'الصورة غير متاحة' })
  }
  // Opt-in revalidation: keep the established no-store policy by default.
  if (process.env.MEDIA_REVALIDATION === '1') {
    const etag = '"' + asset.sha256 + '"'
    res.set({ 'Cache-Control': 'private, no-cache', ETag: etag })
    const matches = (req.get('If-None-Match') || '').split(',').map(x => x.trim().replace(/^W\//, ''))
    if (matches.includes(etag) || matches.includes('*')) { await verified.close(); return res.status(304).end() }
  }
  res.status(200).set({ 'Content-Type': asset.mimetype, 'Content-Length': String(verified.size), 'Accept-Ranges': 'none' })
  if (req.method === 'HEAD') { await verified.close(); return res.end() }
  await require('stream/promises').pipeline(verified.stream, res).finally(verified.close)

}))

module.exports = router
module.exports.noStore = noStore
