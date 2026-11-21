const crypto = require('crypto')
const mongoose = require('mongoose')
const BackgroundJob = require('../models/BackgroundJob')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')

const registeredHandlers = new Map()
const PERMISSIONS = ['manage_products', 'manage_store', 'manage_rfq']
const MAX_PAYLOAD_BYTES = 256 * 1024
const INTERNAL_FIELDS = /^(?:__proto__|prototype|constructor|payload|payloadHash|idempotencyKey|password|passwd|secret|token|accessToken|refreshToken|authorization|apiKey|api_key|credentials|headers|stack|stacktrace|workerId|leaseToken)$/i

function queueError(code, message, status = 400) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 30) throw queueError('INVALID_JOB_PAYLOAD', 'بيانات المهمة متداخلة أكثر من المسموح')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || value === undefined || seen.has(value)) {
    throw queueError('INVALID_JOB_PAYLOAD', 'بيانات المهمة يجب أن تكون JSON صالحاً')
  }
  seen.add(value)
  let result
  if (Array.isArray(value)) result = value.map(item => canonical(item, seen, depth + 1))
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw queueError('INVALID_JOB_PAYLOAD', 'حوّل المعرّفات والتواريخ إلى نصوص في بيانات المهمة')
    }
    result = Object.create(null)
    for (const key of Object.keys(value).sort()) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw queueError('INVALID_JOB_PAYLOAD', 'حقل غير مسموح في بيانات المهمة')
      result[key] = canonical(value[key], seen, depth + 1)
    }
  }
  seen.delete(value)
  return result
}

function boundedInteger(value, fallback, min, max, name) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < min || value > max) throw queueError('INVALID_JOB_OPTIONS', name + ' غير صحيح')
  return value
}

function validId(id) { return /^[a-f0-9]{24}$/i.test(String(id || '')) }

// This is a server-only API. There is deliberately no HTTP enqueue endpoint.
async function enqueueJob(options) {
  const { type, ownerId, requestedBy, organizationId = null, requiredPermission = 'manage_products', idempotencyKey } = options || {}
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(type || '') || !validId(ownerId) ||
      (requestedBy && !validId(requestedBy)) || (organizationId && !validId(organizationId)) ||
      !PERMISSIONS.includes(requiredPermission) || typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200) {
    throw queueError('INVALID_JOB_OPTIONS', 'نوع المهمة ومالكها ومفتاح منع التكرار مطلوبة')
  }
  const payload = canonical(options.payload)
  const serialized = JSON.stringify(payload)
  if (Buffer.byteLength(serialized) > MAX_PAYLOAD_BYTES) throw queueError('JOB_PAYLOAD_TOO_LARGE', 'بيانات المهمة تتجاوز الحد المسموح', 413)
  const fingerprint = JSON.stringify({ payload, organizationId: organizationId ? String(organizationId) : null, requiredPermission })
  const payloadHash = crypto.createHash('sha256').update(fingerprint).digest('hex')
  const identity = { ownerId, type, idempotencyKey }
  const maxAttempts = boundedInteger(options.maxAttempts, 3, 1, 10, 'maxAttempts')
  const timeoutMs = boundedInteger(options.timeoutMs, 120000, 10, 900000, 'timeoutMs')
  const backoffMs = boundedInteger(options.backoffMs, 1000, 0, 60000, 'backoffMs')
  await BackgroundJob.init()
  let job, created = false
  try {
    job = await BackgroundJob.create({ ...identity, requestedBy, organizationId, requiredPermission, payload, payloadHash, maxAttempts, timeoutMs, backoffMs })
    created = true
  } catch (error) {
    if (error.code !== 11000) throw error
    job = await BackgroundJob.findOne(identity).select('+payloadHash')
    if (!job) throw error
  }
  if (job.payloadHash !== payloadHash) throw queueError('IDEMPOTENCY_CONFLICT', 'استُخدم مفتاح المهمة نفسه مع بيانات مختلفة', 409)
  return { job, created }
}

