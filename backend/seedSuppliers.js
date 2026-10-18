const mongoose = require('mongoose')
const Supplier = require('./models/Supplier')

mongoose.connect('mongodb://127.0.0.1:27017/jomla-ma')

const suppliers = [
  { name:'شركة النور للأحذية', city:'فاس', phone:'212600000001', description:'متخصصون في أحذية الجملة', products:['صباط رياضي','حذاء رسمي'] },
  { name:'شركة الزهراء للملابس', city:'طنجة', phone:'212600000002', description:'ملابس رجالية ونسائية بالجملة', products:['قميص رجالي','قميص نسائي'] },
  { name:'شركة الكمال', city:'كازا', phone:'212600000003', description:'إكسسوارات وملابس متنوعة', products:['نظارات شمسية','سروال جينز'] }
]

async function seed() {
  await Supplier.deleteMany({})
  await Supplier.insertMany(suppliers)
  console.log('✅ تم إضافة الموردين!')
  mongoose.disconnect()
}

seed()
