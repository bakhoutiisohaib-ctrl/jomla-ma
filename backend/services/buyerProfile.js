const contactComplete = value => typeof value.name === 'string' && value.name.trim().length >= 2 &&
  typeof value.city === 'string' && value.city.trim().length > 0 && /^[+0-9\s\-()]{8,20}$/.test(value.phone || '')
function requireBuyerContact(req, res, next) {
  if (req.account?.role === 'buyer' && req.account.profilePending) return res.status(409).json({
    code: 'BUYER_CONTACT_REQUIRED', message: 'أكمل الاسم والمدينة وهاتف التواصل قبل إرسال أول طلب عرض سعر'
  })
  next()
}
module.exports = { contactComplete, requireBuyerContact }
