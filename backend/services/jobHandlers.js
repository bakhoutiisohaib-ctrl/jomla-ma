const Product = require('../models/Product')
const { assertJobPermission } = require('./jobQueue')
const { generateProductDraft } = require('./productDraft')
const { indexProduct } = require('./visualIndex')

module.exports = {
  ai_product_draft: async (payload, context) => {
    await assertJobPermission(context.job)
    const result = await generateProductDraft(payload, context)
    await assertJobPermission(context.job)
    return result
  },
  visual_index_product: async (payload, context) => {
    await assertJobPermission(context.job)
    const product = await Product.findOne({ _id: payload.productId, supplierId: context.job.ownerId }).select('_id').lean()
    if (!product) return { status: 'unindexed', reason: 'product_removed', productId: payload.productId }
    if (context.signal.aborted) throw Object.assign(new Error('Aborted'), { code: 'JOB_TIMEOUT' })
    return indexProduct(payload.productId, { actorId: context.job.requestedBy || context.job.ownerId, beforeWrite: async () => {
      if (context.signal.aborted || !await context.heartbeat()) throw Object.assign(new Error('Job lease expired'), { code: 'JOB_TIMEOUT' })
      await assertJobPermission(context.job)
      if (!await Product.exists({ _id: payload.productId, supplierId: context.job.ownerId })) {
        throw Object.assign(new Error('Product ownership changed'), { code: 'JOB_REJECTED', retryable: false })
      }
    } })
  }
}
