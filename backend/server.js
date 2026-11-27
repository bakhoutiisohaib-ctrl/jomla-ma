// استيراد الأدوات
require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const morgan = require('morgan')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')

// استيراد Middlewares
const { errorHandler } = require('./middleware/errorHandler')
const { requestLogger, logInfo, logWarn } = require('./middleware/logger')
const { initRedis } = require('./middleware/cache')

// إنشاء السيرفر
const app = express()
const mediaRoutes = require('./routes/media')
// Apply cache policy before parsing, rate limiting and authorization, including
// failures which return before the media router itself runs.
app.use(['/uploads', '/api/media'], mediaRoutes.noStore)

// ربط Models
const Product  = require('./models/Product')
const Supplier = require('./models/Supplier')

// إعدادات CORS المحسّنة
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5000')
  .split(',').map(value => value.trim()).filter(Boolean)
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))

app.get('/health/live', (_req, res) => res.json({ status: 'ok' }))
app.get('/health/ready', async (_req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ status: 'unavailable' })
  try {
    await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 2000 })
    res.json({ status: 'ready' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
})

// Logging Middleware
app.use(morgan('combined'))
app.use(requestLogger)

// Security middlewares
app.use(helmet())
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false)
// Classify with the same Express mount rules as the media router, not a URL
// prefix supplied by a client. All media attempts (including denied/invalid
// requests and HEAD) share this bounded budget before JWT/ownership checks.
const mediaBudget = Symbol('mediaBudget')
app.use('/api/media', rateLimit({
  windowMs: 15 * 60 * 1000,
  // Eight visible 12-image catalogs at 15s revalidation use 5856 requests,
  // including their initial fetches. This is a quota, not a capacity guarantee.
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).type('json').end(JSON.stringify({
    code: 'MEDIA_RATE_LIMITED', message: 'طلبات الصور كثيرة، أعد المحاولة لاحقاً.'
  }))
}), (req, _res, next) => { req[mediaBudget] = true; next() })
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  // Only requests already charged by the mounted media limiter skip this
  // commercial budget. Headers/query strings cannot set the private marker.
  skip: req => req[mediaBudget] === true,
  standardHeaders: true,
  legacyHeaders: false
})
app.use(limiter)
app.use(['/api/suppliers/login', '/api/admin/login', '/api/suppliers/register'], rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false
}))

// Middleware للبيانات مع حدود لحجم الـ body
// GHSA-27r3-jxmh-p828: reject encoded bodies before a decompressor is created.
// Current clients send identity bodies; response compression is unaffected.
app.use(express.json({ limit: '100kb', inflate: false }))
app.use(express.urlencoded({ extended: true, limit: '100kb', inflate: false }))
// Only errors from the preceding parsers reach this handler. Keep body contents,
// encoding values and parser internals out of responses, including development.
app.use((error, _req, res, next) => {
  const failures = {
    'encoding.unsupported': [415, 'REQUEST_ENCODING_UNSUPPORTED', 'أرسل بيانات الطلب دون ضغط.'],
    'charset.unsupported': [415, 'REQUEST_CHARSET_UNSUPPORTED', 'ترميز بيانات الطلب غير مدعوم.'],
    'entity.too.large': [413, 'REQUEST_BODY_TOO_LARGE', 'حجم بيانات الطلب يتجاوز الحد المسموح.'],
    'parameters.too.many': [413, 'REQUEST_BODY_TOO_LARGE', 'عدد حقول الطلب يتجاوز الحد المسموح.'],
    'entity.parse.failed': [400, 'REQUEST_BODY_INVALID', 'صيغة بيانات الطلب غير صالحة.'],
    'querystring.parse.rangeError': [400, 'REQUEST_BODY_INVALID', 'صيغة بيانات الطلب غير صالحة.'],
    'request.aborted': [400, 'REQUEST_BODY_INCOMPLETE', 'لم يكتمل إرسال بيانات الطلب.'],
    'request.size.invalid': [400, 'REQUEST_BODY_INVALID', 'حجم بيانات الطلب غير صالح.']
  }
  const failure = failures[error.type]
  if (!failure) return next(error)
  res.status(failure[0]).json({ code: failure[1], message: failure[2] })
})

// /uploads values are opaque storage references, never public file URLs.
app.use('/uploads', (_req, res) => res.status(404).json({ message: 'الصورة غير متاحة' }))
app.use('/api/media', mediaRoutes)


// ملاحظة: اتصال قاعدة البيانات وتهيئة Redis تم نقلهما إلى `start.js`
// ليصبح من السهل استيراد `app` في الاختبارات دون تشغيل السيرفر الكامل.

// أول API — للتأكد أن السيرفر يخدم
app.get('/', (req, res) => {
  res.json({ message: '🇲🇦 Jomla.ma API يخدم!' })
})

// ربط Routes
const productRoutes = require('./routes/products')
app.use('/api/products', productRoutes)
app.use('/api/favorites', require('./routes/favorites'))
app.use('/api/wholesale-opportunities', require('./routes/wholesaleOpportunities'))

const supplierRoutes = require('./routes/suppliers')
app.use('/api/suppliers', supplierRoutes)
app.use('/api/account-recovery', require('./routes/accountRecovery'))

const imageSearchRoutes = require('./routes/imageSearch')
app.use('/api/image-search', imageSearchRoutes)

const aiSearchRoutes = require('./routes/aiSearch')
app.use('/api/ai-search', aiSearchRoutes)

const trackingRoutes = require('./routes/tracking')
app.use('/api/tracking', trackingRoutes)

const reviewRoutes = require('./routes/reviews')
app.use('/api/reviews', reviewRoutes)
app.use('/api/trade-confirmations', require('./routes/tradeConfirmations'))

const productAIRoutes = require('./routes/productAI')
app.use('/api/product-ai', productAIRoutes)

console.log('Mounted productAI route at /api/product-ai')

// Analytics route
const analyticsRoutes = require('./routes/analytics')
app.use('/api/analytics', analyticsRoutes)

// RFQ route (طلب عروض الأسعار بالجملة)
const rfqRoutes = require('./routes/rfq')
app.use('/api/rfq', rfqRoutes)

// Admin & Verification route (لوحة المشرف وتوثيق الموردين)
const adminRoutes = require('./routes/admin')
app.use('/api/admin', adminRoutes)

// Sourcing route (طلبات التوريد للمنتجات غير المتوفرة)
const sourcingRoutes = require('./routes/sourcing')
app.use('/api/sourcing', sourcingRoutes)

// Moderation & Reports route (البلاغات والإشراف)
const reportsRoutes = require('./routes/reports')
app.use('/api/reports', reportsRoutes)

// Independent Stores route (المتاجر التجارية المستقلة)
const storesRoutes = require('./routes/stores')
app.use('/api/stores', storesRoutes)
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/jobs', require('./routes/jobs'))



// Swagger UI
try {
  const swaggerUi = require('swagger-ui-express')
  const swaggerSpec = require('./utils/swagger')
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
  logInfo('🧾 Swagger UI available at /api-docs')
} catch (err) {
  logWarn && logWarn('Swagger not initialized: ' + err.message)
}

// Global Error Handler - يجب أن يكون في النهاية
app.use(errorHandler)

// Export app so tests can import it without starting the HTTP server
module.exports = app
