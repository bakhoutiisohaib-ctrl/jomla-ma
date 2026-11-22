const router = require('express').Router()
const Notification = require('../models/Notification')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { validateMongoId } = require('../middleware/validators')
router.use(authenticate)
// Delegated sales notifications only; future/private owner types fail closed.
const inboxFilter = req => {
  const own = { userId: req.supplier.id }
  if (req.supplier.role !== 'staff' || !req.supplier.organizationId ||
      !req.supplier.permissions?.includes('manage_rfq') || !req.supplier.ownerId) return own
  return { $or: [own, { userId: req.supplier.ownerId, $or: [
    { resourceType: 'rfq', type: { $in: ['rfq_created', 'offer_decision', 'message_received'] } },
    { resourceType: 'sourcing', type: 'sourcing_decision' }
  ] }] }
}
router.get('/', asyncHandler(async (req, res) => {
  const filter = inboxFilter(req)
  const [data, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(100),
    Notification.countDocuments({ ...filter, readAt: null })
  ])
  res.json({ data, unreadCount })
}))
router.put('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ ...inboxFilter(req), readAt: null }, { $set: { readAt: new Date() } })
  res.json({ message: 'تم تعليم الإشعارات كمقروءة' })
}))
router.put('/:id/read', validateMongoId, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, ...inboxFilter(req) }, { $set: { readAt: new Date() } }, { new: true }
  )
  if (!notification) return res.status(404).json({ message: 'الإشعار غير موجود' })
  res.json({ notification })
}))
module.exports = router
