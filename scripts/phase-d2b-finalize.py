"""Audit local D2-B scope, isolated evidence and the preserved D2-A source tree."""
from pathlib import Path
import hashlib, json, subprocess, zipfile
from PIL import Image

root=Path(__file__).resolve().parents[1]
out=root/'reports/phase-d2b-evidence'
def read(name): return json.loads((out/name).read_text(encoding='utf-8-sig'))
def sha(data): return hashlib.sha256(data).hexdigest()
baseline=read('safety/before-source-manifest.json')
archive=out/'safety/source-before-d2b.zip'
assert sha(archive.read_bytes())==baseline['archiveSha256']
allowed={'frontend/src/App.js','frontend/src/components/buyer/BuyerDashboard.jsx','frontend/src/components/buyer/BuyerDashboard.test.jsx','frontend/src/components/suppliers/SupplierDashboard.jsx'}
changed=[];missing=[]
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for item in baseline['files']:
        assert sha(z.read(item['path']))==item['sha256']
        p=root/item['path']
        if not p.is_file():missing.append(item['path'])
        elif sha(p.read_bytes())!=item['sha256']:changed.append(item['path'])
    def text(name):return (root/name).read_text(encoding='utf-8-sig')
    name='frontend/src/components/suppliers/SupplierDashboard.jsx'
    old=z.read(name).decode('utf-8-sig').replace('\r\n','\n');new=text(name)
    for line in ["import AtlasDialog from '../common/AtlasDialog';\n","import { NegotiationMessages, OfferHistory } from '../common/NegotiationUI';\n"]:new=new.replace(line,'')
    assert old[:old.index('    {(selected || quoteTarget)')]==new[:new.index('    {(selected || quoteTarget)')]
    # All existing supplier request handlers, editor, product/store tabs and notifications are identical.
    name='frontend/src/App.js';old=z.read(name).decode('utf-8-sig').replace('\r\n','\n');new=text(name)
    before="if (page === 'buyer' && user?.role === 'buyer') return <><WorkspaceHeader title={l('مساحة المشتري', 'Espace acheteur')} onBack={back} onLogout={logout} /><BuyerDashboard key={sessionToken} user={user} onBack={back} /></>;"
    after="if (page === 'buyer' && user?.role === 'buyer') return <BuyerDashboard key={sessionToken} user={user} onBack={back} onLogout={logout} />;"
    assert old.replace(before,after)==new
assert set(changed)==allowed and not missing,(changed,missing)
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()==baseline['head']
assert not subprocess.check_output(['git','diff','--cached','--binary'],cwd=root)
subprocess.run(['git','-c','core.safecrlf=false','diff','--check'],cwd=root,check=True)
tests={}
for name,total,suites in [('backend',273,22),('frontend',137,16)]:
    d=read(name+'-tests.json');assert d['success'] and d['numPassedTests']==total and not d['numFailedTests'] and d['numPassedTestSuites']==suites
    tests[name]={'passed':total,'suites':suites,'failed':0}
assert 'Compiled successfully.' in (out/'production-build.log').read_text(encoding='utf-8')
b=read('browser-verification.json');f=b['flows']
for key in ['frozenOffer','escapeCloses','buyerMessageSent','accepted','acceptedNoComposer','rejected','retryWhileFaultRemainsPending','recovered','authorizedNoticeOpens','notificationsReadAll','logoutRemovesDialog','supplierMessage','supplierQuoteSubmitted','productRfqLoginReturn','productRfqSubmitted','supplierOfferVisible','buyerDirectReload','arDesktopRecapturedOnCleanCheckFixture']:
    assert f[key] is True,key
assert f['pending202']=={'heading':1,'completed':0,'accept':0,'composer':0}
assert f['foreignNoticeDenied']['dialog']==0 and f['foreignNoticeDenied']['error']
assert all(f['accountSwitch'].values()) and f['keyboardSkip']=='buyer-main'
assert '/products/' in f['backUrl'] and f['forwardUrl'].endswith('/buyer')
for name,v in b['views'].items():
    assert v['scroll']<=v['client'],name
    assert v.get('dialog',0)<=v.get('dialogClient',0),name
    assert v['lang']==('fr' if '-fr-' in name else 'ar')
    assert v['dir']==('ltr' if '-fr-' in name else 'rtl')
    assert (out/'screenshots'/f'{name}.jpg').stat().st_size>1000
