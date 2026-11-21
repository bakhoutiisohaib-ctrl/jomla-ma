const fs = require('fs').promises
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

jest.setTimeout(20000)

let sandbox
const secretValue = 'u7WzvB9pQ2L5cR4oN8xJ3eT6aY0dH1mK'
const privateUri = 'mongodb://private_user:private_password@localhost:27017/private_database'
const configured = () => ({ NODE_ENV: 'production', MONGODB_URI: privateUri, JWT_SECRET: secretValue, CORS_ORIGIN: 'https://shop.example.com', UPLOADS_DIR: sandbox, JOB_WORKER_MODE: 'embedded', CLAUDE_API_KEY: 'private-ai-credential', EXTERNAL_DISCOVERY_ENABLED: 'true', EXTERNAL_DISCOVERY_PROVIDER: 'brave', BRAVE_SEARCH_API_KEY: 'private-brave-credential', EXTERNAL_DISCOVERY_TERMS_ACCEPTED: 'true', EXTERNAL_DISCOVERY_TERMS_REFERENCE: 'https://example.com/terms' })
const finding = (result, name) => result.findings.find(item => item.check === name)

// A native Node subprocess can import the root CLI outside Jest's backend root.
// It receives only synthetic application settings through stdin and never calls main/dotenv.
const runner = `
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'))
const api = require(process.argv[1])
if (input.arguments) {
  try { process.stdout.write(JSON.stringify({ parsed: api.parseArguments(input.arguments) })) }
  catch { process.stdout.write(JSON.stringify({ invalidArguments: true })) }
} else {
  const calls = { connect: 0, command: 0, close: 0, db: 0, access: 0 }
  const options = { env: input.env, checkDatabase: input.checkDatabase || false }
  if (input.scenario) {
    options.Client = class {
      constructor(_uri, settings) { calls.settings = settings }
      async connect() { calls.connect++; if(input.scenario === 'fail') throw new Error(input.env.MONGODB_URI); if(input.scenario === 'timeout') await new Promise(() => {}) }
      db(...args) { calls.db++; calls.dbArgumentCount = args.length; return { command: async (...args) => { calls.command++; calls.commandArguments = args; return { ok: 1 } } } }
      async close() { calls.close++ }
    }
  }
  if (input.scenario === 'timeout') options.pingTimeoutMs = 10
  if (input.readOnlyFilesystem) options.filesystem = { lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }), access: async () => { calls.access++; throw new Error('EACCES') } }
  api.runPreflight(options).then(result => process.stdout.write(JSON.stringify({ result, calls }))).catch(() => process.exitCode = 2)
}
`

function invoke(input) {
  const child = spawnSync(process.execPath, ['-e', runner, path.resolve(__dirname, '../../scripts/preflight.js')], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 10000,
    // Keep only the Windows runtime prerequisite, never the operator's application environment.
    env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || 'C:\\Windows' } : {}
  })
  if (child.error) throw child.error
  expect(child.status).toBe(0)
  expect(child.stderr).toBe('')
  return JSON.parse(child.stdout)
}
const run = (change = {}, options = {}) => invoke({ env: { ...configured(), ...change }, ...options })

beforeAll(async () => { sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'jomla-preflight-tests-')) })
afterAll(async () => {
  if (sandbox && path.dirname(sandbox) === os.tmpdir() && path.basename(sandbox).startsWith('jomla-preflight-tests-')) await fs.rm(sandbox, { recursive: true, force: true })
})

test('default checks use synthetic configuration without opening a connection or writing a file', async () => {
  const before = await fs.readdir(sandbox)
  const { result, calls } = run({}, { scenario: 'success' })
  expect(result.status).toBe('ok')
  expect(calls.connect).toBe(0)
  expect(calls.command).toBe(0)
  expect(finding(result, 'database.ping').status).toBe('skipped')
  expect(await fs.readdir(sandbox)).toEqual(before)
  expect(Object.keys(result).sort()).toEqual(['findings', 'status'])
  const serialized = JSON.stringify(result)
  for (const value of [privateUri, 'private_user', 'private_password', 'private_database', secretValue, sandbox, 'private-ai-credential', 'private-brave-credential', 'shop.example.com']) expect(serialized).not.toContain(value)
})

