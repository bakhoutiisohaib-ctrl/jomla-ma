# دليل الـ API - Jomla.ma 🇲🇦

## المصادقة والأمان

جميع الطلبات التي تتطلب المصادقة تحتاج على `Authorization` header بـ JWT token:

```
Authorization: Bearer <your_token_here>
```

---

## المورّدين (Suppliers)

### تسجيل مورد جديد
```
POST /api/suppliers/register
Content-Type: application/json

{
  "name": "متجر المورد",
  "email": "supplier@example.com",
  "password": "password123",
  "city": "فاس",
  "phone": "+212612345678",
  "description": "وصف المتجر"
}

Response:
{
  "message": "✅ تم تسجيل المورد بنجاح",
  "token": "eyJhbGc...",
  "supplier": { ... }
}
```

### تسجيل الدخول
```
POST /api/suppliers/login
Content-Type: application/json

{
  "email": "supplier@example.com",
  "password": "password123"
}

Response:
{
  "message": "✅ تم تسجيل الدخول بنجاح",
  "token": "eyJhbGc...",
  "supplier": { ... }
}
```

### جيب جميع المورّدين
```
GET /api/suppliers

Response:
[
  {
    "_id": "...",
    "name": "المتجر",
    "city": "فاس",
    "phone": "+212612345678",
    "description": "...",
    "products": ["pid1", "pid2"]
  }
]
```

### جيب مورد معين
```
GET /api/suppliers/:id

Response:
{
  "_id": "...",
  "name": "المتجر",
  ...
}
```

### جيب منتجات مورد
```
GET /api/suppliers/:id/products

Response:
[
  { product1 },
  { product2 }
]
```

---

## المنتجات (Products)

### جيب المنتجات (مع pagination)
```
GET /api/products?page=1&limit=50

Response:
{
  "products": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1000,
    "pages": 20
  }
}
```

### إضافة منتج جديد (يتطلب المصادقة)
```
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "حذاء رياضي",
  "category": "أحذية",
  "price": 250,
  "city": "فاس",
  "supplierPhone": "+212612345678",
  "description": "حذاء رياضي عالي الجودة"
}

Response:
{
  "message": "✅ تم إضافة المنتج بنجاح",
  "product": { ... }
}
```

### تحديث منتج (يتطلب المصادقة)
```
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "حذاء رياضي محدّث",
  "price": 300
}

Response:
{
  "message": "✅ تم تحديث المنتج بنجاح",
  "product": { ... }
}
```

### حذف منتج (يتطلب المصادقة)
```
DELETE /api/products/:id
Authorization: Bearer <token>

Response:
{
  "message": "✅ تم حذف المنتج بنجاح"
}
```

### البحث الذكي
```
GET /api/products/search?q=حذاء رخيص في فاس&page=1&limit=40

Response:
[
  { product1 },
  { product2 },
  ...
]
```

---

## البحث الذكي (AI Search)

### البحث باستخدام Claude AI
```
POST /api/ai-search
Content-Type: application/json

{
  "query": "أريد أحذية رخيصة الثمن",
  "city": "فاس",
  "category": "أحذية"
}

Response:
{
  "message": "✅ البحث نجح",
  "products": [ ... ],
  "aiResponse": {
    "suggestions": ["حذاء رياضي", "صباط كلاسيك"],
    "message": "حذيتلك على الأحذية الموجودة..."
  }
}
```

---

## البحث بالصور

### البحث عن منتج باستخدام صورة
```
POST /api/image-search
Content-Type: multipart/form-data

form_data:
  image: <image_file>

Response:
{
  "message": "✅ تم تحليل الصورة",
  "labels": ["صباط", "أحذية"],
  "products": [ ... ],
  "description": "وجدنا 5 منتج مشابه لـ: صباط، أحذية"
}
```

---

## تحسين الصورة والوصف (Product AI)

### تحسين الصورة وتوليد وصف احترافي (يتطلب المصادقة)
```
POST /api/product-ai/enhance
Authorization: Bearer <token>
Content-Type: multipart/form-data

form_data:
  image: <image_file>
  productName: "حذاء رياضي أسود"
  category: "أحذية"

Response:
{
  "message": "✅ تم تحسين الصورة وتوليد الوصف",
  "originalImage": "https://...",
  "enhancedImage": "https://...",
  "publicId": "jomla-ma/...",
  "aiData": {
    "title": "حذاء رياضي أسود خفيف الوزن",
    "description": "حذاء رياضي عالي الجودة...",
    "keywords": ["حذاء", "رياضة", "أسود"],
    "suggestedPrice": "200-350 درهم",
    "tips": "صور الحذاء من جوانب مختلفة..."
  },
  "similarImages": [ ... ]
}
```

---

## التقييمات (Reviews)

### جيب تقييمات مورد
```
GET /api/reviews/:supplierId?page=1&limit=20

Response:
{
  "reviews": [
    {
      "supplierId": "...",
      "stars": 5,
      "comment": "ممتاز جداً",
      "date": "2026-04-21T..."
    }
  ],
  "avg": 4.5,
  "total": 10,
  "pagination": { ... }
}
```

### إضافة تقييم
```
POST /api/reviews
Content-Type: application/json

{
  "supplierId": "...",
  "stars": 5,
  "comment": "تجربة رائعة جداً"
}

Response:
{
  "message": "✅ شكراً على تقييمك!",
  "review": { ... }
}
```

---

## التتبع (Tracking)

### تسجيل مشاهدة منتج
```
POST /api/tracking/view/:id

Response:
{
  "message": "✅ تم تسجيل المشاهدة",
  "views": 42
}
```

### جيب المنتجات الأكثر مشاهدة
```
GET /api/tracking/trending?limit=8

Response:
[ ... ]
```

---

## الأخطاء (Error Handling)

جميع الأخطاء ترجع بصيغة موحدة:

```json
{
  "message": "❌ رسالة الخطأ",
  "errors": [
    {
      "field": "email",
      "message": "البريد الإلكتروني غير صحيح"
    }
  ]
}
```

### رموز الأخطاء الشائعة:
- `400` - بيانات غير صحيحة
- `401` - غير مصرح (توكن مفقود أو غير صحيح)
- `403` - ممنوع (ليس لديك صلاحية)
- `404` - غير موجود
- `409` - تضارب (البريد موجود بالفعل)
- `500` - خطأ في السيرفر

---

## المصادقة والحماية ✅

✔️ جميع كلمات المرور مشفرة بـ bcrypt
✔️ المصادقة بـ JWT tokens (صلاحية 7 أيام)
✔️ التحقق من البيانات المدخلة
✔️ معالجة شاملة للأخطاء
✔️ CORS محمي
✔️ التحقق من الصلاحيات (يمكن المورد فقط تعديل منتجاته)
