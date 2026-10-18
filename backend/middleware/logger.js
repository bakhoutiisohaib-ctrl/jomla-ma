const winston = require('winston')
const path = require('path')

// إعدادات الألوان للـ console
const colors = {
  error: '\x1b[31m',   // أحمر
  warn: '\x1b[33m',    // أصفر
  info: '\x1b[36m',    // أزرق فاتح
  debug: '\x1b[35m',   // بنفسجي
  reset: '\x1b[0m'
}

// إنشاء logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      const log = `${timestamp} [${level.toUpperCase()}]: ${message}`
      return stack ? `${log}\n${stack}` : log
    })
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.printf(({ timestamp, level, message, stack }) => {
          const color = colors[level] || ''
          const reset = colors.reset
          const log = `${color}${timestamp} [${level.toUpperCase()}]:${reset} ${message}`
          return stack ? `${log}\n${stack}` : log
        })
      )
    }),
    // File output - all logs
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR || 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File output - errors only
    new winston.transports.File({
      filename: path.join(process.env.LOG_DIR || 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
})

// Middleware لتسجيل الطلبات
const requestLogger = (req, res, next) => {
  const start = Date.now()
  
  res.on('finish', () => {
    const duration = Date.now() - start
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info'
    
    logger[logLevel](
      `${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - IP: ${req.ip}`
    )
  })
  
  next()
}

// دالة لتسجيل الأخطاء
const logError = (error, context = '') => {
  logger.error(`${context} - ${error.message}`, error)
}

// دالة لتسجيل المعلومات
const logInfo = (message) => {
  logger.info(message)
}

// دالة لتسجيل التحذيرات
const logWarn = (message) => {
  logger.warn(message)
}

// دالة لتسجيل التفاصيل
const logDebug = (message) => {
  logger.debug(message)
}

module.exports = {
  logger,
  requestLogger,
  logError,
  logInfo,
  logWarn,
  logDebug
}
