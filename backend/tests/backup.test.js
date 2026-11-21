const fs = require('fs').promises
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { MongoMemoryServer } = require('mongodb-memory-server')
const { MongoClient, BSON } = require('mongoose').mongo
const { backupDatabase, restoreDatabase, validateBackup, databaseName } = require('../services/backup')

jest.setTimeout(90000)
let mongo, client, sandbox, uri, archive, uploads, serial = 0
const fresh = name => `${name}_${++serial}`
const checksum = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

async function mutateManifest(directory, change) {
  const filename = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(filename, 'utf8'))
  await change(manifest)
  const bytes = Buffer.from(JSON.stringify(manifest))
  await fs.writeFile(filename, bytes)
  await fs.writeFile(path.join(directory, 'manifest.sha256'), checksum(bytes) + '\n')
}
async function copyArchive(name) {
  const directory = path.join(sandbox, fresh(name))
  await fs.cp(archive, directory, { recursive: true })
  return directory
}
const restore = (targetDatabase, overrides = {}) => restoreDatabase({ uri, configuredProductionUri: uri, archive, targetDatabase, confirmTarget: targetDatabase, mediaTarget: path.join(sandbox, fresh('restored_media')), ...overrides })

beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'jomla-backup-tests-'))
  uploads = path.join(sandbox, 'uploads')
  await fs.mkdir(path.join(uploads, 'nested'), { recursive: true })
  await fs.writeFile(path.join(uploads, 'nested', '商品-صورة.bin'), Buffer.from([0, 255, 65, 3]))
  await fs.writeFile(path.join(uploads, 'root.png'), Buffer.from('synthetic-media'))
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  uri = mongo.getUri('backup_source')
  client = new MongoClient(uri)
  await client.connect()
  const source = client.db('backup_source')
  await source.createCollection('empty', { validator: { name: { $type: 'string' } }, validationLevel: 'moderate' })
  const typed = {
    _id: new BSON.ObjectId(), date: new Date('2026-10-19T03:04:05.006Z'),
    long: BSON.Long.fromString('9007199254740997'), integer: new BSON.Int32(7), double: new BSON.Double(7),
    decimal: BSON.Decimal128.fromString('12345678901234567890.0002'),
    binary: new BSON.Binary(Buffer.from([0, 250, 255, 4]), 0x80),
    timestamp: new BSON.Timestamp({ t: 124, i: 7 }), regexp: new BSON.BSONRegExp('x.*y', 'im'),
    code: new BSON.Code('return n', { n: new BSON.Int32(5) }), min: new BSON.MinKey(), max: new BSON.MaxKey(),
    nested: [{ ref: new BSON.ObjectId(), nullValue: null, yes: true }], arabic: 'المغرب'
  }
  await source.collection('typed').insertOne(typed)
  await source.collection('typed').createIndex({ arabic: 1, date: -1 }, { name: 'compound_unique', unique: true, partialFilterExpression: { arabic: { $exists: true } } })
  await source.collection('typed').createIndex({ date: 1 }, { name: 'ttl_date', expireAfterSeconds: 365 * 86400 })
  archive = path.join(sandbox, 'complete_archive')
  await backupDatabase({ uri, output: archive, uploads })
})

afterAll(async () => {
  if (client) await client.close()
  if (mongo) await mongo.stop()
  // A verified unique test directory is the only recursive cleanup target.
  if (sandbox && path.dirname(sandbox) === os.tmpdir() && path.basename(sandbox).startsWith('jomla-backup-tests-')) await fs.rm(sandbox, { recursive: true, force: true })
})

