const express = require('express')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const rateLimit = require('express-rate-limit')
const Supplier = require('../models/Supplier')
const { asyncHandler } = require('../middleware/errorHandler')
const { auditedChange } = require('../utils/audit')
const { recoveryConfiguration, deliverRecoveryMail } = require('../services/recoveryMail')
const { logWarn } = require('../middleware/logger')
const router = express.Router()
const hash = token => crypto.createHash('sha256').update(token).digest('hex')
const eligibleRoles = ['buyer', 'supplier', 'staff']
const invalid = () => Object.assign(new Error('Recovery link is invalid or expired'), { status: 400, code: 'RECOVERY_LINK_INVALID' })
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 'RECOVERY_RATE_LIMITED', message: 'Please try again later' }) }))

router.post('/request', asyncHandler(async (req, res) => {
  let configuration
  try { configuration = recoveryConfiguration() } catch { return res.status(503).json({ code: 'RECOVERY_UNAVAILABLE', message: 'Account recovery is not available yet' }) }
  if (typeof req.body.email !== 'string' || req.body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email.trim())) {
    return res.status(400).json({ code: 'RECOVERY_EMAIL_INVALID', message: 'Enter a valid email address' })
  }
  const started = Date.now()
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hash(token)
  const language = ['ar', 'fr', 'en'].includes(req.body.language) ? req.body.language : 'ar'
  try {
    const user = await Supplier.findOneAndUpdate({
      email: req.body.email.trim().toLowerCase(), role: { $in: eligibleRoles }, isActive: { $ne: false },
      $or: [{ passwordResetSentAt: { $exists: false } }, { passwordResetSentAt: { $lt: new Date(Date.now() - 60000) } }]
    }, [{ $set: { passwordResetHash: tokenHash, passwordResetExpiresAt: new Date(Date.now() + 15 * 60000),
      passwordResetSentAt: new Date(), passwordResetVersion: { $ifNull: ['$tokenVersion', 0] } } }],
    { returnDocument: 'after', updatePipeline: true }).select('email')
    if (user) {
      try {
        await deliverRecoveryMail({ to: user.email, language,
          resetUrl: configuration.origin + '/reset-password#token=' + token })
      } catch {
        await Supplier.updateOne({ _id: user._id, passwordResetHash: tokenHash }, { $unset: { passwordResetHash: '', passwordResetExpiresAt: '', passwordResetVersion: '', passwordResetSentAt: '' } })
        logWarn('RECOVERY_DELIVERY_FAILED')
      }
    }
  } finally {
    // Same response and lower-bound delay for known, unknown, disabled and throttled accounts.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 400 - (Date.now() - started))))
  }
  res.status(202).json({ code: 'RECOVERY_REQUEST_ACCEPTED', message: 'If the account is eligible, recovery instructions will be sent' })
}))

router.post('/reset', asyncHandler(async (req, res) => {
  try { recoveryConfiguration() } catch { return res.status(503).json({ code: 'RECOVERY_UNAVAILABLE', message: 'Account recovery is not available yet' }) }
  const { token, password } = req.body
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ code: 'RECOVERY_LINK_INVALID', message: 'Recovery link is invalid or expired' })
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ code: 'RECOVERY_PASSWORD_INVALID', message: 'Use at least 8 characters and at most 72 UTF-8 bytes' })
  const filter = { passwordResetHash: hash(token), passwordResetExpiresAt: { $gt: new Date() },
    isActive: { $ne: false }, role: { $in: eligibleRoles },
    $expr: { $eq: ['$passwordResetVersion', { $ifNull: ['$tokenVersion', 0] }] } }
  const user = await Supplier.findOne(filter).select('email')
  if (!user) return res.status(400).json({ code: 'RECOVERY_LINK_INVALID', message: 'Recovery link is invalid or expired' })
  const passwordHash = await bcrypt.hash(password, 12)
  try {
    await auditedChange({ action: 'ACCOUNT_PASSWORD_UPDATED', targetType: 'Supplier', targetId: user._id,
      details: { method: 'recovery', sessionsRevoked: true } }, async () => {
      const changed = await Supplier.updateOne({ ...filter, _id: user._id, passwordResetExpiresAt: { $gt: new Date() } }, {
        $set: { password: passwordHash }, $inc: { tokenVersion: 1 },
        $unset: { passwordResetHash: '', passwordResetExpiresAt: '', passwordResetVersion: '' }
      })
      if (changed.modifiedCount !== 1) throw invalid()
    })
  } catch (error) {
    if (error.code === 'RECOVERY_LINK_INVALID') return res.status(400).json({ code: error.code, message: error.message })
    throw error
  }
  try { await deliverRecoveryMail({ to: user.email, language: req.body.language, changed: true }) }
  catch { logWarn('RECOVERY_NOTIFICATION_FAILED') }
  res.json({ code: 'RECOVERY_PASSWORD_CHANGED', message: 'Password changed. Sign in again.' })
}))
module.exports = router
