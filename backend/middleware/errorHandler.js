// Global Error Handler Middleware
const { logError } = require('./logger')
const { MAX_IMAGE_BYTES } = require('./upload')

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err)
  logError(err, `خطأ في ${req.method} ${req.path}`)

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: `الصورة تتجاوز الحد المسموح (${MAX_IMAGE_BYTES / (1024 * 1024)}MB)` })
  }

  if (err.name === 'MulterError') return res.status(400).json({ message: 'طلب رفع الملفات غير صحيح' })
  if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) return res.status(401).json({ message: 'جلسة غير صالحة؛ سجل الدخول مجدداً' })

  // أخطاء MongoDB
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: '❌ خطأ في التحقق من البيانات',
      errors: Object.keys(err.errors).map(field => ({
        field,
        message: err.errors[field].message
      }))
    })
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      message: '❌ معرّف غير صحيح'
    })
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'السجل'
    return res.status(409).json({
      message: `❌ ${field} موجود بالفعل`
    })
  }

  // أخطاء عامة
  res.status(err.status || 500).json({
    message: err.status && err.status < 500 ? err.message : 'تعذر تنفيذ الطلب حالياً',
    error: process.env.NODE_ENV === 'development' ? err : {}
  })
}

// Wrapper لمعالجة الأخطاء في async functions
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

module.exports = { errorHandler, asyncHandler }
