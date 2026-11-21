const AuditLog = require('../models/AuditLog')

// A durable intent is saved BEFORE the mutation, including on standalone MongoDB.
// This is not a transaction: a pending entry identifies an interrupted operation.
// Never return success until both the change and the completed audit are persisted.
async function auditedChange({ action, targetType, targetId, actor, details = {} }, change) {
  const event = await AuditLog.create({
    action, targetType, targetId, details, phase: 'pending',
    performedBy: actor ? { id: actor.id || actor._id, name: actor.name, email: actor.email, role: actor.role } : undefined
  })
  let result
  try {
    result = await change(event)
  } catch (error) {
    if (error.name === 'VersionError') {
      error = Object.assign(new Error('تغيرت البيانات أثناء العملية؛ أعد تحميلها وحاول مجدداً'), { status: 409 })
    }
    event.phase = 'failed'
    event.failure = String(error.message || 'Operation failed').slice(0, 1000)
    event.completedAt = new Date()
    await event.save()
    throw error
  }
  event.phase = 'completed'
  event.completedAt = new Date()
  await event.save()
  return { result, auditId: event._id }
}

module.exports = { auditedChange }