test('optional ping invokes exactly ping without importing models or reading application data', () => {
  const { result, calls } = run({}, { checkDatabase: true, scenario: 'success' })
  expect(calls.settings).toEqual(expect.objectContaining({ serverSelectionTimeoutMS: 5000, timeoutMS: 5000 }))
  expect(calls.connect).toBe(1)
  expect(calls.command).toBe(1)
  expect(calls.commandArguments).toEqual([{ ping: 1 }, { timeoutMS: 5000 }])
  expect(calls.dbArgumentCount).toBe(0)
  expect(calls.close).toBe(1)
  expect(finding(result, 'database.ping').status).toBe('pass')
})

test('ping failures and optional missing providers are warnings with no raw errors or secrets', () => {
  const { result } = run({ CLAUDE_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', JOB_WORKER_MODE: 'external' }, { checkDatabase: true, scenario: 'fail' })
  expect(result.status).toBe('warnings')
  for (const check of ['database.ping', 'ai.configuration', 'external.configuration', 'jobs.worker']) expect(finding(result, check).status).toBe('warning')
  expect(JSON.stringify(result)).not.toContain(privateUri)
})

test('ping time budget is bounded and the client is closed', () => {
  const { result, calls } = run({}, { checkDatabase: true, scenario: 'timeout' })
  expect(finding(result, 'database.ping').status).toBe('warning')
  expect(calls.close).toBe(1)
})

test.each([
  ['missing URI', { MONGODB_URI: '' }, 'database.configuration'],
  ['malformed URI', { MONGODB_URI: 'https://example.com/secret' }, 'database.configuration'],
  ['missing database', { MONGODB_URI: 'mongodb://localhost:27017/' }, 'database.configuration'],
  ['weak secret', { JWT_SECRET: 'tiny' }, 'jwt.secret'],
  ['placeholder secret', { JWT_SECRET: 'replace_with_a_unique_random_secret_of_at_least_32_characters' }, 'jwt.secret'],
  ['repeated secret', { JWT_SECRET: 'x'.repeat(40) }, 'jwt.secret'],
  ['wildcard CORS', { CORS_ORIGIN: '*' }, 'cors.origins'],
  ['missing production CORS', { CORS_ORIGIN: '' }, 'cors.origins'],
  ['CORS URL path', { CORS_ORIGIN: 'https://example.com/path' }, 'cors.origins'],
  ['relative media', { UPLOADS_DIR: 'relative/uploads' }, 'media.directory'],
  ['worker mode', { JOB_WORKER_MODE: 'mistyped' }, 'jobs.worker']
])('%s is a fatal configuration problem', (_label, change, check) => {
  const { result } = run(change)
  expect(result.status).toBe('blocked')
  expect(finding(result, check).status).toBe('fatal')
})

test('filesystem access checks reject unavailable and read-only media without writing', async () => {
  const { result, calls } = run({}, { readOnlyFilesystem: true })
  expect(finding(result, 'media.directory').status).toBe('fatal')
  expect(calls.access).toBe(1)
  const missing = run({ UPLOADS_DIR: path.join(sandbox, 'missing') }).result
  expect(finding(missing, 'media.directory').status).toBe('fatal')
  expect(await fs.readdir(sandbox)).toEqual([])
})

test('provider configuration presence cannot be reported as live verification', () => {
  const { result } = run()
  expect(finding(result, 'ai.configuration').message).toMatch('were not tested')
  expect(finding(result, 'external.configuration').message).toMatch('were not verified')
  const incomplete = run({ BRAVE_SEARCH_API_KEY: '' }).result
  expect(finding(incomplete, 'external.configuration').status).toBe('warning')
})

test('valid replica-set URI syntax is accepted without connecting to any host', () => {
  const { result, calls } = run({ MONGODB_URI: 'mongodb://127.0.0.1:27017,127.0.0.1:27018/private_database?replicaSet=synthetic' })
  expect(finding(result, 'database.configuration').status).toBe('pass')
  expect(finding(result, 'database.ping').status).toBe('skipped')
  expect(calls.connect).toBe(0)
})

test('argument parser only allows an explicit database check', () => {
  expect(invoke({ arguments: [] }).parsed).toEqual({ checkDatabase: false })
  expect(invoke({ arguments: ['--check-db'] }).parsed).toEqual({ checkDatabase: true })
  expect(invoke({ arguments: ['--help'] }).parsed).toEqual({ help: true })
  expect(invoke({ arguments: ['--uri', privateUri] }).invalidArguments).toBe(true)
  expect(invoke({ arguments: ['--check-db', '--write'] }).invalidArguments).toBe(true)
})
