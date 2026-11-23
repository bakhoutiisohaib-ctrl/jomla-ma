const router = require('express').Router()
const mongoose = require('mongoose')
const QuoteRequest = require('../models/QuoteRequest')
const QuoteOffer = require('../models/QuoteOffer')
const MessageThread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const { authenticate, requirePermission, requireRole } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { decide } = require('../services/rfqDecision')
const { createRfq, retryCreation, creationResponse } = require('../services/rfqCreation')
const { submitOffer, retryOffer, offerResponse, submissionSummary } = require('../services/rfqOfferSubmission')
const { rejectSupplier, rejectionResponse, rejectionSummary } = require('../services/rfqSupplierRejection')

router.use(authenticate)
const ownerId = req => req.supplier.ownerId || req.supplier.id
const supplierParty = (req, rfq) => ['supplier', 'admin', 'staff'].includes(req.supplier.role) &&
  String(rfq.supplierId?._id || rfq.supplierId) === String(ownerId(req)) &&
  (req.supplier.role !== 'staff' || req.supplier.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))
const buyerParty = (req, rfq) => String(rfq.buyerId) === String(req.supplier.id)
const permitted = (req, rfq) => buyerParty(req, rfq) || supplierParty(req, rfq)
const notice = (userId, type, resourceId) => Notification.create({ userId, type, resourceType: 'rfq', resourceId })

router.post('/', requireRole('buyer'), require('../services/buyerProfile').requireBuyerContact, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const result = await createRfq(req)
  res.status(result.processing ? 202 : 201).json(creationResponse(result))
}))

router.post('/:id/creation/retry', requireRole('buyer'), validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const result = await retryCreation(req.params.id, req.supplier.id)
  res.status(result.processing ? 202 : 201).json(creationResponse(result))
}))

router.get('/buyer', requireRole('buyer'), asyncHandler(async (req, res) => {
  const data = await QuoteRequest.find({ buyerId: req.supplier.id })
    .populate('productId', 'name imageUrl currency unit').populate('supplierId', 'name').sort({ createdAt: -1 })
  res.json({ data, counts: { total: data.length, pending: data.filter(r => r.status === 'pending').length } })
}))
router.get('/supplier', requirePermission('manage_rfq'), asyncHandler(async (req, res) => {
  const data = await QuoteRequest.find({ supplierId: ownerId(req), status: { $ne: 'creating' } })
    .populate('productId', 'name imageUrl price currency moq unit category').sort({ createdAt: -1 })
  res.json({ data, counts: { total: data.length, pending: data.filter(r => r.status === 'pending').length,
    responded: data.filter(r => r.status === 'responded').length } })
}))

router.put('/:id/respond', requirePermission('manage_rfq'), validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (req.body.status !== 'rejected') {
    const result = await submitOffer(req)
    return res.status(result.processing ? 202 : 200).json(offerResponse(result))
  }
  const result = await rejectSupplier(req)
  res.status(result.processing ? 202 : 200).json(rejectionResponse(result))
}))

router.post('/:id/offers/retry', requirePermission('manage_rfq'), validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const result = await retryOffer(req)
  res.status(result.processing ? 202 : 200).json(offerResponse(result))
}))

router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const rfq = await QuoteRequest.findById(req.params.id).populate('productId', 'name imageUrl currency unit').populate('supplierId', 'name')
  if (!rfq) return res.status(404).json({ message: 'طلب عرض السعر غير موجود' })
  if (!permitted(req, rfq)) return res.status(403).json({ message: 'لا يمكنك الاطلاع على هذا الطلب' })
  res.json(rfq)
}))

router.put('/:id/action', requireRole('buyer'), validateMongoId, asyncHandler(async (req, res) => {
  const { action, offerId } = req.body
  if (!['accept', 'reject'].includes(action) || !mongoose.isValidObjectId(offerId)) return res.status(400).json({ message: 'حدد العرض وإجراء القبول أو الرفض' })
  const result = await decide({ rfqId: req.params.id, buyerId: req.supplier.id, actor: req.supplier, action, offerId })
  res.status(result.processing ? 202 : 200).json({
    message: result.processing ? 'حُفظ قرارك وجارٍ استكماله. يمكنك إعادة المحاولة بأمان.' : 'تم تسجيل قرارك',
    ...result
  })
}))

router.get('/:id/thread', validateMongoId, asyncHandler(async (req, res) => {
  const rfq = await QuoteRequest.findById(req.params.id).select('+offerSubmission +supplierRejection')
  if (!rfq) return res.status(404).json({ message: 'الطلب غير موجود' })
  if (!permitted(req, rfq)) return res.status(403).json({ message: 'المحادثة خاصة بأطراف الطلب' })
  if (rfq.status === 'creating') return res.status(202).json({ thread: null, offers: [], rfq, processing: true })
  const [thread, offers] = await Promise.all([MessageThread.findOne({ rfqId: rfq._id }), QuoteOffer.find({ rfqId: rfq._id }).sort({ createdAt: -1 })])
  const visibleOffers = offers.map(offer => rfq.status === 'offering' && String(offer._id) === String(rfq.offerSubmission?.offerId)
    ? { ...offer.toJSON(), status: 'preparing' } : offer)
  res.json({ thread, offers: visibleOffers, rfq, ...(supplierParty(req, rfq) ? { offerSubmission: submissionSummary(rfq), rejection: rejectionSummary(rfq) } : {}) })
}))
router.post('/:id/messages', validateMongoId, asyncHandler(async (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : ''
  if (!content || content.length > 5000) return res.status(400).json({ message: 'الرسالة مطلوبة وبحد أقصى 5000 حرف' })
  const rfq = await QuoteRequest.findById(req.params.id)
  if (!rfq) return res.status(404).json({ message: 'الطلب غير موجود' })
  if (!permitted(req, rfq)) return res.status(403).json({ message: 'المحادثة خاصة بأطراف الطلب' })
  if (!['pending', 'responded'].includes(rfq.status)) return res.status(409).json({ message: 'المحادثة مغلقة بعد اتخاذ القرار' })
  const buyer = buyerParty(req, rfq)
  const thread = await MessageThread.findOneAndUpdate({ rfqId: rfq._id, status: 'open' }, {
    $push: { messages: { content, senderId: req.supplier.id, senderRole: buyer ? 'buyer' : 'supplier', senderName: req.supplier.name } },
    $set: { lastMessageAt: new Date() } }, { new: true, runValidators: true })
  if (!thread) return res.status(409).json({ message: 'المحادثة مغلقة' })
  await notice(buyer ? rfq.supplierId : rfq.buyerId, 'message_received', rfq._id)
  res.status(201).json({ message: 'تم إرسال الرسالة', thread })
}))
module.exports = router