// Result defense in depth: handlers must return only their documented public
// result, never provider responses, raw errors or configuration objects.
function safeResult(value, depth = 0) {
  if (depth > 12 || value === undefined) return null
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    if (/\bBearer\s+\S+|\bsk-[a-zA-Z0-9_-]{12,}|\b(?:mongodb(?:\+srv)?|redis):\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\n\s+at\s+\S+/i.test(value)) return '[redacted]'
    return value.slice(0, 20000)
  }
  if (Array.isArray(value)) return value.slice(0, 200).map(item => safeResult(item, depth + 1))
  if (value instanceof mongoose.Types.ObjectId) return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object' || value instanceof Error) return null
  const output = {}
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (INTERNAL_FIELDS.test(key) || /(?:password|secret|token|api[_-]?key|authorization|credential|stack)/i.test(key)) continue
    output[key] = safeResult(item, depth + 1)
  }
  return output
}

function publicJob(job) {
  const j = typeof job.toObject === 'function' ? job.toObject() : job
  return {
    id: String(j._id), type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts,
    createdAt: j.createdAt, updatedAt: j.updatedAt, startedAt: j.startedAt || null,
    finishedAt: j.finishedAt || null, nextRunAt: ['pending', 'retry_wait'].includes(j.status) ? j.nextRunAt : null,
    result: j.status === 'succeeded' ? safeResult(j.result) : null,
    error: j.error?.code ? publicFailure(j.error.code) : null
  }
}

function publicFailure(code) {
  const errors = {
    JOB_TIMEOUT: 'تجاوزت المهمة المهلة المسموحة',
    WORKER_LEASE_EXPIRED: 'توقف تنفيذ المهمة قبل اكتمالها',
    JOB_REJECTED: 'تعذر تنفيذ المهمة بالبيانات أو الصلاحيات الحالية',
    PROVIDER_UNAVAILABLE: 'الخدمة المطلوبة غير متاحة حالياً',
    JOB_FAILED: 'تعذر إكمال المهمة'
  }
  const safeCode = Object.hasOwn(errors, code) ? code : 'JOB_FAILED'
  return { code: safeCode, message: errors[safeCode] }
}

function registerHandlers(handlers) {
  for (const [type, handler] of Object.entries(handlers || {})) {
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(type) || typeof handler !== 'function') throw new TypeError('Invalid job handler')
    registeredHandlers.set(type, handler)
  }
}

// Call at handler entry and again immediately before a lasting side effect.
// Enqueue-time permissions alone cannot authorize work that waited in a queue.
async function assertJobPermission(job) {
  const rejected = () => {
    const error = queueError('JOB_REJECTED', 'لم يعد تنفيذ المهمة مسموحاً', 403)
    error.retryable = false
    return error
  }
  if (!job || !validId(job.ownerId) || !PERMISSIONS.includes(job.requiredPermission)) throw rejected()
  const owner = await Supplier.findOne({ _id: job.ownerId, isActive: { $ne: false }, role: { $in: ['supplier', 'admin'] } })
  if (!owner) throw rejected()
  const requesterId = job.requestedBy || job.ownerId
  if (!validId(requesterId)) throw rejected()
  const requester = String(requesterId) === String(owner._id) ? owner :
    await Supplier.findOne({ _id: requesterId, isActive: { $ne: false } })
  if (!requester) throw rejected()
  let organization = null
  if (job.organizationId) {
    organization = await Organization.findOne({ _id: job.organizationId, ownerSupplierId: owner._id })
    if (!organization) throw rejected()
  }
  if (String(requester._id) === String(owner._id) || requester.role === 'admin') return { owner, requester, organization }
  if (requester.role !== 'staff' || !organization) throw rejected()
  const membership = await Membership.findOne({ userId: requester._id, organizationId: organization._id,
    role: 'staff', status: 'active', permissions: job.requiredPermission })
  if (!membership) throw rejected()
  return { owner, requester, organization, membership }
}

function backoff(job) { return Math.min(3600000, job.backoffMs * (2 ** Math.max(0, job.attempts - 1))) }

