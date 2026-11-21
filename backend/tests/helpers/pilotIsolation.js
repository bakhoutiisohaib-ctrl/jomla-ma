// Phase 2 regression guard: load no project .env, and keep all mutable test
// images/logs outside the repository's original data directories.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs')
const os = require('os')
const path = require('path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-pilot-regression-'))
Object.assign(process.env, {
  NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/disabled_original_connection',
  JWT_SECRET: 'isolated-pilot-regression-secret-no-real-accounts',
  UPLOADS_DIR: path.join(root, 'uploads'), LOG_DIR: path.join(root, 'logs'),
  CLAUDE_API_KEY: '', GOOGLE_VISION_KEY: '', BRAVE_SEARCH_API_KEY: '',
  EXTERNAL_DISCOVERY_ENABLED: 'false', DISABLE_REDIS: '1'
})
fs.mkdirSync(process.env.UPLOADS_DIR)
fs.mkdirSync(process.env.LOG_DIR)
afterAll(() => {
  const resolved = path.resolve(root)
  if (path.dirname(resolved) !== os.tmpdir() || !path.basename(resolved).startsWith('jomla-pilot-regression-')) throw new Error('Unsafe test cleanup path')
  // The File transports can still have open handles on Windows. Keep any such
  // temporary logs rather than touching a project data directory for cleanup.
  try { fs.rmSync(resolved, { recursive: true, force: true }) } catch { /* temporary files only */ }
})
