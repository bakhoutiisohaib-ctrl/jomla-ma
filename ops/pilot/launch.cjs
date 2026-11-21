'use strict';
// Operations entry point only. No dotenv, model import, DB connection or index
// provisioning. systemd/flock own exclusivity; this guard pins the child release.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const ENTRIES = { api: 'backend/start.js', worker: 'backend/workers/worker.js' };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
function releaseFiles(root) {
  const result = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'node_modules') continue; // Locked installation verified separately.
      if (/(^\.env(?:\.|$)|\.env$|\.(?:key|pem|pfx|bson)$)/i.test(name)) fail('PILOT_ENV_FILE_IN_RELEASE');
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail('PILOT_RELEASE_LINK');
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) result.push(path.relative(root, file).split(path.sep).join('/'));
      else fail('PILOT_RELEASE_SPECIAL_FILE');
    }
  }
  for (const name of ['backend', 'frontend', 'ops', 'scripts']) {
    const dir = path.join(root, name); if (fs.existsSync(dir)) walk(dir);
  }
  return result.sort();
}
function inspectRelease(specFile, role, env = process.env, version = process.version) {
  if (!ENTRIES[role]) fail('PILOT_ROLE_INVALID');
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  if (spec.version !== 1 || !/^[a-zA-Z0-9_-]{1,80}$/.test(spec.releaseId) || /REPLACE/.test(spec.releaseId) ||
      !/^v24\.\d+\.\d+$/.test(spec.nodeVersion) || version !== spec.nodeVersion || !/^[a-f0-9]{64}$/.test(spec.manifestSha256)) fail('PILOT_RELEASE_PIN_INVALID');
  if (!path.isAbsolute(spec.releasePath)) fail('PILOT_RELEASE_PATH');
  const root = fs.realpathSync(spec.releasePath);
  if (root !== path.resolve(spec.releasePath)) fail('PILOT_RELEASE_SYMLINK');
  const manifestFile = path.join(root, 'release-manifest.json');
  if (hash(manifestFile) !== spec.manifestSha256) fail('PILOT_MANIFEST_MISMATCH');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.version !== 1 || manifest.releaseId !== spec.releaseId || manifest.nodeVersion !== spec.nodeVersion || !Array.isArray(manifest.files)) fail('PILOT_MANIFEST_INVALID');
  const listed = [];
  for (const row of manifest.files) {
    if (!row.path || row.path.includes('\\') || row.path.split('/').some(x => !x || x === '..' || x === '.') || path.isAbsolute(row.path) || !/^[a-f0-9]{64}$/.test(row.sha256)) fail('PILOT_MANIFEST_PATH');
    const target = path.resolve(root, row.path);
    if (!inside(root, target) || fs.realpathSync(target) !== target || hash(target) !== row.sha256) fail('PILOT_SOURCE_MISMATCH');
    listed.push(row.path);
  }
  if (new Set(listed).size !== listed.length || JSON.stringify(listed.sort()) !== JSON.stringify(releaseFiles(root))) fail('PILOT_UNLISTED_SOURCE');
  for (const file of [...Object.values(ENTRIES), 'backend/server.js', 'backend/routes/media.js', 'backend/package-lock.json', 'frontend/build/index.html', 'ops/pilot/preload.cjs']) if (!listed.includes(file)) fail('PILOT_RELEASE_INCOMPLETE');
  if (env.NODE_ENV !== 'production' || env.JOB_WORKER_MODE !== 'external' || env.DISABLE_REDIS !== '1' || env.TRUST_PROXY !== '1' || env.NODE_OPTIONS !== '--max-old-space-size=512' || !Number.isInteger(spec.port) || spec.port < 1024 || spec.port > 65535 || Number(env.PORT) !== spec.port) fail('PILOT_RUNTIME_POLICY');
  if (!/^https:\/\/[^/?#]+$/.test(spec.origin) || env.CORS_ORIGIN !== spec.origin || !/^[a-zA-Z0-9_-]+$/.test(spec.database)) fail('PILOT_ORIGIN_OR_DATABASE');
  let uri; try { uri = new URL(env.MONGODB_URI); } catch { fail('PILOT_DATABASE_CONFIGURATION'); }
  if (uri.protocol !== 'mongodb:' || uri.hostname !== '127.0.0.1' || !uri.username || !uri.password || decodeURIComponent(uri.pathname.slice(1)) !== spec.database || uri.searchParams.get('authSource') !== spec.database || /REPLACE/.test(env.MONGODB_URI)) fail('PILOT_DATABASE_CONFIGURATION');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || new Set(env.JWT_SECRET).size < 8 || /REPLACE|example|change.?me/i.test(env.JWT_SECRET)) fail('PILOT_SESSION_CONFIGURATION');
  for (const key of ['CLAUDE_API_KEY', 'CLAUDE_MODEL', 'GOOGLE_VISION_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'BRAVE_SEARCH_API_KEY']) if (env[key]) fail('PILOT_PROVIDER_DISABLED');
  if (env.EXTERNAL_DISCOVERY_ENABLED !== 'false' || env.EXTERNAL_DISCOVERY_TERMS_ACCEPTED !== 'false') fail('PILOT_PROVIDER_DISABLED');
  if (env.NODE_PATH || env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY) fail('PILOT_UNAPPROVED_PROCESS_ENV');
  for (const [key, value] of [['UPLOADS_DIR', spec.uploadsPath], ['LOG_DIR', spec.logPath]]) {
    if (!value || !path.isAbsolute(value) || env[key] !== value || inside(root, path.resolve(value)) || fs.realpathSync(value) !== path.resolve(value)) fail('PILOT_PERSISTENT_PATH');
  }
  return { spec, root, entry: path.join(root, ENTRIES[role]) };
}
function launch({ role, specFile = '/etc/jomla-pilot/release.json', env = process.env } = {}) {
  const reviewed = inspectRelease(specFile, role, env);
  const child = spawn(process.execPath, ['--require', path.join(reviewed.root, 'ops/pilot/preload.cjs'), reviewed.entry], {
    cwd: path.join(reviewed.root, 'backend'), stdio: 'inherit',
    env: { ...env, PILOT_RELEASE_SPEC: path.resolve(specFile), PILOT_PROCESS_ROLE: role }
  });
  // Keep flock held while the child drains; systemd KillMode=control-group also
  // handles parent failure. No timeout is allowed to erase durable app intents.
  const forward = signal => { if (child.exitCode === null) child.kill(signal); };
  const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
  process.once('SIGTERM', term); process.once('SIGINT', interrupt);
  child.once('error', () => { console.error('PILOT_CHILD_START_FAILED'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt);
    process.exitCode = signal ? 1 : code || 0;
  });
  return child;
}
if (require.main === module) {
  try { if (process.argv.length !== 3) fail('PILOT_ROLE_INVALID'); launch({ role: process.argv[2] }); }
  catch (error) { console.error(/^PILOT_[A-Z_]+$/.test(error.code || '') ? error.code : 'PILOT_START_REFUSED'); process.exitCode = 1; }
}
module.exports = { inspectRelease, launch, releaseFiles, hash };