api=read('api-verification.json');assert api['superseded']['status']==409 and api['guestThread']==401 and api['foreignNotificationTarget']==403
for key,r in api['cases'].items():assert r['retry']==200 and r['conflict']==409 and r['foreign']==403 and r['closedMessage']==409 and r['frozenAgreementUnchanged']
db=read('browser-after/trade-db-result.json');assert db['orders']==0 and not db['originalDatabaseUsed']
for key in ['accept','reject','recover']:
    r=db['cases'][key];assert r['decision']['phase']=='completed' and r['threadStatus']=='closed' and r['decisionMessages']==1 and r['decisionNotifications']==1
    assert r['status']==r['offerStatus']==('rejected' if key=='reject' else 'accepted')
assert db['cases']['recover']['decision']['attempts']>1
for name in ['browser-before','browser-after','browser-check']:
    d=read(name+'/preview-shutdown.json');assert d['stopped'] and d['temporaryDirectoryRemoved'] and not d['originalDatabaseUsed']
assert read('browser-check/fixture-smoke.json')['messageStatus']==201
server=(out/'after-server.log').read_text(encoding='utf-8-sig')
assert '/action HTTP/1.1" 202' in server
screens=sorted((out/'screenshots').glob('*.jpg'))
result={'date':'2026-10-21','baselineFiles':len(baseline['files']),'archiveBytes':baseline['archiveBytes'],'archiveAndEveryArchivedHashVerified':True,
 'changedBaselineFiles':changed,'unexpectedChanges':[],'missingFiles':missing,'headAndIndexUnchanged':True,
 'supplierHandlersEditorAndWorkspaceOutsideNegotiationUnchanged':True,'backendMediaCommercialAgreementAndPublicSourcesUnchanged':True,
 'tests':tests,'productionBuild':'passed','screenshots':len(screens),'afterViewsChecked':len(b['views']),'horizontalOverflow':0,
 'real202RecoveryAndIdempotencyVerified':True,'decisionEffectsExactlyOnceInThreeNewCases':True,'ordersCreated':0,
 'temporaryPreviewRootsRemoved':True,'originalDatabaseUsed':False}
(out/'final-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
base=str(out).replace('\\','/')
rows=['# D2-B — لقطات قبل وبعد','','بيانات اصطناعية في قواعد مستقلة. منفذ الحاسوب 1440×1000 والهاتف 390×844؛ قد يقتطع الالتقاط شريط التمرير (1424 أو 375 بكسلاً). أعيدت لقطات العربية الأساسية للحاسوب في قاعدة تحقق نظيفة بالبذور نفسها. لقطات المورد النهائية تبين الاتفاق المقبول بعد اختبار القرار؛ السابقة تبين العرض النشط.','','| اللغة والجهاز | المشتري قبل / بعد | التفاوض قبل / بعد | الإشعارات قبل / بعد | المورد قبل / بعد |','|---|---|---|---|---|']
for lang in ['ar','fr']:
    for device in ['desktop','phone']:
        end=f'{lang}-{device}';cells=[]
        for surface in ['buyer','negotiation','notifications','supplier-negotiation']:
            cells.append(' / '.join(f'[{label}]({base}/screenshots/{prefix}-{surface}-{end}.jpg)' for label,prefix in [('قبل','before'),('بعد','after')]))
        rows.append('| '+end+' | '+' | '.join(cells)+' |')
rows+=['','## بقية الأدلة البصرية','']
for p in screens:rows.append(f'- [{p.stem}]({base}/screenshots/{p.name}) — {Image.open(p).size[0]}×{Image.open(p).size[1]}')
(out/'screenshots-index.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
