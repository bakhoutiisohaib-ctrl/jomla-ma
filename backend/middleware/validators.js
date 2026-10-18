const { body, validationResult, param } = require('express-validator')

// Middleware للتحقق من نتائج التحقق
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: '❌ بيانات غير صحيحة',
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    })
  }
  next()
}

// --- Validators للمنتجات ---
const validateProduct = [
  body('name')
    .notEmpty().withMessage('اسم المنتج مطلوب')
    .isLength({ min: 3 }).withMessage('اسم المنتج يجب أن يكون 3 أحرف على الأقل'),
  body('category')
    .notEmpty().withMessage('الفئة مطلوبة'),
  body('price')
    .notEmpty().withMessage('السعر مطلوب')
    .isNumeric().withMessage('السعر يجب أن يكون رقماً'),
  body('city')
    .notEmpty().withMessage('المدينة مطلوبة'),
  body('supplierPhone')
    .notEmpty().withMessage('رقم المورد مطلوب')
    .matches(/^[+0-9\s\-()]+$/).withMessage('رقم الهاتف غير صحيح'),
  handleValidationErrors
]

const validateProductUpdate = [
  body('name')
    .optional()
    .isLength({ min: 3 }).withMessage('اسم المنتج يجب أن يكون 3 أحرف على الأقل'),
  body('price')
    .optional()
    .isNumeric().withMessage('السعر يجب أن يكون رقماً'),
  body('supplierPhone')
    .optional()
    .matches(/^[+0-9\s\-()]+$/).withMessage('رقم الهاتف غير صحيح'),
  handleValidationErrors
]

// --- Validators للمورّدين ---
const validateSupplierRegister = [
  body('name')
    .notEmpty().withMessage('الاسم مطلوب')
    .isLength({ min: 2 }).withMessage('الاسم يجب أن يكون حرفين على الأقل'),
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('password')
    .notEmpty().withMessage('كلمة المرور مطلوبة')
    .isLength({ min: 6 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
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
