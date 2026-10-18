const express = require('express')
const router  = express.Router()
const Review  = require('../models/Review')
const { validateReview, validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')

/**
 * @swagger
 * tags:
 *   - name: Reviews
 *     description: Product and supplier reviews
 */

/**
 * @swagger
 * /api/reviews/{supplierId}:
 *   get:
 *     summary: Get reviews for a supplier (paginated)
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: supplierId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Paginated reviews with stats
 * /api/reviews:
 *   post:
 *     summary: Add a new review
 *     tags: [Reviews]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               supplierId:
 *                 type: string
 *               stars:
 *                 type: integer
 *               comment:
 *                 type: string
 *     responses:
 *       201:
 *         description: Review created
 */

// جيب تقييمات مورد - مع pagination
router.get('/:supplierId', asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)

  const reviews = await Review.find({ supplierId: req.params.supplierId })
    .sort({ date: -1 })
    .limit(limit)
    .skip(skip)

  const total = await Review.countDocuments({ supplierId: req.params.supplierId })
  
  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1)
    : 0

  res.json({
    ...formatPaginationResponse(reviews, total, page, limit),
    stats: { avg, total }
  })
}))

// أضف تقييم جديد
router.post('/', validateReview, asyncHandler(async (req, res) => {
  const review = new Review(req.body)
  await review.save()

  res.status(201).json({
    message: '✅ شكراً على تقييمك!',
    review
  })
}))

module.exports = router
