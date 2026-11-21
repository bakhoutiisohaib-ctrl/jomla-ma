const router = require('express').Router()
const mongoose = require('mongoose')
const SourcingRequest = require('../models/SourcingRequest')
const { authenticate, requirePermission, requireRole } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')
const sourcingCreation = require('../services/sourcingCreation')
const { sourcingDto } = require('../services/sourcingDto')
const sourcingOffers = require('../services/sourcingOfferSubmission')
const sourcingDecisions = require('../services/sourcingDecision')
router.use(authenticate)
const ownerId = req => String(req.supplier.ownerId || req.supplier.id)
const cleanText = (v, max = 5000) => typeof v === 'string' ? v.trim().slice(0, max) : ''
router.post('/', requireRole('buyer'), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const { sourcing, replayed } = await sourcingCreation.create(req)
    res.status(replayed ? 200 : 201).json({ message: 'تم تسجيل طلب التوريد؛ يمكنك متابعة العروض في حسابك', sourcing: sourcingDto(sourcing, req.supplier), replayed })
  } catch (err) {
    res.status(err.status || 503).json({ code: err.code || 'SOURCING_CREATION_UNCONFIRMED', message: err.status ? err.message : 'تعذر تأكيد نتيجة الإنشاء؛ استكمل المحاولة نفسها' })
  }
}))
router.get('/creation-result', requireRole('buyer'), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try { res.json({ sourcing: sourcingDto(await sourcingCreation.lookup(req), req.supplier), replayed: true }) }
  catch (err) { res.status(err.status || 503).json({ code: err.code || 'SOURCING_CREATION_UNCONFIRMED', message: err.status ? err.message : 'تعذر تأكيد نتيجة الإنشاء؛ استكمل المحاولة نفسها' }) }
}))
router.get('/buyer', requireRole('buyer'), asyncHandler(async (req, res) => {
  const data = await SourcingRequest.find({ buyerId: req.supplier.id }).sort({ createdAt: -1 })
  res.json({ data: data.map(doc => sourcingDto(doc, req.supplier)) })
}))
router.get('/', requirePermission('manage_rfq'), asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req)
  const status = req.query.status || 'open'
  if (!['open', 'quoted', 'all'].includes(status)) return res.status(400).json({ message: 'حالة الطلب غير صحيحة' })
  const filter = { status: status === 'all' ? { $in: ['open', 'quoted'] } : status }
  if (req.query.category) filter.category = cleanText(req.query.category, 200)
  const [requests, total] = await Promise.all([SourcingRequest.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip), SourcingRequest.countDocuments(filter)])
  res.json(formatPaginationResponse(requests.map(r => sourcingDto(r, req.supplier)), total, page, limit))
}))
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const sourcing = await SourcingRequest.findById(req.params.id)
  if (!sourcing) return res.status(404).json({ message: 'طلب التوريد غير موجود' })
  if (String(sourcing.buyerId) === String(req.supplier.id)) return res.json(sourcingDto(sourcing, req.supplier))
  const hasPermission = ['supplier', 'admin'].includes(req.supplier.role) ||
    (req.supplier.role === 'staff' && req.supplier.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))
  if (!hasPermission || (!['open', 'quoted'].includes(sourcing.status) && !sourcing.quotes.some(q => String(q.supplierId) === ownerId(req)))) {
    return res.status(403).json({ message: 'هذا الطلب خاص بأطرافه' })
  }
  res.json(sourcingDto(sourcing, req.supplier))
}))
router.post('/:id/quote', requirePermission('manage_rfq'), validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try { const result = await sourcingOffers.submit(req); res.status(result.processing ? 202 : 200).json(sourcingOffers.response(result, req.supplier)) }
  catch (err) { res.status(err.status || 503).json({ code: err.status ? err.code : 'SOURCING_OFFER_UNCONFIRMED', message: err.status ? err.message : 'تعذر تأكيد إرسال العرض؛ استكمل المحاولة نفسها' }) }
}))
router.post('/:id/operations/:operationId/retry', validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (!mongoose.isValidObjectId(req.params.operationId)) return res.status(400).json({ code: 'SOURCING_OPERATION_INVALID', message: 'معرف العملية غير صحيح' })
  try {
    // Each handler verifies its own receipt kind and current actor ownership.
    const handler = req.supplier.role === 'buyer' ? sourcingDecisions : sourcingOffers
    const result = await handler.retry(req); res.status(result.processing ? 202 : 200).json(handler.response(result, req.supplier))
  }
  catch (err) { res.status(err.status || 503).json({ code: err.status ? err.code : 'SOURCING_OFFER_UNCONFIRMED', message: err.status ? err.message : 'تعذر تأكيد إرسال العرض؛ استكمل المحاولة نفسها' }) }
}))
router.put('/:id/quotes/:quoteId/action', requireRole('buyer'), validateMongoId, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try { const result = await sourcingDecisions.decide(req); res.status(result.processing ? 202 : 200).json(sourcingDecisions.response(result, req.supplier)) }
  catch (err) { res.status(err.status || 503).json({ code: err.status ? err.code : 'SOURCING_DECISION_UNCONFIRMED', message: err.status ? err.message : 'تعذر تأكيد القرار؛ استكمل المحاولة نفسها' }) }
}))
module.exports = router
