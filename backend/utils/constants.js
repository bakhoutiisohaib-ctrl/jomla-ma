// ** Pagination Helper **

// دالة للحصول على معاملات pagination من الـ query
const getPaginationParams = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))
  const skip = (page - 1) * limit

  return { page, limit, skip }
}

// دالة لتنسيق استجابة pagination
const formatPaginationResponse = (items, total, page, limit) => {
  const pages = Math.ceil(total / limit)
  
  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages,
      hasNextPage: page < pages,
      hasPrevPage: page > 1
    }
  }
}

// ** Configuration Constants **

// قائمة المدن المتاحة
const AVAILABLE_CITIES = [
  'فاس',
  'طنجة',
  'كازا',
  'الدار البيضاء',
  'مراكش',
  'أكادير',
  'الرباط',
  'مكناس',
  'تيطوان',
  'القنيطرة',
  'آسفي',
  'سلا'
]

// قائمة الفئات المتاحة
const AVAILABLE_CATEGORIES = [
  'ملابس',
  'أحذية',
  'حقائب',
  'إكسسوارات',
  'إلكترونيات',
  'أثاث',
  'ديكور',
  'مستحضرات عناية',
  'مستحضرات تجميل',
  'أخرى'
]

// حدود الأسعار
const PRICE_LIMITS = {
  MIN: 0,
  MAX: 1000000
}

// حدود الـ pagination
const PAGINATION_LIMITS = {
  MIN_PAGE: 1,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  DEFAULT_LIMIT: 20
}

// حدود النصوص
const TEXT_LIMITS = {
  PRODUCT_NAME_MIN: 3,
  PRODUCT_NAME_MAX: 100,
  DESCRIPTION_MIN: 10,
  DESCRIPTION_MAX: 1000,
  COMMENT_MAX: 500,
  EMAIL_MIN: 5,
  EMAIL_MAX: 100,
  PHONE_MIN: 10,
  PHONE_MAX: 20
}

// حدود التقييمات
const RATING_LIMITS = {
  MIN: 1,
  MAX: 5
}

// صيغة الهاتف الصحيحة
const PHONE_REGEX = /^[+]?[0-9\s\-()]{10,20}$/

// صيغة البريد الإلكتروني الصحيحة
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// مدة صلاحية الـ JWT
const JWT_EXPIRE = '7d'

// عدد جولات تشفير bcrypt
const BCRYPT_ROUNDS = 10

// دالة لتنظيف وتأمين النصوص قبل استخدامها في تعابير RegExp لتفادي ReDoS والـ Injection
const escapeRegex = (text) => {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  // Pagination
  getPaginationParams,
  formatPaginationResponse,
  
  // Helpers
  escapeRegex,

  // Constants
  AVAILABLE_CITIES,
  AVAILABLE_CATEGORIES,
  PRICE_LIMITS,
  PAGINATION_LIMITS,
  TEXT_LIMITS,
  RATING_LIMITS,
  PHONE_REGEX,
  EMAIL_REGEX,
  JWT_EXPIRE,
  BCRYPT_ROUNDS
}
