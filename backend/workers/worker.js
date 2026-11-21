const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
const mongoose = require('mongoose')
const BackgroundJob = require('../models/BackgroundJob')
const { createWorker } = require('../services/jobQueue')

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required for the background worker')
  // The map is maintained by the application, never supplied by an HTTP client.
  const moduleHandlers = require('../services/jobHandlers')
  const handlers = moduleHandlers.handlers || moduleHandlers
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  await BackgroundJob.init()
  const worker = createWorker({ handlers,
    concurrency: process.env.JOB_CONCURRENCY === undefined ? undefined : Number(process.env.JOB_CONCURRENCY),
    leaseMs: process.env.JOB_LEASE_MS === undefined ? undefined : Number(process.env.JOB_LEASE_MS),
    pollMs: process.env.JOB_POLL_MS === undefined ? undefined : Number(process.env.JOB_POLL_MS),
    onError: error => console.error(JSON.stringify({ event: 'worker_error', code: error.code }))
  })
  const recovery = require('../services/rfqDecision').createDecisionRecovery({
    onError: error => console.error(JSON.stringify({ event: 'rfq_recovery_error', ...error }))
  }).start()
  const creationRecovery = require('../services/rfqCreation').createCreationRecovery({
    onError: error => console.error(JSON.stringify({ event: 'rfq_creation_recovery_error', ...error }))
  }).start()
  const offerRecovery = require('../services/rfqOfferSubmission').createOfferRecovery({
    onError: error => console.error(JSON.stringify({ event: 'rfq_offer_recovery_error', ...error }))
  }).start()
  const rejectionRecovery = require('../services/rfqSupplierRejection').createRejectionRecovery({
    onError: error => console.error(JSON.stringify({ event: 'rfq_supplier_rejection_recovery_error', ...error }))
  }).start()
  const sourcingRecovery = require('../services/sourcingRecovery').createSourcingRecovery({
    onError: error => console.error(JSON.stringify({ event: 'sourcing_recovery_error', ...error }))
  }).start()
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    const result = await worker.stop({ graceMs: Number(process.env.JOB_SHUTDOWN_GRACE_MS) || 15000 })
    await recovery.stop()
    await creationRecovery.stop()
    await offerRecovery.stop()
    await rejectionRecovery.stop()
    await sourcingRecovery.stop()
    console.info(JSON.stringify({ event: 'worker_stopped', drained: result.drained }))
    await mongoose.disconnect()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  worker.start()
  console.info(JSON.stringify({ event: 'worker_started', types: Object.keys(handlers) }))
  return worker
}

if (require.main === module) main().catch(async () => {
  // Connection strings and provider errors can contain secrets. Do not print
  // the raw startup error or stack in operator logs.
  console.error('Background worker startup failed; check MONGODB_URI and handler configuration.')
  await mongoose.disconnect()
  process.exitCode = 1
})

module.exports = { main }
