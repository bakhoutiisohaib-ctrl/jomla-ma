#!/usr/bin/env node
const path = require('path')
const fs = require('fs')
const { MongoClient } = require('../backend/node_modules/mongoose').mongo

const DEFAULT_UPLOADS = path.resolve(__dirname, '../backend/uploads')

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true }
  if (args.length === 0) return { checkDatabase: false }
  if (args.length === 1 && args[0] === '--check-db') return { checkDatabase: true }
  throw new Error('Invalid arguments')
}

function isPublicHttpsReference(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.hostname.includes('.')
  } catch { return false }
}

// Importing this module does not load .env, the application, models, or connect.
// Dependency injection keeps tests entirely independent of the operator's environment.
async function runPreflight({ env = process.env, checkDatabase = false, filesystem = fs.promises, Client = MongoClient, pingTimeoutMs = 5000 } = {}) {
  const findings = []
  const add = (check, status, message) => findings.push({ check, status, message })
  const production = env.NODE_ENV === 'production'
  let validUri = false, client

  if (!env.MONGODB_URI) add('database.configuration', 'fatal', 'MongoDB connection configuration is missing.')
  else {
    try {
      // WHATWG URL rejects valid MongoDB replica-set lists containing several ports.
      // The MongoDB driver performs URI validation; this only requires an explicit database.
      if (!/^mongodb(?:\+srv)?:\/\/[^/]+\/[^?#/]+(?:[?#]|$)/.test(env.MONGODB_URI)) throw new Error('invalid')
      // The driver's parser validates options and hosts without opening a connection.
      client = new Client(env.MONGODB_URI, { serverSelectionTimeoutMS: pingTimeoutMs, connectTimeoutMS: pingTimeoutMs, socketTimeoutMS: pingTimeoutMs, timeoutMS: pingTimeoutMs })
      validUri = true
      add('database.configuration', 'pass', 'MongoDB connection syntax is configured; availability has not been inferred.')
    } catch { add('database.configuration', 'fatal', 'MongoDB connection syntax is invalid or an explicit database is missing.') }
  }

  const secret = env.JWT_SECRET || ''
  if (secret.length < 32 || /replace|example|your.secret|change.?me/i.test(secret) || new Set(secret).size < 8) add('jwt.secret', 'fatal', 'The session signing secret must be unique, non-placeholder, and at least 32 characters; this basic check does not prove entropy.')
  else add('jwt.secret', 'pass', 'The session signing secret passes basic length and placeholder checks; entropy and secrecy are not verified.')

  const origins = (env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  if (!origins.length) add('cors.origins', production ? 'fatal' : 'warning', 'Allowed browser origins are not explicitly configured.')
  else if (origins.some(value => value.includes('*'))) add('cors.origins', production ? 'fatal' : 'warning', 'Wildcard browser origins require replacement with explicit application origins before production.')
  else {
    const valid = origins.every(value => {
      try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash } catch { return false }
    })
    add('cors.origins', valid ? 'pass' : 'fatal', valid ? 'Explicit browser origin syntax is configured; deployment reachability is not checked.' : 'Allowed browser origins must be valid HTTP or HTTPS origins without credentials, paths, queries, or fragments.')
  }

  const uploads = env.UPLOADS_DIR || DEFAULT_UPLOADS
  if (!path.isAbsolute(uploads)) add('media.directory', 'fatal', 'The configured uploads directory must be absolute.')
  else {
    try {
      const stat = await filesystem.lstat(uploads)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('invalid directory')
      await filesystem.access(uploads, fs.constants.R_OK | fs.constants.W_OK)
      add('media.directory', 'pass', 'Uploads directory exists and access checks permit reading and writing; no file was written and persistence is not verified.')
    } catch { add('media.directory', 'fatal', 'Uploads directory is missing, linked, not a directory, or lacks required read/write access; no directory or file was created.') }
  }

  const workerMode = env.JOB_WORKER_MODE || 'embedded'
  if (!['embedded', 'external'].includes(workerMode)) add('jobs.worker', 'fatal', 'Background worker mode must be embedded or external.')
  else add('jobs.worker', workerMode === 'external' ? 'warning' : 'pass', workerMode === 'external' ? 'An external worker is configured; process liveness and job execution were not checked.' : 'An embedded worker is configured; startup and job execution were not checked.')

  if (env.CLAUDE_API_KEY) add('ai.configuration', 'pass', 'AI credential configuration is present; provider authentication, billing, model availability, and live analysis were not tested.')
  else add('ai.configuration', 'warning', 'AI credential configuration is absent; live analysis is unavailable until configured and verified.')

  if (env.EXTERNAL_DISCOVERY_ENABLED !== 'true') add('external.configuration', 'warning', 'External discovery is disabled; no external provider was contacted.')
  else if (env.EXTERNAL_DISCOVERY_PROVIDER !== 'brave' || !env.BRAVE_SEARCH_API_KEY || env.EXTERNAL_DISCOVERY_TERMS_ACCEPTED !== 'true' || !isPublicHttpsReference(env.EXTERNAL_DISCOVERY_TERMS_REFERENCE)) add('external.configuration', 'warning', 'External discovery was enabled but required provider, credential, or terms configuration is incomplete; no provider was contacted.')
  else add('external.configuration', 'pass', 'External discovery configuration is present; provider validity, live responses, and legal approval were not verified.')

  if (!checkDatabase) add('database.ping', 'skipped', 'Database connection check was not requested; no database connection was opened.')
  else if (!validUri) add('database.ping', 'skipped', 'Database connection check was skipped because connection configuration is invalid.')
  else {
    let timer
    try {
      const operation = (async () => { await client.connect(); await client.db().command({ ping: 1 }, { timeoutMS: pingTimeoutMs }) })()
      await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), pingTimeoutMs) })])
      add('database.ping', 'pass', 'The database accepted a read-only ping; no models, index initialization, application collections, or data queries were used.')
    } catch { add('database.ping', 'warning', 'Database ping failed or exceeded its time budget; connection details and server errors are intentionally omitted.') }
    finally { clearTimeout(timer); await client.close().catch(() => {}) }
  }

  // Do not serialize configuration values, hostnames, paths, accounts, or server errors.
  const status = findings.some(finding => finding.status === 'fatal') ? 'blocked' : findings.some(finding => finding.status === 'warning') ? 'warnings' : 'ok'
  return { status, findings }
}

async function main() {
  let options
  try { options = parseArguments(process.argv.slice(2)) } catch {
    process.stdout.write(JSON.stringify({ status: 'blocked', findings: [{ check: 'arguments', status: 'fatal', message: 'Use --check-db for an optional read-only database ping, or --help for usage.' }] }, null, 2) + '\n')
    process.exitCode = 1
    return
  }
  if (options.help) { process.stdout.write('Usage: node scripts/preflight.js [--check-db]\nDefault: local configuration and filesystem access checks only. Optional ping is read-only. JSON never contains configuration values. Redirect stdout to save a report.\n'); return }
  require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env'), quiet: true })
  const result = await runPreflight(options)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  process.exitCode = result.status === 'blocked' ? 1 : 0
}

if (require.main === module) main().catch(() => {
  process.stdout.write(JSON.stringify({ status: 'blocked', findings: [{ check: 'preflight', status: 'fatal', message: 'Preflight could not complete; raw error details were suppressed.' }] }, null, 2) + '\n')
  process.exitCode = 1
})

module.exports = { runPreflight, parseArguments }
