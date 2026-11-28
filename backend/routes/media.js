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
  const disconnected = () => req.aborted || res.destroyed || res.writableEnded
  if (disconnected()) return
  const verified = await verifiedAssetStream(asset)
  if (!verified) {
    if (disconnected()) return
    return res.status(404).json({ message: 'الصورة غير متاحة' })
  }
  try {
    // Verification may finish after the browser abandoned the image.
    if (disconnected()) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(asset.mimetype)) {
      return res.status(404).json({ message: 'الصورة غير متاحة' })
    }
    if (process.env.MEDIA_REVALIDATION === '1') {
      const etag = '"' + asset.sha256 + '"'
      res.set({ 'Cache-Control': 'private, no-cache', ETag: etag })
      const matches = (req.get('If-None-Match') || '').split(',').map(x => x.trim().replace(/^W\//, ''))
      if (matches.includes(etag) || matches.includes('*')) return res.status(304).end()
    }
    res.status(200).set({ 'Content-Type': asset.mimetype, 'Content-Length': String(verified.size), 'Accept-Ranges': 'none' })
    if (req.method === 'HEAD') return res.end()
    let sourceError
    const captureSourceError = error => { sourceError = error }
    verified.stream.once('error', captureSourceError)
    try {
      await require('stream/promises').pipeline(verified.stream, res)
    } catch (error) {
      // Do not swallow storage errors just because pipeline destroys the response.
      const cancellation = ['ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_UNABLE_TO_PIPE', 'ECONNRESET']
      if (!cancellation.includes(error.code) || !(req.aborted || res.destroyed) ||
          (sourceError && !cancellation.includes(sourceError.code))) throw error
    } finally { verified.stream.removeListener('error', captureSourceError) }
  } finally { await verified.close() }

}))

module.exports = router
module.exports.noStore = noStore
