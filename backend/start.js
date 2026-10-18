// Entrypoint to start the HTTP server and initialize infra (DB, Redis)
require('dotenv').config()
const mongoose = require('mongoose')
const { initRedis } = require('./middleware/cache')
const { logInfo, logError } = require('./middleware/logger')
const app = require('./server')

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jomla-ma'

mongoose.connect(mongoUri)
  .then(() => logInfo('✅ قاعدة البيانات شغالة'))
  .catch((err) => logError(err, 'خطأ في الاتصال بقاعدة البيانات'))

// Initialize Redis only if not disabled
if (!process.env.DISABLE_REDIS) {
  initRedis().catch(() => {})
} else {
  console.log('⚠️ Redis disabled via DISABLE_REDIS environment variable')
}

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  logInfo(`🚀 السيرفر شغال على: http://localhost:${PORT}`)
  logInfo(`📊 Logs: ${process.env.LOG_DIR || 'logs'}/combined.log`)
  logInfo(`⚙️ البيئة: ${process.env.NODE_ENV || 'development'}`)
})
