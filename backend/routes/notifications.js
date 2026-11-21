const router = require('express').Router()
const Notification = require('../models/Notification')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { validateMongoId } = require('../middleware/validators')
router.use(authenticate)
const inboxIds = req => req.supplier.role === 'staff' && req.supplier.permissions?.some(p => p === 'manage_rfq' || p === 'all')
  ? [req.supplier.id, req.supplier.ownerId || req.supplier.id] : [req.supplier.id]
router.get('/', asyncHandler(async (req, res) => {
  const filter = { userId: { $in: inboxIds(req) } }
  const [data, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(100),
    Notification.countDocuments({ ...filter, readAt: null })
  ])
  res.json({ data, unreadCount })
}))
router.put('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: { $in: inboxIds(req) }, readAt: null }, { $set: { readAt: new Date() } })
  res.json({ message: 'تم تعليم الإشعارات كمقروءة' })
}))
router.put('/:id/read', validateMongoId, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: { $in: inboxIds(req) } }, { $set: { readAt: new Date() } }, { new: true }
  )
  if (!notification) return res.status(404).json({ message: 'الإشعار غير موجود' })
  res.json({ notification })
}))
module.exports = router
