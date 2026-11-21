const { serializeStops } = require('./helpers/mongoLifecycle')
const { MongoMemoryServer } = require('mongodb-memory-server')
const utils = require('mongodb-memory-server-core/lib/util/utils')

test('re-entrant stops join the same operation and a distinct instance remains independent', async () => {
  let release, calls = 0, joined
  const gate = new Promise(resolve => { release = resolve })
  class Instance { async stop() { calls++; joined = this.stop(); await gate; return true } }
  serializeStops(Instance)
  const first = new Instance(), second = new Instance()
  const a = first.stop(), b = first.stop(), c = second.stop()
  expect(a).toBe(b); expect(c).not.toBe(a)
  await Promise.resolve()
  expect(calls).toBe(2); expect(joined).toBe(c)
  release(); await expect(a).resolves.toBe(true); await expect(c).resolves.toBe(true)
})

test('stop failures reach every caller and remain retryable, without forcing success', async () => {
  let calls = 0
  const failure = new Error('synthetic teardown failure')
  class Instance { async stop() { if (++calls === 1) throw failure; return true } }
  serializeStops(Instance); const instance = new Instance()
  const a = instance.stop(), b = instance.stop()
  expect(a).toBe(b)
  expect(await Promise.allSettled([a, b])).toEqual([
    { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }
  ])
  await expect(instance.stop()).resolves.toBe(true); expect(calls).toBe(2)
})

test.each(['ephemeralForTest', 'wiredTiger'])('real %s Mongo teardown leaves no in-flight child kill', async storageEngine => {
  const original = utils.killProcess, pending = new Set(), calls = []
  const spy = jest.spyOn(utils, 'killProcess').mockImplementation((child, name, port) => {
    const operation = original(child, name, port); pending.add(operation)
    calls.push({ name, pid: child?.pid })
    return operation.finally(() => pending.delete(operation))
  })
  let server
  try {
    server = await MongoMemoryServer.create({ instance: { storageEngine } })
    const info = server.instanceInfo.instance, children = [info.mongodProcess, info.killerProcess]
    await server.stop({ doCleanup: false })
    expect(pending.size).toBe(0)
    expect(calls.filter(x => x.name === 'mongodProcess')).toHaveLength(1)
    expect(calls.filter(x => x.name === 'killerProcess')).toHaveLength(1)
    for (const child of children) expect(utils.isAlive(child.pid)).toBe(false)
  } finally { if (server?.state !== 'stopped') await server?.stop({ doCleanup: false }); spy.mockRestore() }
})
