const router = require('express').Router()
const mongoose = require('mongoose')
const Review = require('../models/Review')
const Supplier = require('../models/Supplier')
const Product = require('../models/Product')
const { authenticate, requireRole, requireAdmin } = require('../middleware/auth')
const { validateMongoId } = require('../middleware/validators')
const { asyncHandler } = require('../middleware/errorHandler')
const { getPaginationParams, formatPaginationResponse } = require('../utils/constants')
const { publicCatalogFilter } = require('../utils/catalog')
const { auditedChange } = require('../utils/audit')
const { eligible } = require('../services/tradeConfirmation')
const AuditLog=require('../models/AuditLog')
const removed=(buyerId,supplierId)=>AuditLog.exists({action:'REVIEW_DELETED',phase:{$in:['pending','completed']},'details.reviewBuyerId':String(buyerId),'details.reviewSupplierId':String(supplierId)})

router.get('/eligibility/:supplierId', authenticate, requireRole('buyer'), asyncHandler(async (req,res)=>{
  res.set('Cache-Control','private, no-store')
  const supplierId=req.params.supplierId
  if(!mongoose.isValidObjectId(supplierId))return res.status(400).json({message:'معرف المورد غير صحيح'})
  if(!await Supplier.exists({_id:supplierId,role:'supplier',isActive:{$ne:false}}))return res.status(404).json({message:'المورد غير متاح'})
  const buyerId=req.supplier.id
  const existing=await Review.exists({supplierId,buyerId}) || await removed(buyerId,supplierId)
  const allowed=!existing && Boolean(await eligible(buyerId,supplierId))
  res.json({supplierId,buyerId,eligible:allowed,reason:existing?'already_reviewed':allowed?'eligible':'no_confirmation'})
}))

router.get('/:supplierId', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.supplierId)) return res.status(400).json({ message: 'معرف المورد غير صحيح' })
  const supplierId = new mongoose.Types.ObjectId(req.params.supplierId)
  if (!(await Supplier.exists({ _id: supplierId, role: 'supplier', isActive: { $ne: false } }))) return res.status(404).json({ message: 'المورد غير متاح' })
  const { page, limit, skip } = getPaginationParams(req)
  const [reviews, statistics, total] = await Promise.all([
    Review.find({ supplierId }).select('productId supplierId userName stars comment reply date basis').sort({ date: -1, _id: 1 }).skip(skip).limit(limit),
    Review.aggregate([{ $match: { supplierId, basis: 'mutual_confirmation', tradeConfirmationId: { $type: 'objectId' } } }, { $group: { _id: null, avg: { $avg: '$stars' }, total: { $sum: 1 } } }]),
    Review.countDocuments({supplierId})
  ])
  const stats = statistics[0] || { avg: 0, total: 0 }
  res.json({
    ...formatPaginationResponse(reviews, total, page, limit),
    legacyTotal: Math.max(0,total-stats.total),
    stats: { avg: Number((stats.avg || 0).toFixed(1)), total: stats.total }
  })
}))

router.post('/', authenticate, requireRole('buyer'), asyncHandler(async (req, res) => {
  const allowed = ['supplierId', 'productId', 'stars', 'comment']
  const { supplierId, productId, stars, comment = '' } = req.body
  if (Object.keys(req.body).some(key => !allowed.includes(key)) || !mongoose.isValidObjectId(supplierId) ||
      (productId !== undefined && !mongoose.isValidObjectId(productId)) || !Number.isInteger(stars) || stars < 1 || stars > 5 ||
      typeof comment !== 'string' || comment.length > 500) {
    return res.status(400).json({ message: 'بيانات التقييم غير صحيحة؛ الاسم والرد والتاريخ تحددها المنصة' })
  }
  if (String(supplierId) === req.supplier.id) return res.status(403).json({ message: 'لا يمكن تقييم حسابك' })
  const supplier = await Supplier.findOne({ _id: supplierId, role: 'supplier', isActive: { $ne: false } })
  if (!supplier) return res.status(404).json({ message: 'المورد غير متاح' })
  if (productId && !(await Product.exists({ ...(await publicCatalogFilter()), _id: productId, supplierId }))) {
    return res.status(400).json({ message: 'المنتج غير متاح أو لا ينتمي لهذا المورد' })
  }
  if (await Review.exists({ supplierId, buyerId: req.supplier.id }) || await removed(req.supplier.id,supplierId)) return res.status(409).json({ message: 'لديك تقييم لهذا المورد بالفعل' })
  const trade = await eligible(req.supplier.id,supplierId,productId)
  if(!trade)return res.status(403).json({message:'التقييم يتطلب إقرار إتمام التعامل من الطرفين'})
  const review = await Review.create({ supplierId, productId, stars, comment: comment.trim(), buyerId: req.supplier.id, userName: req.supplier.name, basis:'mutual_confirmation',tradeConfirmationId:trade._id })
  const saved=review.toObject();delete saved.tradeConfirmationId
  res.status(201).json({ message: 'تم حفظ تقييمك بعد إقرار الطرفين؛ ليس إثباتاً مستقلاً للدفع أو التسليم', review:saved })
}))

router.delete('/:id', authenticate, requireAdmin, validateMongoId, asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id)
  if (!review) return res.status(404).json({ message: 'التقييم غير موجود' })
  const reason = req.body.reason
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) return res.status(400).json({ message: 'سبب إزالة التقييم مطلوب' })
  await auditedChange({
    action: 'REVIEW_DELETED', targetType: 'Review', targetId: review._id, actor: req.supplier,
    details: { reason, supplierId: review.supplierId, stars: review.stars, ...(review.buyerId?{reviewBuyerId:String(review.buyerId),reviewSupplierId:String(review.supplierId)}:{}) }
  }, () => Review.deleteOne({ _id: review._id }))
  res.json({ message: 'تمت إزالة التقييم بقرار إداري مسجل' })
}))

module.exports = router
