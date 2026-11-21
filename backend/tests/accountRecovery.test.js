jest.mock('dotenv', () => ({ config: jest.fn() }))
const fs = require('fs/promises'), os = require('os'), path = require('path')
const crypto = require('crypto'), bcrypt = require('bcryptjs'), mongoose = require('mongoose')
const request = require('supertest')
const { MongoMemoryServer } = require('mongodb-memory-server')
process.env.JWT_SECRET = 'isolated-recovery-test-secret-not-for-production'
process.env.DISABLE_REDIS = '1'
process.env.RECOVERY_MAIL_MODE = 'private-file'
process.env.RECOVERY_ORIGIN = 'http://localhost:3000'
const app = require('../server')
const Supplier = require('../models/Supplier')
const { generateToken } = require('../middleware/auth')
let mongo, root, counter = 0
const oldPassword = 'Original-Test-Password!'
const newPassword = 'Replacement-Test-Password!'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'jomla-recovery-tests-'))
  process.env.RECOVERY_MAIL_DIR = root
  mongo = await MongoMemoryServer.create({ instance: { dbName: 'recovery_isolated', storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri())
  await Supplier.init()
})
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })
async function account(extra = {}) {
  return Supplier.create({ name: 'Synthetic recovery user', email: `recovery-${++counter}@example.test`, password: await bcrypt.hash(oldPassword, 4), role: 'buyer', ...extra })
}
async function issue(user) {
  const token = crypto.randomBytes(32).toString('hex')
  await Supplier.updateOne({ _id: user._id }, { $set: { passwordResetHash: hash(token), passwordResetExpiresAt: new Date(Date.now() + 60000), passwordResetVersion: user.tokenVersion || 0 } })
  return token
}
const reset = (token, password = newPassword) => request(app).post('/api/account-recovery/reset').send({ token, password, language: 'en' })

test('known, unknown, disabled and admin addresses return identical responses; only eligible user receives a private message', async () => {
  const user = await account(), disabled = await account({ isActive: false }), admin = await account({ role: 'admin' })
  const results = []
  for (const email of [user.email, 'missing@example.test', disabled.email, admin.email]) {
    results.push(await request(app).post('/api/account-recovery/request').set('Host', 'attacker.example').send({ email, language: 'en' }))
  }
  for (const result of results) { expect(result.status).toBe(202); expect(result.body).toEqual(results[0].body); expect(result.headers['cache-control']).toBe('no-store') }
  const messages = await Promise.all((await fs.readdir(root)).map(file => fs.readFile(path.join(root, file), 'utf8').then(JSON.parse)))
  expect(messages).toHaveLength(1)
  expect(messages[0].to).toBe(user.email)
  expect(messages[0].resetUrl).toMatch(/^http:\/\/localhost:3000\/reset-password#token=[a-f0-9]{64}$/)
  const token = new URL(messages[0].resetUrl).hash.slice(7)
  const stored = await Supplier.findById(user._id).select('+passwordResetHash +passwordResetExpiresAt')
  expect(stored.passwordResetHash).toBe(hash(token)); expect(stored.passwordResetHash).not.toBe(token)
  expect(stored.passwordResetExpiresAt.getTime() - Date.now()).toBeGreaterThan(13 * 60000)
  expect((await Supplier.findById(user._id)).toObject()).not.toHaveProperty('passwordResetHash')
  await request(app).post('/api/account-recovery/request').send({ email: user.email }).expect(202)
  expect(await fs.readdir(root)).toHaveLength(1)
})

test('reset changes the password, revokes old sessions and cannot be replayed', async () => {
  const user = await account(), session = generateToken(user), token = await issue(user)
  expect((await reset(token)).status).toBe(200)
  expect((await reset(token)).body.code).toBe('RECOVERY_LINK_INVALID')
  await request(app).get('/api/suppliers/me/profile').set('Authorization', 'Bearer ' + session).expect(401)
  await request(app).post('/api/suppliers/login').send({ email: user.email, password: oldPassword }).expect(401)
  await request(app).post('/api/suppliers/login').send({ email: user.email, password: newPassword }).expect(200)
  const stored = await Supplier.findById(user._id).select('+passwordResetHash +tokenVersion')
  expect(stored.passwordResetHash).toBeUndefined(); expect(stored.tokenVersion).toBe(1)
})

test('simultaneous redemption has exactly one winner', async () => {
  const token = await issue(await account())
  const responses = await Promise.all([reset(token), reset(token)])
  expect(responses.map(r => r.status).sort()).toEqual([200, 400])
})

test.each(['expired', 'revoked', 'disabled'])('%s token is rejected without changing the password', async kind => {
  const user = await account(), token = await issue(user)
  await Supplier.updateOne({ _id: user._id }, kind === 'expired' ? { $set: { passwordResetExpiresAt: new Date(0) } } : kind === 'revoked' ? { $inc: { tokenVersion: 1 } } : { $set: { isActive: false } })
  expect((await reset(token)).status).toBe(400)
  expect(await bcrypt.compare(oldPassword, (await Supplier.findById(user._id).select('+password')).password)).toBe(true)
})

test('invalid input and oversized UTF-8 password never consume a valid token', async () => {
  const token = await issue(await account())
  expect((await reset(token, 'ع'.repeat(37))).body.code).toBe('RECOVERY_PASSWORD_INVALID')
  expect((await reset({ $ne: null })).status).toBe(400)
  expect((await reset(token)).status).toBe(200)
})

test('unconfigured or production transport fails closed for all email addresses', async () => {
  const env = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    await request(app).post('/api/account-recovery/request').send({ email: 'missing@example.test' }).expect(503)
    expect((await reset('a'.repeat(64))).status).toBe(503)
  } finally { process.env.NODE_ENV = env }
})
