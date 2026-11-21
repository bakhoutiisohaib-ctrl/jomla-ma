"""Verify D1 evidence against the preserved working tree, without modifying app/data."""
from pathlib import Path
import hashlib, json, subprocess, zipfile

root = Path(__file__).resolve().parents[1]
evidence = root / 'reports/phase-d1-evidence'
def read(name):
    return json.loads((evidence / name).read_text(encoding='utf-8-sig'))
def sha(data):
    return hashlib.sha256(data).hexdigest()
baseline = read('safety/before-source-manifest.json')
allowed = {
    'frontend/src/App.js', 'frontend/src/App.test.js',
    'frontend/src/components/products/ProductCard.jsx',
    'frontend/src/components/products/ProductPage.jsx',
    'frontend/src/components/suppliers/StorePage.jsx',
}
changed, newline_only, unexpected, missing = [], [], [], []
archive = evidence / 'safety/source-before-d1.zip'
with zipfile.ZipFile(archive) as saved:
    for item in baseline['files']:
        target = root / item['path']
        if not target.is_file():
            missing.append(item['path'])
            continue
        now = target.read_bytes()
        if sha(now) != item['sha256']:
            if item['path'] in allowed:
                changed.append(item['path'])
            elif saved.read(item['path']).replace(b'\r\n', b'\n') == now.replace(b'\r\n', b'\n'):
                newline_only.append(item['path'])
            else:
                unexpected.append(item['path'])
assert not unexpected and not missing, (unexpected, missing)
assert set(changed) == allowed
assert sha(archive.read_bytes()) == baseline['archiveSha256']
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
assert head == baseline['head']
assert not subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=root)
subprocess.run(['git', '-c', 'core.safecrlf=false', 'diff', '--check'], cwd=root, check=True)
tests = {}
for name, total, suites in [('backend', 273, 22), ('frontend', 115, 14)]:
    result = read(name + '-tests.json')
    assert result['success'] and result['numPassedTests'] == total
    assert result['numFailedTests'] == 0 and result['numPassedTestSuites'] == suites
    tests[name] = dict(passed=total, suites=suites, failed=0)
assert 'Compiled successfully.' in (evidence/'production-build.log').read_text(encoding='utf-8')
browser = read('browser-verification.json')
assert len(browser['views']) == 32
for key, view in browser['views'].items():
    assert view['scroll'] <= view['client'], key
    assert view['lang'] == ('ar' if '-ar-' in key else 'fr'), key
    assert view['dir'] == ('rtl' if '-ar-' in key else 'ltr'), key
    assert all(i['loaded'] for i in view['visibleImages']), key
    assert (evidence/'screens'/f'{key}.jpg').stat().st_size > 1000
flows = browser['flows']
assert flows['logoutClearsBell'] and flows['buyerReload']
assert flows['afterBuyerLogin']['dialogVisible'] and flows['rfqSubmitted']['visible']
assert '100,00' in flows['quantityComparison']['table']
for key in ['draftDenied', 'pendingStoreDenied', 'suspendedStoreProductDenied']:
    assert flows[key]['images'] == 0
for session in ['browser', 'browser-final']:
    stopped = read(session+'/preview-shutdown.json')
    assert stopped['stopped'] and stopped['temporaryDirectoryRemoved'] and not stopped['originalDatabaseUsed']
assert read('browser/browser-db-result.json')['rfqCreatedByFixtureBuyer'] == 1
probes = read('browser-final/spa-http-probes.json')
assert next(p for p in probes if p['route'].startswith('/uploads/'))['status'] == 404
suspended = read('browser-final/preview-control-result.json')
assert suspended['action'] == 'suspendStore'
assert suspended['product']['status'] == suspended['store']['status'] == 404
assert suspended['logo']['status'] == 401
result = dict(date='2026-10-21', baselineFiles=len(baseline['files']),
    headUnchanged=True, indexUnchanged=True, archiveSha256Verified=True,
    changedBaselineFiles=changed, newlineOnlyDifferencesOutsideD1=newline_only,
    unexpectedContentChanges=[], missingBaselineFiles=[], tests=tests,
    productionBuild='passed', browserViews=32, horizontalOverflow=0,
    finalCaptureConsoleWarningsOrErrors=browser['finalCleanConsole'],
    rfqCreatedExactlyOnceInIsolatedDatabase=True,
    isolatedPreviewDirectoriesRemoved=True, originalDatabaseUsed=False)
(evidence/'final-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
rows = ['# D1 — مقارنة قبل/بعد', '', 'بيانات اصطناعية فقط. الحاسوب 1440×1000، الهاتف 390×844. اللقطات قبل التعديل من الجلسة الأولى؛ اللقطات النهائية من قاعدة اصطناعية جديدة بالبذور نفسها. لا تمثل بيانات تجارية حقيقية.', '', '| الصفحة / اللغة / المقاس | قبل | بعد |', '|---|---|---|']
for page in ['home','catalog','product','store']:
    for lang in ['ar','fr']:
        for device in ['desktop','phone']:
            key = f'{page}-{lang}-{device}'
            rows.append(f'| {key} | [قبل](screens/before-{key}.jpg) | [بعد](screens/after-{key}.jpg) |')
(evidence/'before-after-gallery.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print(json.dumps(result, ensure_ascii=True, indent=2))
