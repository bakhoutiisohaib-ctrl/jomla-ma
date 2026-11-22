require('./helpers/pilotIsolation')
const mongoose = require('mongoose')
const { MongoMemoryReplSet } = require('mongodb-memory-server')
const Supplier = require('../models/Supplier'), Store = require('../models/Store'), Report = require('../models/Report'), AuditLog = require('../models/AuditLog')
const { resolveReport } = require('../services/reportResolution')
let replica
jest.setTimeout(120000)
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replica.getUri())
  await Promise.all([Supplier.init(), Store.init(), Report.init(), AuditLog.init()])
})
afterEach(() => { jest.restoreAllMocks(); delete process.env.REPORTS_TRANSACTIONS })
afterAll(async () => { await mongoose.disconnect(); await replica?.stop() })
test('replica-set suspension rolls back effects and audit on failure, then resumes identical intent', async () => {
  process.env.REPORTS_TRANSACTIONS = '1'
  const supplier = await Supplier.create({ name: 'Transaction fixture', role: 'supplier', email: 'transaction@example.test', password: 'synthetic-only' })
  const store = await Store.create({ supplierId: supplier._id, name: 'Transaction test store', reviewStatus: 'approved', isActive: true })
  const report = await Report.create({ targetType: 'supplier', targetId: supplier._id, targetName: supplier.name, reason: 'fraud' })
  const input = { action: 'resolved', moderationAction: 'suspend_supplier', resolutionNotes: 'Synthetic replica-set test' }
  const actor = { id: new mongoose.Types.ObjectId(), role: 'admin', name: 'Test administrator' }
  jest.spyOn(Store, 'updateMany').mockRejectedValueOnce(new Error('synthetic transaction failure'))
  await expect(resolveReport(report._id, input, actor)).rejects.toThrow('synthetic transaction failure')
  expect((await Supplier.findById(supplier._id)).isActive).not.toBe(false)
  expect((await Store.findById(store._id)).isActive).toBe(true)
  expect(await AuditLog.countDocuments({ targetId: report._id })).toBe(0)
  await Report.updateOne({ _id: report._id }, { $set: { 'resolutionClaim.leaseUntil': new Date(0) } })
  expect((await resolveReport(report._id, input, actor)).status).toBe('resolved')
  expect((await Supplier.findById(supplier._id)).isActive).toBe(false)
  expect((await Store.findById(store._id)).adminSuspended).toBe(true)
  expect(await AuditLog.countDocuments({ targetId: report._id, phase: 'completed' })).toBe(1)
})
