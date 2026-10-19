const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error('Missing required env var: JWT_SECRET. Set JWT_SECRET to a strong value.')
}

// Middleware للمصادقة باستخدام JWT
const authenticate = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]

    if (!token) {
      return res.status(401).json({
        message: '❌ توكن مفقود - يرجى تسجيل الدخول'
      })
    }

    if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
      throw new Error('Missing JWT_SECRET')
    }
    const decoded = jwt.verify(token, JWT_SECRET)
    req.supplier = decoded
    next()
  } catch (err) {
    return res.status(403).json({
      message: '❌ توكن غير صحيح أو منتهي الصلاحية',
      error: err.message
    })
  }
}

// دالة لإنشاء JWT token
const generateToken = (supplier) => {
  return jwt.sign(
    {
      id: supplier._id,
      email: supplier.email,
      name: supplier.name,
      role: supplier.role || 'supplier'
    },
    JWT_SECRET || '',
    { expiresIn: '7d' }
  )
}

// Middleware للتحقق من صلاحية المشرف (Admin)
const requireAdmin = async (req, res, next) => {
  if (!req.supplier) {
    return res.status(401).json({ message: '❌ غير مصرح - يرجى تسجيل الدخول' })
  }

  if (req.supplier.role === 'admin') {
    return next()
  }

  // تحقق إضافي من قاعدة البيانات في حال تم تحديث الدور
  try {
    const Supplier = require('../models/Supplier')
    const s = await Supplier.findById(req.supplier.id)
    if (s && s.role === 'admin') {
      req.supplier.role = 'admin'
      return next()
    }
  } catch (err) {
    // continue to 403
  }

  return res.status(403).json({
    message: '❌ صلاحية المشرف مطلوبة (Admin access required)'
  })
}

module.exports = { authenticate, generateToken, requireAdmin }