test('lossless BSON, collection validators, indexes, media, and counts survive a new-database restore', async () => {
  const target = fresh('recovered'), mediaTarget = path.join(sandbox, fresh('media'))
  const checked = await validateBackup(archive)
  expect(checked.manifest.collections).toHaveLength(2)
  const result = await restore(target, { mediaTarget })
  expect(result.outcome.status).toBe('complete')
  expect(result.outcome.restoredDocuments).toBe(1)
  expect(result.outcome.restoredMediaFiles).toBe(2)
  expect(result.outcome.atomicDatabaseRestore).toBe(false)
  const originalRaw = await client.db('backup_source').collection('typed').findOne({}, { raw: true })
  const recoveredRaw = await client.db(target).collection('typed').findOne({}, { raw: true })
  expect(recoveredRaw.equals(originalRaw)).toBe(true)
  const originalIndexes = await client.db('backup_source').collection('typed').listIndexes().toArray()
  const recoveredIndexes = await client.db(target).collection('typed').listIndexes().toArray()
  expect(recoveredIndexes).toEqual(originalIndexes)
  const originalInfo = await client.db('backup_source').listCollections({ name: 'empty' }).next()
  const recoveredInfo = await client.db(target).listCollections({ name: 'empty' }).next()
  expect(recoveredInfo.options).toEqual(originalInfo.options)
  expect(await client.db(target).collection('empty').countDocuments()).toBe(0)
  expect(await fs.readFile(path.join(mediaTarget, 'nested', '商品-صورة.bin'))).toEqual(await fs.readFile(path.join(uploads, 'nested', '商品-صورة.bin')))
  expect(JSON.parse(await fs.readFile(result.outcomePath, 'utf8')).status).toBe('complete')
})

test('backup output collision is rejected without modifying the existing archive', async () => {
  const prior = await fs.readFile(path.join(archive, 'manifest.json'))
  await expect(backupDatabase({ uri, output: archive, uploads })).rejects.toThrow('already exists')
  expect(await fs.readFile(path.join(archive, 'manifest.json'))).toEqual(prior)
})

test('explicit database names are parsed for standalone, SRV, and replica-set URIs without exposing credentials', () => {
  expect(databaseName('mongodb://host:27017/source')).toBe('source')
  expect(databaseName('mongodb+srv://account:password@host.example.com/source?retryWrites=true')).toBe('source')
  expect(databaseName('mongodb://host1:27017,host2:27018/source?replicaSet=cluster')).toBe('source')
  expect(() => databaseName('mongodb://host:27017/?authSource=admin')).toThrow('explicit database')
})

test('streaming batches restore more than one batch and a deliberate database-only archive', async () => {
  const source = fresh('batch_source'), target = fresh('batch_restored')
  await client.db(source).collection('many').insertMany(Array.from({ length: 205 }, (_, number) => ({ _id: new BSON.Int32(number), amount: BSON.Long.fromString(`900719925474${String(number).padStart(4, '0')}`), text: 'دفعة'.repeat(20) })))
  const output = path.join(sandbox, fresh('batches'))
  const backedUp = await backupDatabase({ uri: mongo.getUri(source), output, includeMedia: false })
  expect(backedUp.manifest.media).toEqual({ included: false, files: [] })
  const result = await restoreDatabase({ uri, archive: output, configuredProductionUri: uri, targetDatabase: target, confirmTarget: target })
  expect(result.outcome.restoredDocuments).toBe(205)
  expect(result.outcome.restoredMediaFiles).toBe(0)
  const original = await client.db(source).collection('many').find({}, { raw: true }).toArray()
  const recovered = await client.db(target).collection('many').find({}, { raw: true }).toArray()
  expect(recovered.map(bytes => bytes.toString('hex'))).toEqual(original.map(bytes => bytes.toString('hex')))
})

test('source, application, system databases, and missing exact confirmation are rejected', async () => {
  await expect(restore('backup_source')).rejects.toThrow('configured application')
  await expect(restore('backup_source', { configuredProductionUri: mongo.getUri('other_production') })).rejects.toThrow('backup source')
  await expect(restore('production', { configuredProductionUri: mongo.getUri('production') })).rejects.toThrow('configured application')
  await expect(restore('admin')).rejects.toThrow('non-system')
  await expect(restore('../bad')).rejects.toThrow('safe')
  await expect(restore(fresh('confirm'), { confirmTarget: 'different' })).rejects.toThrow('Exact')
})

