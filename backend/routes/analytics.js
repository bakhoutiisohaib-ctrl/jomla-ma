const express = require('express')
const router = express.Router()
const Analytics = require('../models/Analytics')
const { asyncHandler } = require('../middleware/errorHandler')

/**
 * @swagger
 * tags:
 *   - name: Analytics
 *     description: Simple analytics event collection and summaries
 */

/**
 * @swagger
 * /api/analytics:
 *   post:
 *     summary: Record an analytics event
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *               meta:
 *                 type: object
 *     responses:
 *       201:
 *         description: Event recorded
 * /api/analytics/summary:
 *   get:
 *     summary: Get simple analytics summary
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Analytics summary
 */

// سجل حدث
router.post('/', asyncHandler(async (req, res) => {
  const { event, meta } = req.body
  const a = new Analytics({ event, meta })
  await a.save()
  res.status(201).json({ message: '✅ تم تسجيل الحدث' })
}))

// احصل على إحصاءات بسيطة
router.get('/summary', asyncHandler(async (req, res) => {
  const total = await Analytics.countDocuments()
  const byEvent = await Analytics.aggregate([
    { $group: { _id: '$event', count: { $sum: 1 } } }
  ])
  res.json({ total, byEvent })
}))

module.exports = router
