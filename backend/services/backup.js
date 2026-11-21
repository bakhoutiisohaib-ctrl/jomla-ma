const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { MongoClient, BSON } = require('mongoose').mongo

const FORMAT = 'jomla-logical-bson-v1'
const MAX_BSON = 16 * 1024 * 1024
const DEFAULT_UPLOADS = path.resolve(__dirname, '..', 'uploads')
const safety = message => Object.assign(new Error(message), { code: 'BACKUP_SAFETY' })
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const inside = (parent, child) => child === parent || (!path.relative(parent, child).startsWith('..' + path.sep) && path.relative(parent, child) !== '..' && !path.isAbsolute(path.relative(parent, child)))

function databaseName(uri) {
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw safety('A MongoDB connection URI is required through the environment')
  let name
  try {
    const matched = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?#/]+)(?:[?#]|$)/)
    name = matched && decodeURIComponent(matched[1])
  } catch { throw safety('Invalid MongoDB connection URI') }
  if (!name || name.includes('/')) throw safety('The MongoDB URI must name an explicit database')
  return name
}

async function checkedPath(input, mustExist = true) {
  if (!input || typeof input !== 'string') throw safety('An explicit filesystem path is required')
  const resolved = path.resolve(input)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const stat = await fsp.lstat(current)
      if (stat.isSymbolicLink()) throw safety('Symbolic links and junctions are not allowed')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (mustExist) throw safety('A required filesystem path does not exist')
      break
    }
  }
  return resolved
}

function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw safety('Unsafe archive path')
  return relative
}

async function archiveFile(root, relative) {
  safeRelative(relative)
  const resolved = path.resolve(root, ...relative.split('/'))
  if (!inside(root, resolved)) throw safety('Archive path escapes its directory')
  await checkedPath(resolved)
  if (!(await fsp.lstat(resolved)).isFile()) throw safety('Archive entries must be regular files')
  return resolved
}

async function hashFile(filename) {
  const hash = crypto.createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(filename)) { hash.update(chunk); bytes += chunk.length }
  return { bytes, sha256: hash.digest('hex') }
}

async function* bsonDocuments(filename) {
  const file = await fsp.open(filename, 'r')
  try {
    let position = 0
    const size = (await file.stat()).size
    while (position < size) {
      const header = Buffer.alloc(4)
      if ((await file.read(header, 0, 4, position)).bytesRead !== 4) throw safety('Truncated BSON document header')
      const length = header.readInt32LE(0)
      if (length < 5 || length > MAX_BSON || position + length > size) throw safety('Invalid BSON document length')
      const raw = Buffer.alloc(length)
      let read = 0
      while (read < length) {
        const result = await file.read(raw, read, length - read, position + read)
        if (!result.bytesRead) throw safety('Truncated BSON document')
        read += result.bytesRead
      }
      let document
      try { document = BSON.deserialize(raw, { promoteValues: false, promoteLongs: false, bsonRegExp: true }) } catch { throw safety('Invalid BSON document content') }
      position += length
      yield document
    }
  } finally { await file.close() }
}

async function walkFiles(root, prefix = '') {
  const entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true })
  const result = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    safeRelative(relative)
    const filename = await checkedPath(path.join(root, ...relative.split('/')))
    const stat = await fsp.lstat(filename)
    if (stat.isDirectory()) result.push(...await walkFiles(root, relative))
    else if (stat.isFile()) result.push(relative)
    else throw safety('Only regular files and directories may be archived')
  }
  return result
}

function safeFailure(error) {
  return error.code === 'BACKUP_SAFETY' ? error.message : `Operation failed (${String(error.code || error.name || 'ERROR').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)})`
}

