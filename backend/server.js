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
const { requestLogger, logInfo, logError } = require('./middleware/logger')
const { initRedis } = require('./middleware/cache')

// إنشاء السيرفر
const app = express()

// ربط Models
const Product  = require('./models/Product')
const Supplier = require('./models/Supplier')

// إعدادات CORS المحسّنة
app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}))

// Logging Middleware
app.use(morgan('combined'))
app.use(requestLogger)

// Security middlewares
app.use(helmet())
app.set('trust proxy', 1)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
})
app.use(limiter)

// Middleware للبيانات مع حدود لحجم الـ body
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb' }))

// ملاحظة: اتصال قاعدة البيانات وتهيئة Redis تم نقلهما إلى `start.js`
// ليصبح من السهل استيراد `app` في الاختبارات دون تشغيل السيرفر الكامل.

// أول API — للتأكد أن السيرفر يخدم
app.get('/', (req, res) => {
  res.json({ message: '🇲🇦 Jomla.ma API يخدم!' })
})

// ربط Routes
const productRoutes = require('./routes/products')
app.use('/api/products', productRoutes)

const supplierRoutes = require('./routes/suppliers')
app.use('/api/suppliers', supplierRoutes)

const imageSearchRoutes = require('./routes/imageSearch')
app.use('/api/image-search', imageSearchRoutes)

const aiSearchRoutes = require('./routes/aiSearch')
app.use('/api/ai-search', aiSearchRoutes)

const trackingRoutes = require('./routes/tracking')
app.use('/api/tracking', trackingRoutes)

const reviewRoutes = require('./routes/reviews')
app.use('/api/reviews', reviewRoutes)

const productAIRoutes = require('./routes/productAI')
app.use('/api/product-ai', productAIRoutes)

console.log('Mounted productAI route at /api/product-ai')

// Analytics route
const analyticsRoutes = require('./routes/analytics')
app.use('/api/analytics', analyticsRoutes)

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