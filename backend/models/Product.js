const mongoose = require('mongoose')
const { PATHS } = require('../utils/taxonomy')

const requiredWhenPublished = function () { return this.isDraft === false }
const PriceTierSchema = new mongoose.Schema({
  minQty: { type: Number, required: true, min: 1, validate: Number.isInteger },
  maxQty: { type: Number, min: 1, validate: { validator: v => v == null || Number.isInteger(v) } },
  price: { type: Number, required: true, min: 0 }
}, { _id: false })

const ProductSchema = new mongoose.Schema({
  name: { type: String, trim: true, maxlength: 160, required: requiredWhenPublished },
  category: { type: String, trim: true, maxlength: 100, required: requiredWhenPublished },
  taxonomyPath: { type: String, enum: ['', ...PATHS] },
  pricingMode: { type: String, enum: ['fixed', 'on_request'], default: 'fixed' },
  price: { type: Number, min: 0, required: function () { return this.isDraft === false && this.pricingMode !== 'on_request' } },
  currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: 'MAD' },
  country: { type: String, uppercase: true, trim: true, match: /^[A-Z]{2}$/, default: 'MA' },
  moq: { type: Number, min: 1, default: 1, validate: Number.isInteger },
  unit: { type: String, trim: true, maxlength: 50, default: 'قطعة' },
  priceTiers: [PriceTierSchema],
  inStock: { type: Boolean, default: false },
  availability: { type: String, enum: ['unknown', 'in_stock', 'out_of_stock'], default: 'unknown' },
  availabilityConfirmed: { type: Boolean, default: false },
  city: { type: String, trim: true, maxlength: 100, required: requiredWhenPublished },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: requiredWhenPublished },
  supplierPhone: { type: String, trim: true },
  views: { type: Number, default: 0 },
  description: { type: String, maxlength: 5000, required: requiredWhenPublished },
  images: [String],
  imageUrl: { type: String, required: requiredWhenPublished },
  hasImageRights: { type: Boolean, default: false },
  imageRights: {
    source: { type: String, enum: ['owned', 'licensed'] },
    licenseReference: String,
    declaredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
    declaredAt: Date
  },
  isDraft: { type: Boolean, default: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  approvedAt: Date,
  moderationStatus: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  moderationReason: String,
  moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  moderatedAt: Date,
  createdAt: { type: Date, default: Date.now },
  // Internal receipt is inserted atomically with the product, never accepted
  // from editable input and never exposed in catalog/editor serialization.
  creationReceipt: {
    type: new mongoose.Schema({
      key: { type: String, required: true },
      hash: { type: String, required: true },
      actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
      organizationId: { type: mongoose.Schema.Types.ObjectId, default: null },
      snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
    }, { _id: false }),
    select: false,
    immutable: true
  }
}, { timestamps: { createdAt: true, updatedAt: true } })

ProductSchema.pre('validate', function () {
  const tiers = [...this.priceTiers].sort((a, b) => a.minQty - b.minQty)
  tiers.forEach((tier, i) => {
    if (tier.maxQty != null && tier.maxQty < tier.minQty) this.invalidate('priceTiers', 'نهاية شريحة السعر يجب أن تكون أكبر من بدايتها')
    if (tier.minQty < this.moq) this.invalidate('priceTiers', 'بداية الشريحة يجب ألا تقل عن MOQ')
    if (i && (tiers[i - 1].maxQty == null || tier.minQty <= tiers[i - 1].maxQty)) this.invalidate('priceTiers', 'شرائح الأسعار متداخلة')
  })
  if (this.pricingMode === 'on_request' && tiers.length) this.invalidate('priceTiers', 'منتج اطلب سعراً لا يقبل شرائح أسعار')
  if (this.isDraft === false) {
    if (!this.description || this.description.trim().length < 10) this.invalidate('description', 'الوصف يجب أن يحتوي 10 أحرف على الأقل')
    if (!this.hasImageRights || !this.imageRights?.declaredBy || !this.imageRights?.declaredAt || !this.imageRights?.source) this.invalidate('hasImageRights', 'إقرار حقوق الصورة الصريح مطلوب')
    if (!this.approvedBy || !this.approvedAt) this.invalidate('approvedAt', 'اعتماد المورد الصريح مطلوب للنشر')
    if (!this.availabilityConfirmed || this.availability === 'unknown' || this.inStock !== (this.availability === 'in_stock')) this.invalidate('availability', 'يجب تأكيد حالة التوفر')
    if (this.moderationStatus === 'hidden') this.invalidate('moderationStatus', 'لا يمكن نشر منتج محجوب من الإشراف')
  }
})

ProductSchema.index({ name: 'text', category: 'text', city: 1 })
ProductSchema.index({ supplierId: 1, createdAt: -1 })
ProductSchema.index({ isDraft: 1, inStock: 1, storeId: 1 })
// Legacy products have no receipt and are excluded: no backfill or migration.
ProductSchema.index({ supplierId: 1, 'creationReceipt.key': 1 }, {
  name: 'product_creation_owner_key', unique: true,
  partialFilterExpression: { 'creationReceipt.key': { $type: 'string' } }
})
for (const format of ['toJSON', 'toObject']) ProductSchema.set(format, {
  transform: (_document, value) => { delete value.creationReceipt; return value }
})
module.exports = mongoose.model('Product', ProductSchema)
