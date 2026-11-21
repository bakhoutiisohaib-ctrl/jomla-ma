"""Create a local pre-D2-A source snapshot without staging, committing or reading ignored data."""
from pathlib import Path
import hashlib, json, subprocess, zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'reports' / 'phase-d2a-evidence' / 'safety'
out.mkdir(parents=True, exist_ok=True)
def git(*args):
    return subprocess.check_output(['git', '-c', 'core.safecrlf=false', *args], cwd=root, stderr=subprocess.DEVNULL)
paths = sorted(set(git('ls-files', '-c', '-o', '--exclude-standard', '-z').decode().split('\0')) - {''})
paths = [p for p in paths if not p.startswith('reports/phase-d2a-evidence/') and p != 'scripts/phase-d2a-snapshot.py']
files, omitted = [], []
for name in paths:
    file = root / name
    if not file.is_file():
        omitted.append(name); continue
    if file.name.startswith('.env') and not file.name.endswith('.example'):
        omitted.append(name); continue
    if not file.resolve().is_relative_to(root):
        raise RuntimeError('Snapshot path escaped workspace')
    files.append({'path': name, 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
archive = out / 'source-before-d2a.zip'
if archive.exists():
    raise RuntimeError('Pre-D2-A snapshot already exists; never overwrite it')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for item in files:
        z.write(root / item['path'], item['path'])
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for item in files:
        assert hashlib.sha256(z.read(item['path'])).hexdigest() == item['sha256']
(out / 'working-tree.patch').write_bytes(git('diff', '--binary'))
(out / 'index.patch').write_bytes(git('diff', '--cached', '--binary'))
(out / 'git-status-before.txt').write_bytes(git('status', '--porcelain=v1'))
result = {'date': '2026-10-21', 'head': git('rev-parse', 'HEAD').decode().strip(),
          'branch': git('branch', '--show-current').decode().strip(), 'files': files,
          'omittedPaths': omitted, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
          'archiveBytes': archive.stat().st_size, 'allArchivedFileHashesVerified': True,
          'ignoredSecretsDataDependenciesAndGitDirectoryExcluded': True,
          'gitIndexOrHistoryModified': False}
(out / 'before-source-manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(out / 'backup-notes.md').write_text('''# حفظ الحالة قبل D2-A

21 أكتوبر 2026. الخيار المعتمد: ZIP محلي لجميع الملفات المتتبعة وغير المتجاهلة الموجودة قبل D2-A، مع patch للشيفرة المتتبعة وبصمات SHA-256. لا Commit أو Push أو stash أو تغيير فهرس Git.

تتضمن النسخة الملفات غير المتتبعة ونتائج المراحل السابقة و.cache غير المتجاهلة. تستثني ملفات البيئة الفعلية والملفات المتجاهلة مثل node_modules/build/uploads/البيانات، ومجلد .git، ومخرجات D2-A الجديدة. backend/.env.example مثال متتبع ضمن النسخة، وليس سر البيئة.

تم التحقق من CRC وكل بصمات الملفات داخل الأرشيف. لا تُكتب أي ملفات من الأرشيف فوق المشروع أثناء التنفيذ.

للاسترجاع الآمن: فك source-before-d2a.zip في مجلد مراجعة جديد أولاً، وطابق before-source-manifest.json. عند الحاجة إلى تاريخ Git، استخدم HEAD المسجل في الفهرس في نسخة منفصلة ثم راجع الملفات المسترجعة. working-tree.patch وحده لا يحتوي الملفات غير المتتبعة؛ الأرشيف هو نسخة الاسترجاع الأساسية. index.patch يحفظ أي فروق مرحلية كانت موجودة. لا تنفذ reset أو clean أو فكاً مباشراً فوق عمل لاحق دون مراجعة.
''', encoding='utf-8')
print(json.dumps({'files': len(files), 'archiveBytes': archive.stat().st_size, 'verified': True, 'head': result['head']}))
