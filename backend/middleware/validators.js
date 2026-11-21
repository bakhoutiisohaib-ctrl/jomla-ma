const { body, validationResult, param } = require('express-validator')

// Middleware للتحقق من نتائج التحقق
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: '❌ بيانات غير صحيحة',
      errors: errors.array().map(e => ({ field: e.path || e.param, message: e.msg }))
    })
  }
  next()
}

// Drafts may be incomplete; publication is validated against the merged document.
const productFields = [
  body('name').optional().isString().isLength({ max: 160 }),
  body('category').optional().isString().isLength({ max: 100 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('city').optional().isString().isLength({ max: 100 }),
  body('unit').optional().isString().isLength({ min: 1, max: 50 }),
  body('currency').optional().matches(/^[A-Za-z]{3}$/),
  body('country').optional().matches(/^[A-Za-z]{2}$/),
  body('price').optional({ nullable: true }).isFloat({ min: 0 }),
  body('moq').optional().isInt({ min: 1 }),
  body('priceTiers').optional().isArray({ max: 30 }),
  body('priceTiers.*.minQty').isInt({ min: 1 }),
  body('priceTiers.*.maxQty').optional({ nullable: true }).isInt({ min: 1 }),
  body('priceTiers.*.price').isFloat({ min: 0 }),
  body('pricingMode').optional().isIn(['fixed', 'on_request']),
  body('availability').optional().isIn(['unknown', 'in_stock', 'out_of_stock']),
  ...['isDraft', 'inStock', 'hasImageRights', 'publishApproved', 'availabilityConfirmed'].map(field => body(field).optional().custom(v => typeof v === 'boolean').withMessage('يجب إرسال قيمة منطقية صحيحة')),
  body('storeId').optional({ values: 'falsy' }).isMongoId(),
  body('images').optional().isArray({ max: 6 }),
  body('imageUrl').optional().isString(),
  body('imageRights.source').optional().isIn(['owned', 'licensed']),
  body('imageRights.licenseReference').optional().isString().isLength({ max: 1000 }),
  handleValidationErrors
]
const validateProduct = productFields
const validateProductUpdate = productFields

// --- Validators للمورّدين ---
const validateSupplierRegister = [
  body('name')
    .notEmpty().withMessage('الاسم مطلوب')
    .isLength({ min: 2 }).withMessage('الاسم يجب أن يكون حرفين على الأقل'),
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('password')
    .isString().withMessage('كلمة المرور يجب أن تكون نصاً').bail()
    .notEmpty().withMessage('كلمة المرور مطلوبة')
    .isLength({ min: 8 }).withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage('كلمة المرور لا يجب أن تتجاوز 72 بايت؛ الحروف العربية قد تستعمل أكثر من بايت'),
  body('city')
    .notEmpty().withMessage('المدينة مطلوبة'),
  body('phone')
    .notEmpty().withMessage('رقم الهاتف مطلوب')
    .matches(/^[+0-9\s\-()]+$/).withMessage('رقم الهاتف غير صحيح'),
  handleValidationErrors
]

const validateSupplierLogin = [
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('password')
    .notEmpty().withMessage('كلمة المرور مطلوبة'),
  handleValidationErrors
]

// --- Validators للتقييمات ---
const validateReview = [
  body('supplierId')
    .notEmpty().withMessage('معرّف المورد مطلوب'),
  body('stars')
    .notEmpty().withMessage('التقييم مطلوب')
    .isInt({ min: 1, max: 5 }).withMessage('التقييم يجب أن يكون بين 1 و 5'),
  body('comment')
    .optional()
    .isLength({ max: 500 }).withMessage('التعليق لا يجب أن يزيد عن 500 حرف'),
  handleValidationErrors
]

// --- قيم معرّفات باستخدام MongoDB ObjectId ---
const validateMongoId = [
  param('id')
    .matches(/^[0-9a-fA-F]{24}$/).withMessage('معرّف غير صحيح'),
  handleValidationErrors
]

module.exports = {
  validateProduct,
  validateProductUpdate,
  validateSupplierRegister,
  validateSupplierLogin,
  validateReview,
  validateMongoId,
  handleValidationErrors
}