async function writeOutcome(filename, outcome) {
  await fsp.writeFile(filename, JSON.stringify(outcome, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}

async function backupDatabase(options = {}) {
  const uri = options.uri || process.env.MONGODB_URI
  const sourceDatabase = databaseName(uri)
  const output = await checkedPath(options.output, false)
  const includeMedia = options.includeMedia !== false
  const uploads = includeMedia ? await checkedPath(options.uploads || process.env.UPLOADS_DIR || DEFAULT_UPLOADS) : null
  if (uploads && (inside(uploads, output) || inside(output, uploads))) throw safety('Backup and uploads directories must be separate')
  if (uploads && !(await fsp.stat(uploads)).isDirectory()) throw safety('The uploads path must be a directory')
  await checkedPath(path.dirname(output))
  // Exclusive creation prevents replacement or merging of previous backups.
  try { await fsp.mkdir(output, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') throw safety('Backup output already exists'); throw error }
  let client
  const startedAt = new Date().toISOString()
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, promoteValues: false, promoteLongs: false })
    await client.connect()
    const db = client.db(sourceDatabase)
    const infos = await db.listCollections({}, { nameOnly: false }).toArray()
    if (infos.some(info => info.type !== 'collection' || info.name.startsWith('system.') || info.options?.timeseries || info.options?.encryptedFields)) throw safety('Views, system, time-series, and encrypted collections require native database backup tools')
    await fsp.mkdir(path.join(output, 'collections'))
    const manifest = { format: FORMAT, status: 'complete', startedAt, sourceDatabase, consistency: 'logical-per-collection; writes must be paused for a consistent multi-collection backup', collections: [], media: { included: includeMedia, files: [] } }
    for (const [number, info] of infos.sort((a, b) => a.name.localeCompare(b.name)).entries()) {
      const stem = `collections/${String(number).padStart(6, '0')}`
      const data = `${stem}.bson`, metadata = `${stem}.metadata.bson`
      const collection = db.collection(info.name)
      const indexes = await collection.listIndexes().toArray()
      const metaBytes = BSON.serialize({ name: info.name, options: info.options || {}, indexes })
      await fsp.writeFile(path.join(output, metadata), metaBytes, { flag: 'wx', mode: 0o600 })
      const file = await fsp.open(path.join(output, data), 'wx', 0o600)
      let documents = 0
      const hash = crypto.createHash('sha256')
      let bytes = 0
      try {
        const cursor = collection.find({}, { raw: true, batchSize: 100, readConcern: { level: 'local' } })
        try {
          for await (const raw of cursor) {
            if (!Buffer.isBuffer(raw)) throw safety('The driver did not provide raw lossless BSON')
            let offset = 0
            while (offset < raw.length) offset += (await file.write(raw, offset, raw.length - offset)).bytesWritten
            hash.update(raw); bytes += raw.length; documents += 1
          }
        } finally { await cursor.close() }
      } finally { await file.close() }
      manifest.collections.push({ name: info.name, documents, data: { path: data, bytes, sha256: hash.digest('hex') }, metadata: { path: metadata, bytes: metaBytes.length, sha256: sha256(metaBytes) } })
    }
    if (includeMedia) {
      const files = await walkFiles(uploads)
      await fsp.mkdir(path.join(output, 'media'))
      for (const relative of files) {
        const source = await archiveFile(uploads, relative)
        const archivePath = `media/${relative}`
        const destination = path.join(output, ...archivePath.split('/'))
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL)
        await fsp.chmod(destination, 0o600)
        manifest.media.files.push({ path: archivePath, ...await hashFile(destination) })
      }
    }
    manifest.completedAt = new Date().toISOString()
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
    await fsp.writeFile(path.join(output, 'manifest.json'), manifestBytes, { flag: 'wx', mode: 0o600 })
    await fsp.writeFile(path.join(output, 'manifest.sha256'), sha256(manifestBytes) + '\n', { flag: 'wx', mode: 0o600 })
    await writeOutcome(path.join(output, 'outcome.json'), { operation: 'backup', status: 'complete', startedAt, completedAt: manifest.completedAt, sourceDatabase, collections: manifest.collections.length, documents: manifest.collections.reduce((sum, collection) => sum + collection.documents, 0), mediaFiles: manifest.media.files.length })
    return { output, manifest }
  } catch (error) {
    await writeOutcome(path.join(output, 'outcome.json'), { operation: 'backup', status: 'failed', startedAt, completedAt: new Date().toISOString(), error: safeFailure(error), partialFilesRetained: true }).catch(() => {})
    throw Object.assign(new Error(safeFailure(error)), { code: error.code, output })
  } finally { if (client) await client.close() }
}

