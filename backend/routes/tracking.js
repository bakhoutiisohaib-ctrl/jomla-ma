const express = require('express')
const router = express.Router()
const Product = require('../models/Product')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { formatPaginationResponse } = require('../utils/constants')
const { publicCatalogFilter, searchCatalog } = require('../utils/catalog')

router.post('/view/:id', validateMongoId, asyncHandler(async (req, res) => {
  const product = await Product.findOneAndUpdate(
    { ...(await publicCatalogFilter()), _id: req.params.id },
    { $inc: { views: 1 } },
    { returnDocument: 'after' }
  )
  if (!product) return res.status(404).json({ message: 'المنتج غير موجود' })
  res.json({ message: 'تم تسجيل المشاهدة', views: product.views })
}))

router.get('/trending', asyncHandler(async (req, res) => {
  const result = await searchCatalog({ ...req.query, order: 'relevance' })
  res.json(formatPaginationResponse(result.products, result.total, result.page, result.limit))
}))
module.exports = router
