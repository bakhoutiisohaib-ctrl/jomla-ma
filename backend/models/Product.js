const mongoose = require('mongoose')

const ProductSchema = new mongoose.Schema({
  name:        String,   // اسم المنتج
  category:    String,   // الفئة: ملابس، أحذية...
  price:       Number,   // الثمن بالدرهم
  city:        String,   // المدينة: فاس، طنجة...
  supplierId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' }, // مرجع للمورد
  supplierPhone:String, // رقم واتساب المورد بالصيغة الدولية
  views: { type: Number, default: 0 }, // عدد المشاهدات
  description: String,   // وصف المنتج
  images:      [String], // مصفوفة روابط الصور
  imageUrl:    String    // رابط الصورة المحسنة (preview)
})

ProductSchema.index({ name: 'text', category: 'text', city: 1 })

module.exports = mongoose.model('Product', ProductSchema)