async function recoverExpiredJobs({ types, now = new Date(), limit = 100 } = {}) {
  const filter = { status: 'running', leaseExpiresAt: { $lte: now } }
  if (types) filter.type = { $in: types }
  const expired = await BackgroundJob.find(filter).select('+leaseToken').limit(limit).lean()
  let recovered = 0
  for (const job of expired) {
    const terminal = job.attempts >= job.maxAttempts
    const result = await BackgroundJob.updateOne({ _id: job._id, status: 'running', leaseToken: job.leaseToken, leaseExpiresAt: { $lte: now } }, {
      $set: { status: terminal ? 'failed' : 'retry_wait', nextRunAt: new Date(now.getTime() + backoff(job)),
        finishedAt: terminal ? now : null, result: null, error: publicFailure('WORKER_LEASE_EXPIRED') },
      $unset: { workerId: 1, leaseToken: 1, leaseExpiresAt: 1, attemptDeadline: 1 }
    })
    recovered += result.modifiedCount
  }
  return recovered
}

async function claimNextJob({ workerId, types, leaseMs = 30000, now = new Date() }) {
  if (typeof workerId !== 'string' || !workerId || !Array.isArray(types) || !types.length) return null
  await recoverExpiredJobs({ types, now })
  // MongoDB serializes this update atomically across all worker processes.
  const token = crypto.randomUUID()
  const job = await BackgroundJob.findOneAndUpdate({ status: { $in: ['pending', 'retry_wait'] }, type: { $in: types }, nextRunAt: { $lte: now },
    $expr: { $lt: ['$attempts', '$maxAttempts'] } }, [{ $set: {
      status: 'running', workerId, leaseToken: token, attempts: { $add: ['$attempts', 1] },
      startedAt: now, finishedAt: null, error: null,
      attemptDeadline: { $add: [now, '$timeoutMs'] },
      leaseExpiresAt: { $add: [now, { $min: [leaseMs, '$timeoutMs'] }] }
    } }], { returnDocument: 'after', updatePipeline: true, sort: { nextRunAt: 1, createdAt: 1, _id: 1 } }).select('+payload +leaseToken +leaseExpiresAt +attemptDeadline +workerId')
  return job
}

async function heartbeatJob(job, leaseMs = 30000, now = new Date()) {
  const result = await BackgroundJob.updateOne({ _id: job._id, status: 'running', leaseToken: job.leaseToken,
    leaseExpiresAt: { $gt: now }, attemptDeadline: { $gt: now } }, {
    $set: { leaseExpiresAt: new Date(Math.min(now.getTime() + leaseMs, new Date(job.attemptDeadline).getTime())) }
  })
  return result.matchedCount === 1
}

async function completeJob(job, result, now = new Date()) {
  const saved = await BackgroundJob.updateOne({ _id: job._id, status: 'running', leaseToken: job.leaseToken, leaseExpiresAt: { $gt: now }, attemptDeadline: { $gt: now } }, {
    $set: { status: 'succeeded', result: safeResult(result), error: null, finishedAt: now },
    $unset: { workerId: 1, leaseToken: 1, leaseExpiresAt: 1, attemptDeadline: 1 }
  })
  return saved.modifiedCount === 1
}

async function failJob(job, error, now = new Date()) {
  // A timed out execution may set the failure exactly at its deadline. A lease
  // token still fences it from a replacement worker after recovery.
  const terminal = error?.retryable === false || job.attempts >= job.maxAttempts
  const saved = await BackgroundJob.updateOne({ _id: job._id, status: 'running', leaseToken: job.leaseToken }, {
    $set: { status: terminal ? 'failed' : 'retry_wait', result: null, error: publicFailure(error?.code),
      nextRunAt: new Date(now.getTime() + backoff(job)), finishedAt: terminal ? now : null },
    $unset: { workerId: 1, leaseToken: 1, leaseExpiresAt: 1, attemptDeadline: 1 }
  })
  return saved.modifiedCount === 1
}

