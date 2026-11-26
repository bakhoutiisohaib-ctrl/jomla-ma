const router = require('express').Router()
const mongoose = require('mongoose')
const FavoriteList = require('../models/FavoriteList')
const Product = require('../models/Product')
const { authenticate, requireRole } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { PUBLIC_VISIBILITY } = require('../utils/catalog')
const { getPublicStore } = require('../services/publicStore')

const LIMIT = 100
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() })
router.use(authenticate, requireRole('buyer'))

function target(req) {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id || ''))
    throw Object.assign(new Error('معرف المنتج غير صالح'), { status: 400 })
  return new mongoose.Types.ObjectId(req.params.id)
}
function rejectExtra(req) {
  if (Object.keys(req.query || {}).length || Object.keys(req.body || {}).length)
    throw Object.assign(new Error('الطلب لا يقبل بيانات إضافية'), { status: 400 })
}
async function readIds(owner) {
  const list = await FavoriteList.findById(owner).select('productIds').lean()
  return (list?.productIds || []).map(String)
}
async function publicProductExists(id) {
  const product = await Product.findOne({ _id: id, ...PUBLIC_VISIBILITY }).select('storeId supplierId').lean()
  if (!product) return false
  const store = await getPublicStore(product.storeId)
  return Boolean(store && String(store.supplierId._id) === String(product.supplierId))
}

router.get('/', asyncHandler(async (req, res) => {
  rejectExtra(req)
  res.json({ productIds: await readIds(req.supplier.id), limit: LIMIT })
}))

router.put('/:id', asyncHandler(async (req, res) => {
  rejectExtra(req)
  const id = target(req), owner = new mongoose.Types.ObjectId(req.supplier.id)
  // Reuse the public detail visibility boundary, including supplier/store ownership.
  if (!(await publicProductExists(id))) return res.status(404).json({ message: 'المنتج غير متاح' })
  // The unique owner key is MongoDB's built-in _id index; concurrent first
  // requests can safely retry initialization. The bounded add is atomic.
  try {
    await FavoriteList.updateOne({ _id: owner }, { $setOnInsert: { productIds: [] } }, { upsert: true })
  } catch (error) { if (error.code !== 11000) throw error }
  const result = await FavoriteList.updateOne({
    _id: owner,
    $or: [{ productIds: id }, { $expr: { $lt: [{ $size: '$productIds' }, LIMIT] } }]
  }, { $addToSet: { productIds: id } })
  if (!result.matchedCount) return res.status(409).json({ message: 'بلغت الحد الأقصى للمفضلة', code: 'FAVORITES_LIMIT' })
  res.json({ productId: String(id), saved: true })
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  rejectExtra(req)
  const id = target(req)
  // Removal is allowed even for a withdrawn or deleted product.
  await FavoriteList.updateOne({ _id: req.supplier.id }, { $pull: { productIds: id } })
  res.json({ productId: String(id), saved: false })
}))

module.exports = router
