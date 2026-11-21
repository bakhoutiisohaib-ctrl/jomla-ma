process.env.JWT_SECRET = 'jobs-test-secret-with-sufficient-length'
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const BackgroundJob = require('../models/BackgroundJob')
const Supplier = require('../models/Supplier')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const { generateToken } = require('../middleware/auth')
const { errorHandler } = require('../middleware/errorHandler')
const { enqueueJob, publicJob, createWorker, claimNextJob, heartbeatJob, completeJob, recoverExpiredJobs, registerHandlers, assertJobPermission } = require('../services/jobQueue')

const app = express()
app.use(express.json())
app.use('/api/jobs', require('../routes/jobs'))
app.use(errorHandler)
let mongo, supplier, otherSupplier, staff, buyer, admin, organization, membership
const tokens = {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const auth = who => ({ Authorization: 'Bearer ' + tokens[who] })
let sequence = 0
const enqueue = (extra = {}) => enqueueJob({ type: 'ai_product_draft', ownerId: supplier._id, requestedBy: supplier._id,
  organizationId: organization._id, requiredPermission: 'manage_products', payload: { mediaId: 'local-media-fixture' },
  idempotencyKey: 'job-' + (++sequence), ...extra })

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  await BackgroundJob.init()
  const create = (name, role) => Supplier.create({ name, role, email: role + name + '@jobs.test', password: 'fixture-only' })
  supplier = await create('owner', 'supplier'); otherSupplier = await create('other', 'supplier')
  staff = await create('staff', 'staff'); buyer = await create('buyer', 'buyer'); admin = await create('admin', 'admin')
  organization = await Organization.create({ ownerSupplierId: supplier._id, name: 'Organization' })
  membership = await Membership.create({ organizationId: organization._id, userId: staff._id, invitedEmail: staff.email,
    role: 'staff', permissions: ['manage_products'], status: 'active', invitedBy: supplier._id })
  Object.assign(tokens, Object.fromEntries(Object.entries({ supplier, otherSupplier, staff, buyer, admin }).map(([name, user]) => [name, generateToken(user)])))
})
beforeEach(async () => {
  await BackgroundJob.deleteMany({})
  await Membership.updateOne({ _id: membership._id }, { $set: { status: 'active', permissions: ['manage_products'] } })
  await Supplier.updateOne({ _id: admin._id }, { $set: { role: 'admin' } })
  await Supplier.updateOne({ _id: supplier._id }, { $set: { role: 'supplier', isActive: true } })
  await Supplier.updateOne({ _id: staff._id }, { $set: { role: 'staff', isActive: true } })
})
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

