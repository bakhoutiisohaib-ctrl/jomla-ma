const router = require('express').Router()
const BackgroundJob = require('../models/BackgroundJob')
const { authenticate } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { validateMongoId } = require('../middleware/validators')
const { publicJob } = require('../services/jobQueue')

router.use(authenticate)

function accessFilter(user) {
  if (user.role === 'admin') return {}
  if (user.role === 'staff') {
    // Own requests do not bypass a revoked organizational permission.
    return { ownerId: user.ownerId, organizationId: user.organizationId || null,
      requiredPermission: { $in: user.organizationId ? user.permissions || [] : [] } }
  }
  return { ownerId: user.id }
}

const list = asyncHandler(async (req, res) => {
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ message: 'صفحة أو عدد نتائج غير صحيح' })
  }
  const filter = accessFilter(req.supplier)
  if (req.query.status !== undefined) {
    if (!['pending', 'retry_wait', 'running', 'succeeded', 'failed'].includes(req.query.status)) return res.status(400).json({ message: 'حالة مهمة غير صحيحة' })
    filter.status = req.query.status
  }
  const [jobs, total] = await Promise.all([
    BackgroundJob.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    BackgroundJob.countDocuments(filter)
  ])
  res.json({ data: jobs.map(publicJob), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

router.get('/', list)
router.get('/mine', list)
router.get('/:id', validateMongoId, asyncHandler(async (req, res) => {
  const job = await BackgroundJob.findOne({ _id: req.params.id, ...accessFilter(req.supplier) }).lean()
  if (!job) return res.status(404).json({ message: 'المهمة غير موجودة' })
  res.json({ job: publicJob(job) })
}))

module.exports = router
