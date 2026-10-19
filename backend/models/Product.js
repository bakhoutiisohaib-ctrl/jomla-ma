const mongoose = require('mongoose')

const PriceTierSchema = new mongoose.Schema({
  minQty: { type: Number, required: true, min: 1 },
  maxQty: { type: Number, min: 1 }, // Optional: null or undefined means minQty and above
  price:  { type: Number, required: true, min: 0 }
}, { _id: false })

const ProductSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  category:      { type: String, required: true, trim: true },
  price:         { type: Number, required: true, min: 0 }, // السعر الأساسي/الافتراضي بالدرهم
  currency:      { type: String, default: 'MAD' },
  moq:           { type: Number, default: 1, min: 1 }, // الحد الأدنى للطلب (Minimum Order Quantity)
  unit:          { type: String, default: 'قطعة' }, // وحدة البيع: قطعة، درزينة، كرتونة، طرد، كغ...
  priceTiers:    [PriceTierSchema], // أسعار الكميات (Tiered Pricing)
  inStock:       { type: Boolean, default: true },
  city:          { type: String, trim: true },
  supplierId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },
  supplierPhone: { type: String, trim: true },
  views:          { type: Number, default: 0 },
  description:    String,
  images:         [String],
  imageUrl:       String,
  hasImageRights: { type: Boolean, default: true }, // إقرار بملكية أو ترخيص استخدام الصورة
  isDraft:        { type: Boolean, default: false }, // حالة المسودة قبل الاعتماد النهائي
  createdAt:      { type: Date, default: Date.now }
})

ProductSchema.index({ name: 'text', category: 'text', city: 1 })

module.exports = mongoose.model('Product', ProductSchema)
