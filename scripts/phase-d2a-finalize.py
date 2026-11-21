"""Audit D2-A source scope and synthetic evidence without touching app/data."""
from pathlib import Path
import hashlib, json, subprocess, zipfile
root=Path(__file__).resolve().parents[1]
out=root/'reports/phase-d2a-evidence'
def read(name): return json.loads((out/name).read_text(encoding='utf-8-sig'))
def sha(data): return hashlib.sha256(data).hexdigest()
baseline=read('safety/before-source-manifest.json')
allowed={f'frontend/src/components/suppliers/{name}' for name in ['JobsPanel.jsx','ProductEditor.jsx','ProductEditor.test.jsx','StoresPanel.jsx','SupplierDashboard.jsx','SupplierDashboard.test.jsx']}
changed=[]; unexpected=[]; missing=[]
archive=out/'safety/source-before-d2a.zip'
assert sha(archive.read_bytes())==baseline['archiveSha256']
with zipfile.ZipFile(archive) as z:
    for item in baseline['files']:
        p=root/item['path']
        if not p.is_file(): missing.append(item['path']); continue
        if sha(p.read_bytes())!=item['sha256']:
            changed.append(item['path'])
            if item['path'] not in allowed: unexpected.append(item['path'])
    old=z.read('frontend/src/components/suppliers/SupplierDashboard.jsx').decode('utf-8-sig')
    new=(root/'frontend/src/components/suppliers/SupplierDashboard.jsx').read_text(encoding='utf-8-sig')
    # Commercial action bodies are byte-for-byte the pre-D2-A implementation.
    def commercial(s): return s[s.index('  async function action('):s.index('  const unread')]
    assert commercial(old)==commercial(new)
assert set(changed)==allowed and not unexpected and not missing,(changed,unexpected,missing)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==baseline['head']
assert not subprocess.check_output(['git','diff','--cached','--binary'],cwd=root)
subprocess.run(['git','-c','core.safecrlf=false','diff','--check'],cwd=root,check=True)
tests={}
for name,total,suites in [('backend',273,22),('frontend',125,14)]:
    d=read(name+'-tests.json')
    assert d['success'] and d['numPassedTests']==total and d['numFailedTests']==0 and d['numPassedTestSuites']==suites
    tests[name]={'passed':total,'suites':suites,'failed':0}
assert 'Compiled successfully.' in (out/'production-build.log').read_text(encoding='utf-8')
b=read('browser-verification.json')
assert len(b['views'])>=42
for key,v in b['views'].items():
    assert v['scroll']<=v['client'],key
    assert v['lang']==('ar' if '-ar-' in key else 'fr'),key
    assert v['dir']==('rtl' if '-ar-' in key else 'ltr'),key
    assert all(i['loaded'] and i['blob'] for i in v['images']),key
    assert (out/'screens'/f'{key}.jpg').stat().st_size>1000,key
f=b['flows']
for key in ['mainUpload','secondaryUpload','draftSaved','draftAfterReload','reopenedDraftRightsUnchecked','reviewConsentInitiallyUnchecked','publishDisabledBeforeConsent','publishEnabledAfterConsent','publishedByExplicitAction','existingRfqDialog','optionalVerificationHelp','reviewsVisible','sourcingVisible','existingNotificationVisible','existingReadNotificationUpdatesBell','inlineLeaveWarning','explicitDiscardOpensStores','logoutRemovesPrivateInput']:
    assert f[key] is True,key
assert f['accountSwitchClearsEditor']=={'title':'','images':0,'rights':False}
assert f['keyboardSkipLink']=='supplier-main'
assert f['failedPublishPreservesReview']['consentCleared'] and f['failedPublishPreservesReview']['publishDisabled']
assert read('api-draft.json')['publicProductStatus']==404
assert read('api-published.json')['publicProductStatus']==200
assert read('api-draft.json')['productId']==read('api-published.json')['productId']
assert read('api-published.json')['uniqueProduct']
for name in ['browser-before','browser-after','browser-check']:
    d=read(name+'/preview-shutdown.json')
    assert d['stopped'] and d['temporaryDirectoryRemoved'] and not d['originalDatabaseUsed']
assert f.get('organizationVisibleAfterWait') is True
result={'date':'2026-10-21','baselineFiles':len(baseline['files']),'archiveVerified':True,'archiveBytes':baseline['archiveBytes'],
 'changedBaselineFiles':changed,'unexpectedChanges':unexpected,'missingFiles':missing,'headAndIndexUnchanged':True,
 'commercialActionBodiesUnchanged':True,'backendAndPublicD1AndBuyerSourcesUnchanged':True,'tests':tests,
 'productionBuild':'passed','screenshots':len(b['views']),'horizontalOverflow':0,
 'draftAndPublishedMediaIndependentlyChecked':True,'accountSwitchClearedPrivateEditor':True,'syntheticPreviewRootsRemoved':True,'originalDatabaseUsed':False}
(out/'final-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
rows=['# D2-A — مقارنة قبل/بعد','','بيانات اصطناعية فقط. الحاسوب 1440×1000 والهاتف 390×844. القاعدتان مستقلتان بالبذور نفسها؛ أُضيف منتج أثناء رحلة ما بعد التعديل، وقُرئ إشعار تجريبي. المقارنة بصرية، وليست قياس معدل تحويل.','','| اللغة والمقاس | نظرة عامة قبل | نظرة عامة بعد | المحرر قبل | الخطوة 1 | الخطوة 2 | الخطوة 3 |','|---|---|---|---|---|---|---|']
for lang in ['ar','fr']:
    for device in ['desktop','phone']:
        end=f'{lang}-{device}'
        names=[f'before-overview-{end}',f'after-overview-{end}',f'before-editor-{end}',f'after-step1-{end}',f'after-step2-{end}',f'after-step3-{end}']
        rows.append('| '+end+' | '+' | '.join(f'[عرض](screens/{n}.jpg)' for n in names)+' |')
rows+=['','## بقية اللقطات','']
for key in sorted(b['views']):
    if key.startswith('after-'): rows.append(f'- [{key}](screens/{key}.jpg)')
(out/'before-after-gallery.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True,indent=2))
