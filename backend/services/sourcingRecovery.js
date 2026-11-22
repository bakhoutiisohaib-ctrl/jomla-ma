const Sourcing = require('../models/SourcingRequest')
const offers = require('./sourcingOfferSubmission')
const decisions = require('./sourcingDecision')
async function recover({ limit = 25, now = new Date(), onError } = {}) {
  // Expiry pauses retries, never deletes a journal or releases a commercial lock.
  const held = await Sourcing.updateMany({ 'operation.kind': 'sourcing_decision', 'operation.version': 1, 'operation.phase': 'pending', 'operation.recoveryPausedAt': { $exists: false }, $or: [
    { 'operation.attempts': { $gte: 10 } }, { 'operation.expiresAt': { $lte: now } },
    { 'operation.expiresAt': { $exists: false }, 'operation.startedAt': { $lte: new Date(now.getTime() - 3600000) } }
  ] }, { $set: { 'operation.recoveryPausedAt': now, 'operation.lastErrorCode': 'SOURCING_DECISION_MANUAL_RETRY' } })
  if (held.modifiedCount) require('../middleware/logger').logWarn('SOURCING_DECISION_RETRY_LIMIT_REACHED')
  const rows = await Sourcing.find({ 'operation.kind': { $in: ['sourcing_offer', 'sourcing_decision'] }, 'operation.version': 1, 'operation.phase': 'pending', 'operation.recoveryPausedAt': { $exists: false },
    $or: [{ 'operation.nextAttemptAt': { $lte: now } }, { 'operation.nextAttemptAt': { $exists: false } }] })
    .read('primary').sort({ _id: 1 }).limit(Math.min(100, Math.max(1, Math.floor(Number(limit)) || 25))).select('_id operation.id operation.kind operation.version').lean().maxTimeMS(10000)
  const result = { processed: rows.length, completed: 0, pending: 0 }
  const report = (row, code) => { try { onError?.({ code, sourcingId: String(row._id) }) } catch { /* logging cannot interrupt recovery */ } }
  for (const row of rows) {
    try {
      const handler = row.operation.version === 1 && (row.operation.kind === 'sourcing_offer' ? offers : row.operation.kind === 'sourcing_decision' ? decisions : null)
      if (!handler) throw new Error('Unsupported Sourcing intent')
      const r = await handler.resume(row._id, row.operation.id); result[r.processing ? 'pending' : 'completed']++
      if (r.processing) report(row, r.code || (row.operation.kind === 'sourcing_decision' ? 'SOURCING_DECISION_RETRY' : 'SOURCING_OFFER_RETRY')) }
    catch { result.pending++; report(row, row.operation.kind === 'sourcing_decision' ? 'SOURCING_DECISION_CONFLICT' : 'SOURCING_OFFER_CONFLICT') }
  }
  return result
}
function createSourcingRecovery({ pollMs = 5000, limit = 25, onError } = {}) {
  let stopped = false, started = false, timer, running
  const runOnce = () => stopped ? Promise.resolve({ processed: 0, completed: 0, pending: 0 })
    : (running ||= recover({ limit, onError }).finally(() => { running = null }))
  async function tick() {
    try { await runOnce() } catch { try { onError?.({ code: 'SOURCING_RECOVERY_UNAVAILABLE' }) } catch {} }
    if (!stopped) { timer = setTimeout(tick, Math.max(100, pollMs)); timer.unref?.() }
  }
  return { runOnce, start() { if (!started) { started = true; tick() }; return this }, async stop({ graceMs = 15000 } = {}) {
    stopped = true; clearTimeout(timer); let timeout
    try { return await Promise.race([(running || Promise.resolve()).then(() => ({ drained: true }), () => ({ drained: true })), new Promise(resolve => { timeout = setTimeout(() => resolve({ drained: false }), graceMs) })]) }
    finally { clearTimeout(timeout) }
  } }
}
module.exports = { recover, createSourcingRecovery }
