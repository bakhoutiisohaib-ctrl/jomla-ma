const express = require('express')
const router  = express.Router()
const Product = require('../models/Product')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Tracking
 *     description: Product tracking and views
 */

/**
 * @swagger
 * /api/tracking/view/{id}:
 *   post:
 *     summary: Register a view for a product
 *     tags: [Tracking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: View registered with updated count
 * /api/tracking/trending:
 *   get:
 *     summary: Get trending (most viewed) products
 *     tags: [Tracking]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated trending products
 */

// تسجيل مشاهدة لمنتج
router.post('/view/:id', validateMongoId, asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $inc: { views: 1 } },
    { new: true }
  )

  if (!product) {
    return res.status(404).json({ message: '❌ المنتج غير موجود' })
  }

  res.json({ 
    message: '✅ تم تسجيل المشاهدة',
    views: product.views
  })
}))

// جيب المنتجات الأكثر مشاهدة
const { cacheMiddleware } = require('../middleware/cache')

router.get('/trending', cacheMiddleware(30), asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)

  const products = await Product.find()
    .sort({ views: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Product.countDocuments()

  res.json(formatPaginationResponse(products, total, page, limit))
}))

module.exports = router