async function validateBackup(input) {
  const root = await checkedPath(input)
  if (!(await fsp.stat(root)).isDirectory()) throw safety('Archive path must be a directory')
  const manifestPath = await archiveFile(root, 'manifest.json')
  const manifestBytes = await fsp.readFile(manifestPath)
  if (manifestBytes.length > 16 * 1024 * 1024) throw safety('Manifest is too large')
  const expectedHash = (await fsp.readFile(await archiveFile(root, 'manifest.sha256'), 'utf8')).trim()
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(manifestBytes) !== expectedHash) throw safety('Manifest checksum mismatch')
  let manifest
  try { manifest = JSON.parse(manifestBytes.toString('utf8')) } catch { throw safety('Invalid backup manifest') }
  if (manifest.format !== FORMAT || manifest.status !== 'complete' || !Array.isArray(manifest.collections) || !Array.isArray(manifest.media?.files) || typeof manifest.media.included !== 'boolean' || typeof manifest.sourceDatabase !== 'string') throw safety('Unsupported or incomplete backup')
  const expected = new Set(['manifest.json', 'manifest.sha256', 'outcome.json'])
  const names = new Set(), files = new Set(), metadata = []
  async function validateEntry(entry, prefix) {
    if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || !entry.path?.startsWith(prefix)) throw safety('Invalid archive file metadata')
    safeRelative(entry.path)
    const folded = entry.path.toLowerCase()
    if (files.has(folded)) throw safety('Duplicate or colliding archive path')
    files.add(folded); expected.add(entry.path)
    const filename = await archiveFile(root, entry.path)
    const actual = await hashFile(filename)
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw safety('Archive checksum mismatch')
    return filename
  }
  for (const collection of manifest.collections) {
    if (typeof collection.name !== 'string' || !collection.name || collection.name.includes('\0') || collection.name.startsWith('system.') || names.has(collection.name) || !Number.isSafeInteger(collection.documents) || collection.documents < 0) throw safety('Invalid or duplicate collection metadata')
    names.add(collection.name)
    const data = await validateEntry(collection.data, 'collections/')
    const metaFile = await validateEntry(collection.metadata, 'collections/')
    let meta
    try { meta = BSON.deserialize(await fsp.readFile(metaFile)) } catch { throw safety('Invalid collection BSON metadata') }
    if (meta.name !== collection.name || !meta.options || !Array.isArray(meta.indexes) || meta.options.timeseries || meta.options.encryptedFields) throw safety('Collection metadata mismatch')
    let count = 0
    for await (const document of bsonDocuments(data)) { if (!Object.hasOwn(document, '_id')) throw safety('A BSON document is missing its identifier'); count += 1 }
    if (count !== collection.documents) throw safety('Document count mismatch')
    metadata.push(meta)
  }
  if (!manifest.media.included && manifest.media.files.length) throw safety('Unexpected media entries')
  for (const file of manifest.media.files) await validateEntry(file, 'media/')
  const actualFiles = await walkFiles(root)
  if (actualFiles.some(file => !expected.has(file))) throw safety('Unexpected file in archive')
  return { root, manifest, metadata }
}

