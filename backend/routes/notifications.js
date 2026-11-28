const router = require('express').Router()
const Notification = require('../models/Notification')
const direct = require('../services/directConversationNotices')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { validateMongoId } = require('../middleware/validators')
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');res.vary('Authorization');next()})
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
  res.set('Cache-Control','private, no-store')
  const filter = inboxFilter(req)
  const [data, unreadCount, directInbox] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(100),
    Notification.countDocuments({ ...filter, readAt: null }),
    direct.inbox(req.supplier)
  ])
  res.json({ data: [...data,...directInbox.data].sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)||String(b._id).localeCompare(String(a._id))).slice(0,100), unreadCount:unreadCount+directInbox.unreadCount })
}))
router.put('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ ...inboxFilter(req), readAt: null }, { $set: { readAt: new Date() } })
  await direct.readAll(req.supplier)
  res.json({ message: 'تم تعليم الإشعارات كمقروءة' })
}))
router.put('/:id/read', validateMongoId, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, ...inboxFilter(req) }, { $set: { readAt: new Date() } }, { new: true }
  )
  if (!notification) {
    const notice=await direct.read(req.supplier,req.params.id.toLowerCase())
    if(notice)return res.json({notification:notice})
  }
  if (!notification) return res.status(404).json({ message: 'الإشعار غير موجود' })
  res.json({ notification })
}))
module.exports = router
