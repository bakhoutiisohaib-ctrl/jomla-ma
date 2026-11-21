'use strict';
// Create a NEW offline candidate only. Never installs, switches a release pin,
// connects to Mongo, copies credentials/media, or starts application processes.
const fs = require('fs'), path = require('path');
const { releaseFiles, hash } = require('./launch.cjs');
function prepare({ source, build, output, releaseId, nodeVersion }) {
  if (![source, build, output].every(x => x && path.isAbsolute(x)) || !/^[a-zA-Z0-9_-]{1,80}$/.test(releaseId) || !/^v24\.\d+\.\d+$/.test(nodeVersion)) throw new Error('Invalid candidate arguments');
  const src = fs.realpathSync(source), web = fs.realpathSync(build), out = path.resolve(output);
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  if (fs.existsSync(out) || overlaps(src, out) || overlaps(web, out) || fs.realpathSync(path.dirname(out)) !== path.dirname(out)) throw new Error('Fresh independent output required');
  fs.mkdirSync(out); const copy = (from, rel) => { const target = path.join(out, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(from, target, fs.constants.COPYFILE_EXCL); };
  function tree(dir, rel, accept) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file), target = rel + '/' + name;
      if (/(^\.env(?:\.|$)|\.env$|\.(?:key|pem|pfx|bson)$)/i.test(name)) throw new Error('Private file refused');
      if (stat.isSymbolicLink()) throw new Error('Source link refused');
      if (stat.isDirectory()) tree(file, target, accept); else if (stat.isFile() && accept(name)) copy(file, target);
    }
  }
  for (const dir of ['middleware', 'models', 'routes', 'services', 'utils', 'workers']) tree(path.join(src, 'backend', dir), 'backend/' + dir, name => name.endsWith('.js'));
  for (const file of ['start.js', 'server.js', 'package.json', 'package-lock.json']) copy(path.join(src, 'backend', file), 'backend/' + file);
  copy(path.join(src, 'backend/scripts/sourcingCreationIndex.js'), 'backend/scripts/sourcingCreationIndex.js');
  for (const file of ['backup.js', 'restore.js', 'preflight.js']) copy(path.join(src, 'scripts', file), 'scripts/' + file);
  tree(path.join(src, 'ops/pilot'), 'ops/pilot', () => true);
  tree(web, 'frontend/build', name => { if (/^\.env(?:\.|$)/.test(name)) throw new Error('Build environment file refused'); return true; });
  const manifest = { version: 1, releaseId, nodeVersion, files: releaseFiles(out).map(file => ({ path: file, sha256: hash(path.join(out, file)) })) };
  fs.writeFileSync(path.join(out, 'release-manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return { releaseId, files: manifest.files.length, manifestSha256: hash(path.join(out, 'release-manifest.json')), dependenciesIncluded: false, activated: false };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 5) { console.error('Usage: node prepare-release.cjs ABS_SOURCE ABS_BUILD NEW_ABS_OUTPUT RELEASE_ID v24.X.Y'); process.exitCode = 1; }
  else try { console.log(JSON.stringify(prepare({ source: args[0], build: args[1], output: args[2], releaseId: args[3], nodeVersion: args[4] }))); }
  catch { console.error('PILOT_CANDIDATE_REFUSED; partial NEW output may remain for inspection'); process.exitCode = 1; }
}
module.exports = { prepare };
