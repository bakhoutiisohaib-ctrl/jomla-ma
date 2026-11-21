// Test-only adapter for mongodb-memory-server 8.x. On Windows, its SIGINT close
// handler can re-enter MongoInstance.stop while the original stop is awaiting a
// child. Joining that operation prevents orphan kill timers after Jest teardown.
// No dependency file, warning, signal handler or exit code is replaced.
const installed = Symbol.for('jomla.tests.serializedMongoStop')

function serializeStops(Instance) {
  if (Object.prototype.hasOwnProperty.call(Instance.prototype, installed)) return
  const original = Instance.prototype.stop, running = new WeakMap()
  Instance.prototype.stop = function (...args) {
    if (running.has(this)) return running.get(this)
    // Register before invoking the library: synchronous re-entry also joins.
    const operation = Promise.resolve().then(() => original.apply(this, args))
    const result = operation.finally(() => running.delete(this))
    running.set(this, result)
    return result
  }
  Object.defineProperty(Instance.prototype, installed, { value: true })
}

if (process.env.NODE_ENV !== 'test') throw new Error('Mongo lifecycle adapter is test-only')
serializeStops(require('mongodb-memory-server-core/lib/util/MongoInstance').MongoInstance)
module.exports = { serializeStops }
