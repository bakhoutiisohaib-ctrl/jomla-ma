// At most one in-memory attempt, scoped to its buyer. No JWT or disk storage.
// Reopening the modal in this tab preserves the frozen request.
import { getSessionToken, subscribeSession } from '../../api/session'
let pending = null
let stopWatching = null
function clear() {
  pending = null
  const stop = stopWatching
  stopWatching = null
  stop?.()
}
export function getAttempt(buyerId) {
  if (pending && pending.buyerId !== buyerId) clear()
  return pending
}
export function beginAttempt(buyerId, body) {
  if (getAttempt(buyerId)) return pending
  const bytes = new Uint8Array(24)
  window.crypto.getRandomValues(bytes)
  const key = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  pending = { buyerId, key, body: Object.freeze({ ...body }) }
  const session = getSessionToken()
  // Keep account/expiry isolation even while the modal is closed. This is an
  // in-memory session guard, not a JWT stored in the attempt or on disk.
  stopWatching = subscribeSession(() => { if (getSessionToken() !== session) clear() })
  return pending
}
export function forgetAttempt(buyerId) {
  if (pending?.buyerId === buyerId) clear()
}