test('existing target collections and media directories remain untouched', async () => {
  const target = fresh('occupied')
  await client.db(target).collection('keep').insertOne({ marker: 'preserve' })
  const failure = await restore(target).catch(error => error)
  expect(failure.message).toMatch('must be empty')
  expect(await client.db(target).collection('keep').findOne()).toEqual(expect.objectContaining({ marker: 'preserve' }))
  expect(await client.db(target).listCollections().toArray()).toHaveLength(1)
  expect(JSON.parse(await fs.readFile(failure.outcomePath, 'utf8')).cleanup.removedCollections).toEqual([])
  await expect(restore(fresh('media_collision'), { mediaTarget: uploads })).rejects.toThrow('already exists')
})

test('corrupted BSON archive fails before creating any target collection or media', async () => {
  const directory = await copyArchive('corrupt'), target = fresh('corrupt_target')
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  await fs.appendFile(path.join(directory, manifest.collections[1].data.path), 'tamper')
  await expect(restore(target, { archive: directory })).rejects.toThrow('checksum')
  expect(await client.db(target).listCollections().toArray()).toHaveLength(0)
})

test('BSON structural validation detects invalid content even after a file hash is recomputed', async () => {
  const directory = await copyArchive('invalid_bson'), target = fresh('invalid_target')
  await mutateManifest(directory, async manifest => {
    const entry = manifest.collections.find(collection => collection.documents).data
    const malformed = Buffer.from([40, 0, 0, 0, 0])
    await fs.writeFile(path.join(directory, entry.path), malformed)
    entry.bytes = malformed.length; entry.sha256 = checksum(malformed)
  })
  await expect(restore(target, { archive: directory })).rejects.toThrow('BSON document length')
  expect(await client.db(target).listCollections().toArray()).toHaveLength(0)
})

test('unsafe archive paths, manifest corruption, and unexpected files are rejected', async () => {
  const escape = await copyArchive('escape')
  await mutateManifest(escape, manifest => { manifest.media.files[0].path = 'media/../../outside' })
  await expect(validateBackup(escape)).rejects.toThrow('Unsafe archive path')
  const corruptManifest = await copyArchive('manifest_corrupt')
  await fs.appendFile(path.join(corruptManifest, 'manifest.json'), ' ')
  await expect(validateBackup(corruptManifest)).rejects.toThrow('Manifest checksum')
  const extra = await copyArchive('extra')
  await fs.writeFile(path.join(extra, 'unlisted.file'), 'unexpected')
  await expect(validateBackup(extra)).rejects.toThrow('Unexpected file')
})

test('symlinks or Windows junctions in backup input and archive are rejected', async () => {
  const directory = path.join(sandbox, fresh('symlink_uploads'))
  await fs.mkdir(directory)
  await fs.symlink(uploads, path.join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(backupDatabase({ uri, output: path.join(sandbox, fresh('linked_backup')), uploads: directory })).rejects.toThrow('Symbolic links')
  const copied = await copyArchive('linked_archive')
  await fs.symlink(uploads, path.join(copied, 'junction'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(validateBackup(copied)).rejects.toThrow('Symbolic links')
  await expect(backupDatabase({ uri, output: path.join(uploads, fresh('nested')), uploads })).rejects.toThrow('separate')
})

test('a restore write failure removes only resources created in that attempt and records the outcome', async () => {
  const directory = await copyArchive('write_failure'), target = fresh('failed_restore')
  // Valid BSON and checksums, but an intentionally impossible index type fails at the server.
  await mutateManifest(directory, async manifest => {
    const entry = manifest.collections.find(collection => collection.name === 'typed').metadata
    const filename = path.join(directory, entry.path)
    const metadata = BSON.deserialize(await fs.readFile(filename))
    metadata.indexes.push({ key: { missing: 'not_an_index_type' }, name: 'invalid_index' })
    const bytes = BSON.serialize(metadata)
    await fs.writeFile(filename, bytes)
    entry.bytes = bytes.length; entry.sha256 = checksum(bytes)
  })
  const failure = await restore(target, { archive: directory }).catch(error => error)
  expect(failure.outcome.status).toBe('failed')
  expect(failure.outcome.cleanup.failedCollections).toEqual([])
  expect(failure.outcome.cleanup.removedCollections.sort()).toEqual(['empty', 'typed'])
  expect(await client.db(target).listCollections().toArray()).toHaveLength(0)
  expect(JSON.parse(await fs.readFile(failure.outcomePath, 'utf8')).error).not.toMatch(/mongodb:\/\//)
})