function createWorker(options = {}) {
  const handlers = options.handlers ? new Map(Object.entries(options.handlers)) : new Map(registeredHandlers)
  for (const [type, handler] of handlers) if (!/^[a-z][a-z0-9_]{0,79}$/.test(type) || typeof handler !== 'function') throw new TypeError('Invalid job handler')
  const types = [...handlers.keys()]
  const workerId = options.workerId || `worker-${process.pid}-${crypto.randomUUID()}`
  const leaseMs = boundedInteger(options.leaseMs, 30000, 30, 900000, 'leaseMs')
  const pollMs = boundedInteger(options.pollMs, 1000, 10, 60000, 'pollMs')
  const concurrency = boundedInteger(options.concurrency, 2, 1, 20, 'concurrency')
  const active = new Set(), wakeups = new Set()
  let stopping = false, started = false, pumps = []
  const report = error => { if (typeof options.onError === 'function') options.onError(publicFailure(error?.code)) }

  async function runOnce() {
    if (stopping) return false
    const job = await claimNextJob({ workerId, types, leaseMs })
    if (!job) return false
    const controller = new AbortController()
    const state = { controller, abandoned: false, heartbeatTimer: null, cancel: null, done: null, resolveDone: null }
    state.done = new Promise(resolve => { state.resolveDone = resolve })
    const abandoned = new Promise((resolve, reject) => { state.cancel = () => {
      state.abandoned = true
      controller.abort()
      clearInterval(state.heartbeatTimer)
      reject(queueError('JOB_LEASE_LOST', 'Job lease lost'))
    } })
    active.add(state)
    let timer
    const heartbeat = async () => {
      if (state.abandoned || controller.signal.aborted) return false
      if (Date.now() >= new Date(job.attemptDeadline).getTime()) return false
      try {
        const alive = await heartbeatJob(job, leaseMs)
        if (!alive) state.cancel()
        return alive
      } catch (error) { report(error); state.cancel(); return false }
    }
    state.heartbeatTimer = setInterval(heartbeat, Math.max(10, Math.floor(leaseMs / 3)))
    try {
      const remaining = Math.max(1, new Date(job.attemptDeadline).getTime() - Date.now())
      const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => {
        controller.abort()
        reject(queueError('JOB_TIMEOUT', 'Job timed out'))
      }, remaining) })
      const execution = Promise.resolve().then(() => handlers.get(job.type)(job.payload, { job, signal: controller.signal, heartbeat }))
      const result = await Promise.race([execution, timeout, abandoned])
      if (!state.abandoned) await completeJob(job, result)
    } catch (error) {
      if (!state.abandoned) await failJob(job, error)
    } finally {
      clearTimeout(timer)
      clearInterval(state.heartbeatTimer)
      active.delete(state)
      state.resolveDone()
    }
    return true
  }

  function pause() { return new Promise(resolve => {
    const done = () => { clearTimeout(timer); wakeups.delete(done); resolve() }
    const timer = setTimeout(done, pollMs)
    wakeups.add(done)
  }) }
  async function pump() {
    while (!stopping) {
      try { if (!await runOnce() && !stopping) await pause() }
      catch (error) { report(error); if (!stopping) await pause() }
    }
  }
  function start() {
    if (started) return api
    if (!types.length) throw new Error('No background job handlers registered')
    started = true
    pumps = Array.from({ length: concurrency }, () => pump())
    return api
  }
  async function stop({ graceMs = 15000 } = {}) {
    stopping = true
    for (const wake of wakeups) wake()
    let timer
    const drained = Promise.allSettled([...pumps, ...[...active].map(state => state.done)])
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, graceMs)) })
    const finished = await Promise.race([drained.then(() => true), timeout])
    clearTimeout(timer)
    if (!finished) {
      // Leave unfinished attempts under their existing leases. Another process
      // recovers them after expiry; this worker must never publish late output.
      for (const state of active) {
        state.cancel()
      }
    }
    return { drained: finished, active: active.size }
  }
  const api = { start, runOnce, stop, workerId }
  return api
}

module.exports = { enqueueJob, publicJob, safeResult, registerHandlers, assertJobPermission, createWorker, claimNextJob, heartbeatJob, completeJob, failJob, recoverExpiredJobs }