describe('durable MongoDB job queue', () => {
  test('concurrent canonical idempotency is scoped by tenant and rejects changed payload', async () => {
    const options = { idempotencyKey: 'same-operation', payload: { b: 2, a: { z: 1, y: 2 } } }
    const results = await Promise.all(Array.from({ length: 12 }, () => enqueue(options)))
    expect(results.filter(result => result.created)).toHaveLength(1)
    expect(new Set(results.map(result => String(result.job._id))).size).toBe(1)
    const ordered = await enqueue({ ...options, payload: { a: { y: 2, z: 1 }, b: 2 } })
    expect(ordered.created).toBe(false)
    await expect(enqueue({ ...options, payload: { b: 3 } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    await expect(enqueue({ ...options, requiredPermission: 'manage_rfq' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await enqueue({ ...options, ownerId: otherSupplier._id, organizationId: null })
    expect(await BackgroundJob.countDocuments()).toBe(2)
  })

  test('validates internal enqueue input and bounds payload and execution settings', async () => {
    for (const options of [{ payload: undefined }, { payload: { invalid: undefined } }, { payload: { invalid: Infinity } },
      { type: 'arbitrary.script.js' }, { ownerId: 'invalid' }, { idempotencyKey: '' }, { requiredPermission: 'admin' },
      { maxAttempts: 0 }, { timeoutMs: 1 }, { backoffMs: -1 }]) await expect(enqueue(options)).rejects.toMatchObject({ status: 400 })
    const cyclic = {}; cyclic.self = cyclic
    await expect(enqueue({ payload: cyclic })).rejects.toMatchObject({ code: 'INVALID_JOB_PAYLOAD' })
    await expect(enqueue({ payload: { oversized: 'x'.repeat(256 * 1024) } })).rejects.toMatchObject({ status: 413 })
  })

  test('atomic claiming gives exactly one worker the lease and fences stale results', async () => {
    const { job } = await enqueue()
    const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => claimNextJob({ workerId: 'worker-' + i, types: ['ai_product_draft'] })))
    const winners = claims.filter(Boolean)
    expect(winners).toHaveLength(1)
    expect(winners[0].attempts).toBe(1)
    expect(String(winners[0]._id)).toBe(String(job._id))
    expect(await completeJob({ ...winners[0].toObject(), leaseToken: 'stolen' }, { forged: true })).toBe(false)
    expect(await completeJob(winners[0], { draft: { name: 'مراجعة المورد مطلوبة' } })).toBe(true)
    expect(await completeJob(winners[0], { late: true })).toBe(false)
    expect((await BackgroundJob.findById(job._id)).status).toBe('succeeded')
  })

  test('recovers an expired crashed process with backoff and rejects its late completion', async () => {
    const { job } = await enqueue({ backoffMs: 100, maxAttempts: 2 })
    const now = new Date(Date.now() + 100)
    const first = await claimNextJob({ workerId: 'crashed-process', types: ['ai_product_draft'], leaseMs: 100, now })
    const expiredAt = new Date(now.getTime() + 101)
    expect(await recoverExpiredJobs({ now: expiredAt })).toBe(1)
    expect((await BackgroundJob.findById(job._id)).status).toBe('retry_wait')
    expect(await completeJob(first, { stale: true }, expiredAt)).toBe(false)
    expect(await claimNextJob({ workerId: 'replacement', types: ['ai_product_draft'], now: new Date(expiredAt.getTime() + 99) })).toBe(null)
    const second = await claimNextJob({ workerId: 'replacement', types: ['ai_product_draft'], now: new Date(expiredAt.getTime() + 101) })
    expect(second.attempts).toBe(2)
    expect(await completeJob(first, { stale: true })).toBe(false)
    expect(await completeJob(second, { recovered: true }, new Date(expiredAt.getTime() + 102))).toBe(true)
  })

  test('a crash on the final attempt becomes terminal instead of retrying forever', async () => {
    const { job } = await enqueue({ maxAttempts: 1 })
    const now = new Date(Date.now() + 100)
    await claimNextJob({ workerId: 'crashed-final', types: ['ai_product_draft'], leaseMs: 100, now })
    await recoverExpiredJobs({ now: new Date(now.getTime() + 101) })
    const failed = await BackgroundJob.findById(job._id)
    expect(failed.status).toBe('failed')
    expect(failed.error.code).toBe('WORKER_LEASE_EXPIRED')
    expect(await claimNextJob({ workerId: 'restart', types: ['ai_product_draft'], now: new Date(now.getTime() + 10000) })).toBe(null)
  })

  test('heartbeat renews only a live owner lease and cannot extend execution timeout', async () => {
    await enqueue({ timeoutMs: 500 })
    const now = new Date(Date.now() + 100)
    const claim = await claimNextJob({ workerId: 'heartbeat', types: ['ai_product_draft'], leaseMs: 100, now })
    expect(await heartbeatJob(claim, 1000, new Date(now.getTime() + 50))).toBe(true)
    const renewed = await BackgroundJob.findById(claim._id).select('+leaseExpiresAt')
    expect(renewed.leaseExpiresAt.getTime()).toBe(now.getTime() + 500)
    expect(await heartbeatJob({ ...claim.toObject(), leaseToken: 'other' }, 100)).toBe(false)
    expect(await heartbeatJob(claim, 1000, new Date(now.getTime() + 501))).toBe(false)
  })

  test('worker retries transient failures, stores safe results and hides raw provider errors', async () => {
    const { job } = await enqueue({ backoffMs: 0 })
    let attempts = 0
    const worker = createWorker({ handlers: { ai_product_draft: async () => {
      if (++attempts === 1) { const error = new Error('provider secret should never escape'); error.code = 'raw_provider_failure'; throw error }
      return { draft: { name: 'منتج', price: null }, apiKey: 'secret-key', nested: { password: 'private', token: 'private', ok: true }, stack: 'trace', secretUrl: 'private' }
    } } })
    expect(await worker.runOnce()).toBe(true)
    let saved = await BackgroundJob.findById(job._id)
    expect(saved.status).toBe('retry_wait')
    expect(saved.error.message).not.toMatch(/provider|secret/)
    expect(await worker.runOnce()).toBe(true)
    saved = await BackgroundJob.findById(job._id)
    expect(saved.status).toBe('succeeded')
    expect(saved.attempts).toBe(2)
    expect(saved.result).toEqual({ draft: { name: 'منتج', price: null }, nested: { ok: true } })
    const output = publicJob(saved)
    expect(output.id).toBe(String(job._id))
    expect(output).not.toHaveProperty('ownerId')
    expect(output).not.toHaveProperty('payload')
    expect(output).not.toHaveProperty('leaseToken')
  })

  test('permanent handler rejection stops retries and preserves a generic public failure', async () => {
    const { job } = await enqueue({ backoffMs: 0 })
    const worker = createWorker({ handlers: { ai_product_draft: async () => {
      const error = new Error('raw stack private'); error.code = 'JOB_REJECTED'; error.retryable = false; throw error
    } } })
    await worker.runOnce()
    const saved = await BackgroundJob.findById(job._id)
    expect(saved.status).toBe('failed')
    expect(saved.attempts).toBe(1)
    expect(saved.error.code).toBe('JOB_REJECTED')
    expect(await worker.runOnce()).toBe(false)
  })

  test('timeout aborts the handler and late work cannot publish over failure', async () => {
    const { job } = await enqueue({ timeoutMs: 30, maxAttempts: 1 })
    let signal
    const worker = createWorker({ leaseMs: 300, handlers: { ai_product_draft: async (payload, context) => {
      signal = context.signal
      await delay(100)
      return { late: true }
    } } })
    await worker.runOnce()
    expect(signal.aborted).toBe(true)
    await delay(110)
    const saved = await BackgroundJob.findById(job._id)
    expect(saved.status).toBe('failed')
    expect(saved.error.code).toBe('JOB_TIMEOUT')
    expect(saved.result).toBe(null)
  })

  test('registered workers claim supported types only', async () => {
    const { job } = await enqueue({ type: 'not_registered' })
    registerHandlers({ unit_registered: async () => ({ ok: true }) })
    const registered = await enqueue({ type: 'unit_registered' })
    const worker = createWorker()
    await worker.runOnce()
    expect((await BackgroundJob.findById(registered.job._id)).status).toBe('succeeded')
    expect((await BackgroundJob.findById(job._id)).status).toBe('pending')
    expect(await worker.runOnce()).toBe(false)
  })

  test('execution permission helper rechecks active owner, current actor role, organization and staff permission', async () => {
    const { job } = await enqueue({ requestedBy: staff._id })
    expect(String((await assertJobPermission(job)).owner._id)).toBe(String(supplier._id))
    await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_rfq'] } })
    await expect(assertJobPermission(job)).rejects.toMatchObject({ code: 'JOB_REJECTED', retryable: false })
    await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_products'], status: 'revoked' } })
    await expect(assertJobPermission(job)).rejects.toMatchObject({ code: 'JOB_REJECTED' })
    await Membership.updateOne({ _id: membership._id }, { $set: { status: 'active' } })
    await Supplier.updateOne({ _id: staff._id }, { $set: { isActive: false } })
    await expect(assertJobPermission(job)).rejects.toMatchObject({ code: 'JOB_REJECTED' })
    await Supplier.updateOne({ _id: staff._id }, { $set: { isActive: true, role: 'buyer' } })
    await expect(assertJobPermission(job)).rejects.toMatchObject({ code: 'JOB_REJECTED' })
    await expect(assertJobPermission({ ...job.toObject(), requestedBy: otherSupplier._id })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
    await expect(assertJobPermission({ ...job.toObject(), organizationId: new mongoose.Types.ObjectId() })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
    await Supplier.updateOne({ _id: supplier._id }, { $set: { isActive: false } })
    await expect(assertJobPermission({ ...job.toObject(), requestedBy: admin._id })).rejects.toMatchObject({ code: 'JOB_REJECTED' })
  })

  test('graceful shutdown finishes the current job and stops claiming additional work', async () => {
    let started, finish
    const beginning = new Promise(resolve => { started = resolve })
    const finishGate = new Promise(resolve => { finish = resolve })
    const first = await enqueue(); const second = await enqueue()
    const worker = createWorker({ concurrency: 1, pollMs: 10, handlers: { ai_product_draft: async () => { started(); await finishGate; return { ok: true } } } }).start()
    await beginning
    const stopping = worker.stop({ graceMs: 1000 })
    finish()
    expect((await stopping).drained).toBe(true)
    expect((await BackgroundJob.findById(first.job._id)).status).toBe('succeeded')
    expect((await BackgroundJob.findById(second.job._id)).status).toBe('pending')
    expect(await worker.runOnce()).toBe(false)
  })

  test('shutdown deadline abandons execution under its lease and permits crash recovery', async () => {
    let started, release
    const beginning = new Promise(resolve => { started = resolve })
    const hanging = new Promise(resolve => { release = resolve })
    const { job } = await enqueue({ backoffMs: 0 })
    const worker = createWorker({ leaseMs: 300, concurrency: 1, handlers: { ai_product_draft: async () => { started(); await hanging; return { late: true } } } }).start()
    await beginning
    expect((await worker.stop({ graceMs: 5 })).drained).toBe(false)
    release()
    await delay(20)
    const abandoned = await BackgroundJob.findById(job._id).select('+leaseExpiresAt')
    expect(abandoned.status).toBe('running')
    await recoverExpiredJobs({ now: new Date(abandoned.leaseExpiresAt.getTime() + 1) })
    expect((await BackgroundJob.findById(job._id)).status).toBe('retry_wait')
  })
})

describe('job observation API isolation', () => {
  test('requires auth, isolates tenant data, honors current staff rights and current admin role', async () => {
    const { job } = await enqueue()
    const url = '/api/jobs/' + job._id
    expect((await request(app).get(url)).status).toBe(401)
    expect((await request(app).get(url).set(auth('supplier'))).status).toBe(200)
    expect((await request(app).get(url).set(auth('otherSupplier'))).status).toBe(404)
    expect((await request(app).get(url).set(auth('buyer'))).status).toBe(404)
    expect((await request(app).get(url).set(auth('staff'))).status).toBe(200)
    await Membership.updateOne({ _id: membership._id }, { $set: { permissions: ['manage_rfq'] } })
    expect((await request(app).get(url).set(auth('staff'))).status).toBe(404)
    await Membership.updateOne({ _id: membership._id }, { $set: { status: 'revoked', permissions: ['manage_products'] } })
    expect((await request(app).get(url).set(auth('staff'))).status).toBe(404)
    expect((await request(app).get(url).set(auth('admin'))).status).toBe(200)
    await Supplier.updateOne({ _id: admin._id }, { $set: { role: 'buyer' } })
    expect((await request(app).get(url).set(auth('admin'))).status).toBe(404)
  })

  test('paginates visible scope, filters status, validates input and never exposes internal payloads', async () => {
    for (let i = 0; i < 3; i++) await enqueue()
    await enqueue({ ownerId: otherSupplier._id, organizationId: null })
    const result = await request(app).get('/api/jobs/mine?page=2&limit=2').set(auth('supplier'))
    expect(result.status).toBe(200)
    expect(result.body.data).toHaveLength(1)
    expect(result.body.pagination).toEqual({ page: 2, limit: 2, total: 3, pages: 2 })
    expect(JSON.stringify(result.body)).not.toMatch(/local-media-fixture|payloadHash|idempotencyKey|ownerId|leaseToken/)
    expect((await request(app).get('/api/jobs?status=succeeded').set(auth('supplier'))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/jobs').set(auth('staff'))).body.data).toHaveLength(3)
    await Membership.updateOne({ _id: membership._id }, { $set: { status: 'revoked' } })
    expect((await request(app).get('/api/jobs').set(auth('staff'))).body.data).toHaveLength(0)
    expect((await request(app).get('/api/jobs').set(auth('admin'))).body.pagination.total).toBe(4)
    for (const query of ['page=0', 'page=1.5', 'page=abc', 'limit=101', 'limit=-1', 'status=arbitrary']) {
      expect((await request(app).get('/api/jobs?' + query).set(auth('supplier'))).status).toBe(400)
    }
    expect((await request(app).get('/api/jobs/not-an-id').set(auth('supplier'))).status).toBe(400)
    expect((await request(app).post('/api/jobs').set(auth('supplier')).send({ type: 'arbitrary', payload: {} })).status).toBe(404)
  })
})
