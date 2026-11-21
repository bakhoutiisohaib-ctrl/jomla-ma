// Explicit operator procedure, never invoked by server startup. No dotenv,
// syncIndexes, drops, backfill or application-model initialization.
const { MongoClient } = require('mongodb')
const { definition, inspect } = require('../services/sourcingCreationIndex')
async function run({ uri, database, create = false }) {
  if (!uri || !database || !/^[A-Za-z0-9_-]+$/.test(database)) throw new Error('Explicit URI and database confirmation required')
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
  try {
    await client.connect()
    if (client.db().databaseName !== database) throw new Error('Database confirmation differs from URI')
    const collection = client.db(database).collection('sourcingrequests')
    let indexes
    try { indexes = await collection.indexes() } catch (err) { if (err.code !== 26) throw err; indexes = [] }
    const existing = indexes.find(index => index.name === definition.options.name)
    if (existing) return { ready: await inspect(collection), created: false }
    if (!create) return { ready: false, created: false }
    await collection.createIndex(definition.key, definition.options)
    return { ready: await inspect(collection), created: true }
  } finally { await client.close() }
}
if (require.main === module) {
  const args = process.argv.slice(2)
  if (!['--check', '--create'].includes(args[0]) || args.length !== 2) {
    console.error('Usage: SOURCING_INDEX_URI set privately; node scripts/sourcingCreationIndex.js --check|--create CONFIRMED_DATABASE')
    process.exitCode = 1
  } else run({ uri: process.env.SOURCING_INDEX_URI, database: args[1], create: args[0] === '--create' })
    .then(result => { console.log(JSON.stringify(result)); if (!result.ready) process.exitCode = 2 })
    .catch(() => { console.error('Index operation failed; no automatic repair. Review target, index definition and data privately.'); process.exitCode = 1 })
}
module.exports = { run }
