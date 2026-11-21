const router = require('express').Router()
const Opportunity = require('../models/WholesaleOpportunity')
const Product = require('../models/Product')
const { authenticate, requireRole, requirePermission } = require('../middleware/auth')
const { asyncHandler } = require('../middleware/errorHandler')
const { validateMongoId } = require('../middleware/validators')
const { parseOptions } = require('../utils/catalog')
const service = require('../services/wholesaleOpportunities')
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() })
router.get('/mine', authenticate, requireRole('supplier', 'staff'), requirePermission('manage_products'), asyncHandler(async (req, res) => {
  const o = parseOptions(req.query), limit = Math.min(o.limit, 24), owner = req.supplier.ownerId || req.supplier.id
  const filter = { supplierId: owner }, [rows, total] = await Promise.all([
    Opportunity.find(filter).sort({ createdAt: -1, _id: 1 }).skip((o.page-1)*limit).limit(limit).lean().maxTimeMS(5000),
    Opportunity.countDocuments(filter).maxTimeMS(5000)
  ])
  res.json({ data: rows.map(row => service.dto(row)), total, page: o.page, limit })
}))
router.get('/mine/:id', authenticate, requireRole('supplier', 'staff'), requirePermission('manage_products'), validateMongoId, asyncHandler(async (req, res) => {
  const row = await Opportunity.findOne({ _id: req.params.id, supplierId: req.supplier.ownerId || req.supplier.id }).lean().maxTimeMS(5000)
  if (!row) return res.status(404).json({ message: 'الفرصة غير موجودة' })
  res.json({ opportunity: service.dto(row) })
}))
router.get('/eligible-products', authenticate, requireRole('supplier', 'staff'), requirePermission('manage_products'), asyncHandler(async (req, res) => {
  const o = parseOptions(req.query), owner = req.supplier.ownerId || req.supplier.id
  // Paginate the existing owned catalog; eligibility is checked again on writes.
  const filter = { supplierId: owner, isDraft: false }, limit = 24
  const [rows, total] = await Promise.all([Product.find(filter).select('name unit currency moq storeId').sort({ _id: 1 }).skip((o.page-1)*limit).limit(limit).lean().maxTimeMS(5000), Product.countDocuments(filter).maxTimeMS(5000)])
  const data = []
  for (const row of rows) {
    try { await service.eligibleProduct(row._id, owner); data.push(row) }
    catch (error) { if (error.status !== 404) throw error }
  }
  res.json({ data, page: o.page, pages: Math.ceil(total/limit) })
}))
router.get('/', asyncHandler(async (req, res) => res.json(await service.list(req.query))))
router.get('/:id', asyncHandler(async (req, res) => res.json({ opportunity: await service.publicDetail(req.params.id) })))
router.post('/', authenticate, requireRole('supplier', 'staff'), requirePermission('manage_products'), asyncHandler(async (req, res) => res.status(201).json({ opportunity: await service.create(req) })))
router.put('/:id', authenticate, requireRole('supplier', 'staff'), requirePermission('manage_products'), validateMongoId, asyncHandler(async (req, res) => res.json({ opportunity: await service.update(req) })))
module.exports = router
