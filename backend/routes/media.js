const router = require('express').Router()
const MediaAsset = require('../models/MediaAsset')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { mayReadAsset, readAssetBytes } = require('../services/mediaPrivacy')

function noStore(_req, res, next) {
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff' })
  res.vary('Authorization')
  next()
}

// Missing credentials permit the public-catalog check only. Supplied credentials
// must still be valid; a revoked/expired JWT never becomes private access.
router.use(noStore, (req, res, next) => req.headers.authorization !== undefined ? authenticate(req, res, next) : next())
router.get('/:filename', asyncHandler(async (req, res) => {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/.test(req.params.filename)) return res.status(404).json({ message: 'الصورة غير متاحة' })
  const asset = await MediaAsset.findOne({ filename: req.params.filename }).lean()
  if (!asset || !await mayReadAsset(asset, req.supplier)) return res.status(req.supplier ? 404 : 401).json({ message: 'الصورة غير متاحة' })
  const bytes = await readAssetBytes(asset)
  if (!bytes) return res.status(404).json({ message: 'الصورة غير متاحة' })
  res.status(200).set({ 'Content-Type': asset.mimetype, 'Content-Length': String(bytes.length), 'Accept-Ranges': 'none' })
  // res.send()/sendFile() can reuse a conditional 304 or generate validators.
  // Every media response instead performs current authorization and returns the
  // full bytes (or an authorized HEAD) without ETag/Last-Modified validators.
  res.end(req.method === 'HEAD' ? undefined : bytes)
}))

module.exports = router
module.exports.noStore = noStore