async function restoreDatabase(options = {}) {
  const targetName = options.targetDatabase
  if (typeof targetName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(targetName) || ['admin', 'config', 'local'].includes(targetName.toLowerCase())) throw safety('Use a safe, non-system target database name')
  if (options.confirmTarget !== targetName) throw safety('Exact --confirm-target matching --target-db is required')
  const uri = options.uri || process.env.RESTORE_MONGODB_URI
  databaseName(uri)
  const configuredUri = options.configuredProductionUri || process.env.MONGODB_URI
  if (configuredUri && databaseName(configuredUri).toLowerCase() === targetName.toLowerCase()) throw safety('Restore must not target the configured application database')
  // Validate every file, BSON document, checksum and path before connecting or writing.
  const validated = await validateBackup(options.archive)
  const { root, manifest, metadata } = validated
  if (manifest.sourceDatabase.toLowerCase() === targetName.toLowerCase()) throw safety('Restore must use a different database from the backup source')
  let mediaTarget = null
  if (manifest.media.included) {
    mediaTarget = await checkedPath(options.mediaTarget, false)
    if (inside(root, mediaTarget) || inside(mediaTarget, root)) throw safety('Media destination and archive must be separate')
    await checkedPath(path.dirname(mediaTarget))
    try { await fsp.lstat(mediaTarget); throw safety('Media destination already exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const outcomePath = await checkedPath(options.outcome || path.join(path.dirname(root), `restore-${targetName}-${crypto.randomUUID()}.json`), false)
  if (inside(root, outcomePath) || (mediaTarget && inside(mediaTarget, outcomePath))) throw safety('Outcome must be outside archive and media destination')
  await checkedPath(path.dirname(outcomePath))
  try { await fsp.lstat(outcomePath); throw safety('Outcome file already exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  const startedAt = new Date().toISOString(), createdCollections = []
  const outcome = { operation: 'restore', status: 'failed', startedAt, targetDatabase: targetName, atomicDatabaseRestore: false, createdCollections, restoredDocuments: 0, restoredMediaFiles: 0 }
  let client, db, createdMedia = false
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
    await client.connect()
    db = client.db(targetName)
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length) throw safety('Target database must be empty; existing collections will never be overwritten')
    for (let number = 0; number < manifest.collections.length; number++) {
      const collection = manifest.collections[number], meta = metadata[number]
      await db.createCollection(collection.name, meta.options)
      createdCollections.push(collection.name)
      let batch = [], batchBytes = 0
      const insert = async () => { if (batch.length) { await db.collection(collection.name).insertMany(batch, { ordered: true }); outcome.restoredDocuments += batch.length; batch = []; batchBytes = 0 } }
      for await (const document of bsonDocuments(await archiveFile(root, collection.data.path))) {
        const bytes = BSON.calculateObjectSize(document)
        if (batch.length && (batch.length >= 100 || batchBytes + bytes > 8 * 1024 * 1024)) await insert()
        batch.push(document); batchBytes += bytes
      }
      await insert()
      for (const index of meta.indexes) {
        if (index.name === '_id_') continue
        const { key, v, ns, background, ...indexOptions } = index
        await db.collection(collection.name).createIndex(key, indexOptions)
      }
      if (await db.collection(collection.name).countDocuments() !== collection.documents) throw safety('Restored document count does not match')
    }
    if (mediaTarget) {
      await fsp.mkdir(mediaTarget, { mode: 0o700 }); createdMedia = true
      for (const file of manifest.media.files) {
        const destination = path.join(mediaTarget, ...file.path.slice('media/'.length).split('/'))
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.copyFile(await archiveFile(root, file.path), destination, fs.constants.COPYFILE_EXCL)
        await fsp.chmod(destination, 0o600)
        const actual = await hashFile(destination)
        if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw safety('Restored media checksum mismatch')
        outcome.restoredMediaFiles += 1
      }
    }
    outcome.status = 'complete'
  } catch (error) {
    outcome.error = safeFailure(error)
    outcome.cleanup = { attempted: true, removedCollections: [], failedCollections: [], removedMedia: false }
    // Only resources created by this attempt are eligible for cleanup. Never dropDatabase().
    if (db) for (const name of [...createdCollections].reverse()) {
      try { await db.collection(name).drop(); outcome.cleanup.removedCollections.push(name) } catch (cleanupError) { if (cleanupError.code !== 26) outcome.cleanup.failedCollections.push(name) }
    }
    if (createdMedia) {
      try {
        const checked = await checkedPath(mediaTarget)
        if (checked !== mediaTarget || inside(root, checked) || checked === path.parse(checked).root) throw safety('Unsafe cleanup target')
        await fsp.rm(checked, { recursive: true, force: false }); outcome.cleanup.removedMedia = true
      } catch { outcome.cleanup.mediaCleanupFailed = true }
    }
    throw Object.assign(new Error(outcome.error), { code: error.code, outcomePath, outcome })
  } finally {
    outcome.completedAt = new Date().toISOString()
    if (client) await client.close()
    await writeOutcome(outcomePath, outcome)
  }
  return { outcomePath, outcome }
}

module.exports = { backupDatabase, restoreDatabase, validateBackup, databaseName, DEFAULT_UPLOADS }
