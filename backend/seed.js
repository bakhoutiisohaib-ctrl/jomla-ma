const mongoose = require('mongoose')
const Product  = require('./models/Product')

mongoose.connect('mongodb://127.0.0.1:27017/jomla-ma')

const products = [
  { name:'صباط رياضي رجالي', category:'أحذية',    price:90,  city:'فاس',      supplierId:'1', supplierPhone:'212600000001', views:10 },
  { name:'صباط نسائي',        category:'أحذية',    price:120, city:'طنجة',     supplierId:'2', supplierPhone:'212600000002', views:5  },
  { name:'شوز رياضي',         category:'أحذية',    price:80,  city:'كازا',     supplierId:'3', supplierPhone:'212600000003', views:8  },
  { name:'قميص رجالي',        category:'ملابس',     price:60,  city:'فاس',      supplierId:'1', supplierPhone:'212600000001', views:12 },
  { name:'قميص نسائي',        category:'ملابس',     price:70,  city:'طنجة',     supplierId:'2', supplierPhone:'212600000002', views:6  },
  { name:'سروال جينز',        category:'ملابس',     price:100, city:'كازا',     supplierId:'3', supplierPhone:'212600000003', views:9  },
  { name:'نظارات شمسية',      category:'إكسسوارات', price:90,  city:'طنجة',     supplierId:'2', supplierPhone:'212600000002', views:7  },
  { name:'حقيبة يد نسائية',   category:'إكسسوارات', price:150, city:'مراكش',    supplierId:'4', supplierPhone:'212600000004', views:4  }
]

async function seed() {
  await Product.deleteMany({})        // مسح القديم
  await Product.insertMany(products) // إضافة الجديد
  console.log('✅ تم إضافة 8 منتجات!')
  mongoose.disconnect()
}

seed()
