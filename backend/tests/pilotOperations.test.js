// Operations guards only: no application/model import, original .env or DB.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const root = path.resolve(__dirname, '../..');
const { prepare } = require('../../ops/pilot/prepare-release.cjs');
const { inspectRelease, hash } = require('../../ops/pilot/launch.cjs');
let dir, release, spec, specFile, env;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-ops1-unit-'));
  const build = path.join(dir, 'build'); fs.mkdirSync(build); fs.writeFileSync(path.join(build, 'index.html'), '<html>synthetic build only</html>');
  release = path.join(dir, 'release');
  const result = prepare({ source: root, build, output: release, releaseId: 'ops1-test', nodeVersion: 'v24.22.1' });
  const uploads = path.join(dir, 'media'), logs = path.join(dir, 'logs'); fs.mkdirSync(uploads); fs.mkdirSync(logs);
  spec = { version: 1, releaseId: 'ops1-test', releasePath: release, manifestSha256: result.manifestSha256, nodeVersion: 'v24.22.1', database: 'ops1_synthetic', port: 55001, origin: 'https://localhost:55002', uploadsPath: uploads, logPath: logs };
  specFile = path.join(dir, 'pin.json'); fs.writeFileSync(specFile, JSON.stringify(spec));
  env = { NODE_ENV: 'production', JOB_WORKER_MODE: 'external', DISABLE_REDIS: '1', TRUST_PROXY: '1', NODE_OPTIONS: '--max-old-space-size=512', CORS_ORIGIN: spec.origin,
    MONGODB_URI: 'mongodb://synthetic:ops1-test-only@127.0.0.1:55003/ops1_synthetic?authSource=ops1_synthetic', JWT_SECRET: 'ops1-synthetic-guard-secret-no-real-accounts-2026', PORT: '55001', UPLOADS_DIR: uploads, LOG_DIR: logs,
    CLAUDE_API_KEY: '', CLAUDE_MODEL: '', GOOGLE_VISION_KEY: '', GOOGLE_APPLICATION_CREDENTIALS: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', EXTERNAL_DISCOVERY_TERMS_ACCEPTED: 'false' };
});
const inspect = (role = 'api') => inspectRelease(specFile, role, env, 'v24.22.1');
test('API and worker pin the same immutable source and client build without secrets or media', () => {
  expect(inspect().root).toBe(inspect('worker').root);
  expect(inspect().entry).toBe(path.join(release, 'backend/start.js'));
  expect(inspect('worker').entry).toBe(path.join(release, 'backend/workers/worker.js'));
  expect(fs.existsSync(path.join(release, 'backend/.env'))).toBe(false);
  expect(fs.existsSync(path.join(release, 'backend/uploads'))).toBe(false);
  expect(fs.existsSync(path.join(release, 'backend/tests'))).toBe(false);
});
test('wrong Node version or role is refused before any child is spawned', () => {
  expect(() => inspectRelease(specFile, 'api', env, 'v25.9.0')).toThrow('PILOT_RELEASE_PIN_INVALID');
  expect(() => inspect('legacy')).toThrow('PILOT_ROLE_INVALID');
});
test.each(['backend/server.js', 'backend/workers/worker.js', 'frontend/build/index.html'])('tampering with %s blocks either role', file => {
  fs.appendFileSync(path.join(release, file), '\n/* synthetic tamper */');
  expect(() => inspect()).toThrow('PILOT_SOURCE_MISMATCH'); expect(() => inspect('worker')).toThrow('PILOT_SOURCE_MISMATCH');
});
test('unlisted code, environment files and a changed manifest fail closed', () => {
  const extra = path.join(release, 'backend/extra.js'); fs.writeFileSync(extra, 'module.exports = 1');
  expect(() => inspect()).toThrow('PILOT_UNLISTED_SOURCE');
  // Independent candidates avoid deleting anything to switch failure modes.
  fs.writeFileSync(path.join(release, 'backend/.env'), 'JWT_SECRET=synthetic-only');
  expect(() => inspect()).toThrow('PILOT_ENV_FILE_IN_RELEASE');
  fs.appendFileSync(path.join(release, 'release-manifest.json'), ' ');
  expect(() => inspect()).toThrow('PILOT_MANIFEST_MISMATCH');
});
test.each(['CLAUDE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'BRAVE_SEARCH_API_KEY'])('real-provider capability %s is rejected', key => {
  env[key] = 'synthetic-not-a-real-key'; expect(() => inspect()).toThrow('PILOT_PROVIDER_DISABLED');
});
test('unapproved proxy, database, origin and process environment are refused', () => {
  const saved = { ...env };
  env.TRUST_PROXY = 'true'; expect(() => inspect()).toThrow('PILOT_RUNTIME_POLICY'); Object.assign(env, saved);
  env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unapproved'; expect(() => inspect()).toThrow('PILOT_DATABASE_CONFIGURATION'); Object.assign(env, saved);
  env.CORS_ORIGIN = '*'; expect(() => inspect()).toThrow('PILOT_ORIGIN_OR_DATABASE'); Object.assign(env, saved);
  env.NODE_OPTIONS = '--require unapproved.cjs'; expect(() => inspect()).toThrow('PILOT_RUNTIME_POLICY'); Object.assign(env, saved);
  env.HTTPS_PROXY = 'http://unapproved.invalid'; expect(() => inspect()).toThrow('PILOT_UNAPPROVED_PROCESS_ENV');
});
test('persistent storage cannot be moved inside the release', () => {
  spec.uploadsPath = path.join(release, 'backend'); env.UPLOADS_DIR = spec.uploadsPath; fs.writeFileSync(specFile, JSON.stringify(spec));
  expect(() => inspect()).toThrow('PILOT_PERSISTENT_PATH');
});
test('an existing or overlapping candidate output is never overwritten', () => {
  const options = { source: root, build: path.join(dir, 'build'), releaseId: 'ops1-test', nodeVersion: 'v24.22.1' };
  const previous = hash(path.join(release, 'backend/server.js'));
  expect(() => prepare({ ...options, output: release })).toThrow('Fresh independent output required');
  expect(() => prepare({ ...options, output: path.join(root, 'unsafe-release') })).toThrow('Fresh independent output required');
  expect(hash(path.join(release, 'backend/server.js'))).toBe(previous);
});
test('offline template validation succeeds but explicitly refuses to certify deployment', () => {
  const run = cp.spawnSync(process.execPath, [path.join(root, 'scripts/check-pilot-blueprint.js')], { encoding: 'utf8' });
  expect(run.status).toBe(0); const result = JSON.parse(run.stdout);
  expect(result.deploymentReady).toBe(false); expect(result.nativeCaddySystemdNftWireGuardValidationPerformed).toBe(false);
  expect(result.checks.every(c => c.passed)).toBe(true);
});
