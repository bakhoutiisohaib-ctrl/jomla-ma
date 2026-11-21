const jwt = require('jsonwebtoken')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error('Missing required env var: JWT_SECRET. Set JWT_SECRET to a strong value.')
}
if (process.env.NODE_ENV === 'production' &&
    (JWT_SECRET.length < 32 || /replace|example|your.secret/i.test(JWT_SECRET))) {
  throw new Error('Production JWT_SECRET must be a unique secret with at least 32 characters.')
}

const authenticate = async (req, res, next) => {
  const authorization = req.headers.authorization || ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return res.status(401).json({ message: 'يرجى تسجيل الدخول' })
  }
  let decoded
  try {
    decoded = jwt.verify(authorization.split(/\s+/)[1], JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return res.status(401).json({ message: 'جلسة غير صالحة أو منتهية؛ يرجى تسجيل الدخول' })
  }
  try {
    if (!decoded.id || !/^[a-f0-9]{24}$/i.test(String(decoded.id))) {
      return res.status(401).json({ message: 'جلسة غير صالحة' })
    }
    const user = await Supplier.findById(decoded.id).select('+tokenVersion')
    if (!user || user.isActive === false || decoded.tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'تم إلغاء الجلسة؛ يرجى تسجيل الدخول' })
    }
    req.supplier = {
      id: String(user._id), _id: String(user._id), name: user.name, email: user.email,
      role: user.role, ownerId: String(user._id), organizationId: null, permissions: []
    }
    if (user.role === 'supplier' || user.role === 'admin') {
      const organization = await Organization.findOne({ ownerSupplierId: user._id })
      req.supplier.permissions = ['all']
      req.supplier.organizationId = organization ? String(organization._id) : null
    } else if (user.role === 'staff') {
      const membership = await Membership.findOne({ userId: user._id, role: 'staff', status: 'active' })
      if (membership) {
        const organization = await Organization.findById(membership.organizationId)
        const owner = organization && await Supplier.findOne({ _id: organization.ownerSupplierId, role: 'supplier', isActive: { $ne: false } })
        if (owner) {
          req.supplier.ownerId = String(owner._id)
          req.supplier.organizationId = String(organization._id)
          req.supplier.permissions = membership.permissions || []
        }
      }
    }
    req.account = user
    next()
  } catch (error) {
    next(error)
  }
}

const generateToken = user => jwt.sign({
  id: user._id || user.id, tokenVersion: user.tokenVersion || 0
}, JWT_SECRET || '', { expiresIn: '7d', algorithm: 'HS256' })

const requireRole = (...roles) => (req, res, next) => {
  if (!req.supplier) return res.status(401).json({ message: 'يرجى تسجيل الدخول' })
  const allowed = Array.isArray(roles[0]) ? roles[0] : roles
  if (!allowed.includes(req.supplier.role)) return res.status(403).json({ message: 'لا تملك الصلاحية المطلوبة' })
  next()
}

const requireAdmin = requireRole('admin')
const requirePermission = (...requiredPermissions) => (req, res, next) => {
  if (!req.supplier) return res.status(401).json({ message: 'يرجى تسجيل الدخول' })
  const { role, organizationId, permissions } = req.supplier
  if (role === 'supplier' || role === 'admin' ||
      (role === 'staff' && organizationId && requiredPermissions.some(permission => permissions.includes(permission)))) return next()
  return res.status(403).json({ message: 'ليس لديك تفويض لهذه العملية' })
}

module.exports = { authenticate, generateToken, requireAdmin, requireRole, requirePermission }
