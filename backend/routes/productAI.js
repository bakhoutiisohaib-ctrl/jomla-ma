const router = require('express').Router()
const { randomUUID } = require('crypto')
const { authenticate, requirePermission } = require('../middleware/auth')
const { memoryUpload, saveImage } = require('../middleware/upload')
const { asyncHandler } = require('../middleware/errorHandler')
const { enqueueJob, publicJob } = require('../services/jobQueue')
const { providerConfigured } = require('../services/productDraft')

const permission = requirePermission('manage_products')
const acceptsRights = req => req.body.hasImageRights === true || req.body.hasImageRights === 'true'
router.get('/ping', (req, res) => res.json({ ok: true, analysisConfigured: providerConfigured(), manualEntryAvailable: true, processing: 'background_job' }))

router.post('/upload', authenticate, permission, memoryUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'الصورة مطلوبة' })
  if (!acceptsRights(req)) return res.status(400).json({ message: 'إقرار حق استخدام الصورة مطلوب قبل الرفع' })
  res.status(201).json({ imageUrl: await saveImage(req.file, req.supplier), message: 'تم رفع الصورة. أدخل البيانات وراجعها قبل الاعتماد.' })
}))

router.post('/enhance', authenticate, permission, memoryUpload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'الصورة مطلوبة' })
  if (!acceptsRights(req)) return res.status(400).json({ message: 'إقرار حق استخدام الصورة مطلوب قبل التحليل' })
  const imageUrl = await saveImage(req.file, req.supplier)
  if (!providerConfigured()) return res.status(503).json({ message: 'تحليل الصورة غير متاح حالياً. أدخل بيانات المنتج يدوياً وراجعها قبل النشر.', analysisAvailable: false, manualInputRequired: true, imageUrl })
  const { job } = await enqueueJob({ type: 'ai_product_draft', ownerId: String(req.supplier.ownerId || req.supplier.id),
    requestedBy: String(req.supplier.id), organizationId: req.supplier.organizationId ? String(req.supplier.organizationId) : null,
    requiredPermission: 'manage_products', payload: { imageUrl, mimetype: req.file.mimetype },
    idempotencyKey: randomUUID(), maxAttempts: 2, timeoutMs: 35000 })
  res.status(202).location('/api/jobs/' + job._id).json({ imageUrl, job: publicJob(job), manualInputRequired: true, message: 'تم حفظ مهمة التحليل. راجع النتيجة قبل النشر.' })
}))

router.post('/search-images', (req, res) => res.status(410).json({ images: [], message: 'استخدم صورة تملكها أو صورة مرخصة موثقة. اختيار صور عامة عشوائية غير متاح.' }))
module.exports = router
