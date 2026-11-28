import { localeFor } from '../../i18n/useLabels';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, setSession } from '../../api/session';
import { useLabels, statusLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { WorkspaceHeader, Field, Notice } from '../common/WorkspaceUI';
import VerificationRecovery from '../common/VerificationRecovery';
export default function AdminDashboard({
  user,
  onBack,
  onLogout,
  onLogin
}) {
  const l = useLabels(),
    {
      lang
    } = useTranslation();
  const [tab, setTab] = useState('suppliers'),
    [status, setStatus] = useState('pending'),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const [data, setData] = useState([]),
    [stats, setStats] = useState({}),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null),
    [reason, setReason] = useState(''),
    [moderation, setModeration] = useState('none');
  const [login, setLogin] = useState({
    email: '',
    password: ''
  });
  const loadGeneration = useRef(0), submitting = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    if (user?.role !== 'admin') return;
    const current = ++loadGeneration.current, token = getSessionToken();
    const valid = () => mounted.current && current === loadGeneration.current && token === getSessionToken();
    setData([]);
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        status,
        search: term,
        page: String(page),
        limit: '20'
      });
      const path = tab === 'reports' ? '/reports' : tab === 'audit' ? '/admin/audit-logs' : '/admin/' + tab;
      const [records, counts] = await Promise.all([apiRequest(path + '?' + params, {token,cache:'no-store'}), apiRequest('/admin/stats', {token,cache:'no-store'})]);
      if(!valid())return;
      setData(records.data || []);
      setPages(records.pagination?.pages || 1);
      setStats(counts);
    } catch (e) {
      if(valid())setError(e.message);
    } finally {
      if(valid())setBusy(false);
    }
  }, [user?.role, tab, status, term, page]);
  useEffect(() => {
    load();
  }, [load, revision]);
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest('/admin/login', {
        method: 'POST',
        body: login,
        token: ''
      });
      setLogin(previous => ({ ...previous, password: '' }));
      setSession(result.token);
      onLogin({
        ...result.admin,
        _id: result.admin.id || result.admin._id
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function perform(e) {
    e.preventDefault();
    if(submitting.current || busy || !target)return;
    submitting.current=true;const token=getSessionToken();const valid=()=>mounted.current&&token===getSessionToken();
    setBusy(true);
    setError('');
    try {
      let path, body;
      if (target.kind === 'supplier') {
        path = '/admin/suppliers/' + target.id + '/verify';
        body = {
          action: target.action,
          rejectionReason: reason,
          verificationRevision: target.verificationRevision
        };
      }
      if (target.kind === 'store') {
        path = '/admin/stores/' + target.id + '/review';
        body = {
          action: target.action,
          reason
        };
      }
      if (target.kind === 'storeStatus') {
        path = '/admin/stores/' + target.id + '/status';
        body = {
          isActive: target.action,
          reason
        };
      }
      if (target.kind === 'product') {
        path = '/admin/products/' + target.id + '/moderate';
        body = {
          action: target.action,
          reason
        };
      }
      if (target.kind === 'report') {
        path = '/reports/' + target.id + '/resolve';
        body = {
          action: target.action,
          resolutionNotes: reason,
          moderationAction: moderation
        };
      }
      const result = await apiRequest(path, { method: 'PUT', body, token });
      if(!valid())return;
      if (target.kind === 'supplier' && (result?.supplier?._id !== target.id ||
          result.supplier.verificationRevision !== target.verificationRevision ||
          result.supplier.verificationStatus !== (target.action === 'approve' ? 'verified' : 'rejected') ||
          result.supplier.isVerified !== (target.action === 'approve') || result.supplier.verificationSync!=='idle' || !result.auditId)) {
        throw new Error(l('لم يتأكد قرار التوثيق؛ حدّث القائمة قبل إعادة المحاولة.', 'Décision non confirmée ; actualisez la liste avant de réessayer.', 'Verification decision unconfirmed; refresh the list before retrying.'));
      }
      setTarget(null);
      setReason('');
      setModeration('none');
      setMessage(l('حفظ القرار وأثر التدقيق', 'Décision et trace d’audit enregistrées'));
      setRevision(r => r + 1);
    } catch (e) {
      if(valid()){
        if(target.kind==='supplier'){setTarget(null);setData([]);setStatus('all');setPage(1);setRevision(r=>r+1);setMessage(l('نتيجة القرار غير مؤكدة. راجع حالة المورد وسجل التدقيق؛ لا تعتبر تحديث القائمة تأكيداً للقرار.','Résultat de la décision non confirmé. Vérifiez le fournisseur et le journal ; l’actualisation de la liste ne confirme pas la décision.','Decision outcome unconfirmed. Review the supplier and audit log; refreshing the list does not confirm the decision.'));}
        setError(e.message);
      }
    } finally {
      submitting.current=false;if(valid())setBusy(false);
    }
  }
  function review(kind, id, action, verificationRevision) {
    if(busy || submitting.current)return;
    setTarget({
      kind,
      id,
      action,
      verificationRevision
    });
    setReason('');
    setModeration('none');
    setError('');
  }
  const header = <WorkspaceHeader title={l('لوحة المشرف', 'Administration')} onBack={onBack} onLogout={user ? onLogout : undefined} />;
  if (user?.role !== 'admin') return <>{header}<main className="container" style={{
      maxWidth: 520
    }}><form className="panel" onSubmit={signIn}><h1>{l('دخول الإدارة', 'Connexion administrateur')}</h1><p className="muted">{l('مخصص لحساب إداري أنشئ محلياً بواسطة مسؤول النظام.', 'Réservé à un compte administrateur créé localement par le responsable système.')}</p><Field label={l('البريد الإلكتروني', 'E-mail')} type="email" required value={login.email} onChange={e => setLogin({
          ...login,
          email: e.target.value
        })} /><Field label={l('كلمة المرور', 'Mot de passe')} type="password" required value={login.password} onChange={e => setLogin({
          ...login,
          password: e.target.value
        })} /><Notice error>{error}</Notice><button className="primary" disabled={busy}>{l('دخول', 'Connexion')}</button></form></main></>;
  const tabs = [['suppliers', l('الموردون', 'Fournisseurs')], ['stores', l('المتاجر', 'Boutiques')], ['products', l('المنتجات', 'Produits')], ['reports', l('البلاغات', 'Signalements')], ['audit', l('سجل التدقيق', 'Journal d’audit')]];
  return <>{header}<main className="container"><h1>{l('المراجعة والثقة', 'Modération et confiance')}</h1><div className="stat-grid">{[['totalProducts', l('المنتجات', 'Produits')], ['totalSuppliers', l('الموردون', 'Fournisseurs')], ['pendingVerifications', l('توثيق معلق', 'Vérifications en attente')], ['totalRfqs', l('طلبات الأسعار', 'Demandes de devis')]].map(([key, label]) => <div className="stat" key={key}>{label}<strong>{stats[key] || 0}</strong></div>)}</div>
    <nav className="tabs">{tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => {
          setTab(key);
          setStatus(['products', 'audit'].includes(key) ? 'all' : 'pending');
          setPage(1);
        }}>{label}</button>)}</nav><Notice error>{error}</Notice><Notice>{message}</Notice>
    <form className="panel actions" onSubmit={e => {
        e.preventDefault();
        setTerm(search);
        setPage(1);
      }}><Field label={l('بحث', 'Rechercher')} value={search} onChange={e => setSearch(e.target.value)} /><Field label={l('الحالة', 'Statut')}><select value={status} onChange={e => {
            setStatus(e.target.value);
            setPage(1);
          }}>{['all', ...(tab === 'reports' ? ['pending', 'resolved', 'dismissed'] : tab === 'stores' ? ['pending', 'approved', 'rejected'] : tab === 'products' ? ['visible', 'hidden'] : ['pending', 'verified', 'rejected', 'unverified'])].map(s => <option key={s} value={s}>{s === 'all' ? l('الكل', 'Tous') : statusLabel(s, lang)}</option>)}</select></Field><button>{l('تصفية', 'Filtrer')}</button><button type="button" disabled={busy} onClick={() => setRevision(x => x + 1)}>{l('تحديث', 'Actualiser')}</button></form>
    {busy && <p role="status">{l('جاري التحميل…', 'Chargement…')}</p>}
    {data.map(item => <article className="panel" key={item._id}>
      {tab === 'suppliers' && <><h2>{item.name}</h2><p>{item.email} · {item.city}</p><p>ICE: {item.iceNumber || '—'} · RC: {item.tradeRegistry || '—'}</p><p>{statusLabel(item.verificationStatus, lang)}</p>{item.verificationSync!=='idle'&&<Notice error>{item.verificationSync==='paused'?l('توقف الاستكمال التلقائي؛ يلزم فحص تشغيلي.','Reprise automatique suspendue ; contrôle opérationnel requis.','Automatic recovery paused; operational review required.'):l('استكمال سجل التوثيق غير مؤكد؛ لا تتخذ قراراً جديداً.','Finalisation du dossier non confirmée ; ne prenez pas de nouvelle décision.','Verification record completion unconfirmed; do not make another decision.')}</Notice>}{['pending','paused'].includes(item.verificationSync)&&<VerificationRecovery key={item.verificationSync} supplierId={String(item._id)} role="admin" revision={item.verificationRevision} status={item.verificationStatus} disabled={busy||Boolean(target)} onSettled={phase=>{setMessage(phase==='completed'?l('تم استكمال العملية المحفوظة دون قرار جديد.','Opération enregistrée reprise sans nouvelle décision.','Saved operation completed without a new decision.'):l('ألغيت العملية المحفوظة دون تنفيذها.','Opération enregistrée annulée sans application.','Saved operation cancelled without applying it.'));setData([]);setStatus('all');setPage(1);setRevision(r=>r+1);}}/>}{item.verificationDoc && <p className="muted">{l('عرض وثائق التحقق غير متاح ضمن هذه التجربة.', 'La consultation des justificatifs est hors périmètre de ce pilote.')}</p>}<div className="actions"><button disabled={busy || item.verificationStatus !== 'pending' || item.verificationSync!=='idle'} onClick={() => review('supplier', item._id, 'approve', item.verificationRevision ?? 0)}>{l('اعتماد التوثيق', 'Approuver')}</button><button disabled={busy || item.verificationStatus !== 'pending' || item.verificationSync!=='idle'} className="danger" onClick={() => review('supplier', item._id, 'reject', item.verificationRevision ?? 0)}>{l('رفض التوثيق', 'Refuser')}</button></div></>}
      {tab === 'stores' && <><h2>{item.name}</h2><p>{item.description}</p><p>{item.city} · {item.supplierId?.name} · {statusLabel(item.reviewStatus, lang)}</p><div className="actions"><button onClick={() => review('store', item._id, 'approve')}>{l('اعتماد المتجر', 'Approuver la boutique')}</button><button onClick={() => review('store', item._id, 'reject')}>{l('رفض', 'Refuser')}</button><button className="danger" onClick={() => review('storeStatus', item._id, !item.isActive)}>{item.isActive ? l('تعطيل', 'Désactiver') : l('تفعيل', 'Activer')}</button></div></>}
      {tab === 'products' && <><h2>{item.name}</h2><p>{item.supplierId?.name} · {item.category}</p><p>{item.description}</p><span className="badge">{item.isDraft ? l('مسودة', 'Brouillon') : l('منشور', 'Publié')}</span><div className="actions"><button className="danger" onClick={() => review('product', item._id, item.moderationStatus === 'hidden' ? 'restore' : 'hide')}>{item.moderationStatus === 'hidden' ? l('رفع الحجب', 'Restaurer') : l('حجب المنتج', 'Masquer le produit')}</button></div></>}
      {tab === 'reports' && <><h2>{item.targetName}</h2><p>{item.reason} · {statusLabel(item.status, lang)}</p><p>{item.details}</p><p>{item.resolutionNotes}</p>{item.status === 'pending' && <div className="actions"><button onClick={() => review('report', item._id, 'resolved')}>{l('معالجة البلاغ', 'Traiter le signalement')}</button><button onClick={() => review('report', item._id, 'dismissed')}>{l('حفظ دون إجراء', 'Classer sans suite')}</button></div>}</>}
      {tab === 'audit' && <><h3>{item.action}</h3><p>{statusLabel(item.phase, lang)} · {item.performedBy?.name} · {new Date(item.createdAt).toLocaleString(localeFor(lang))}</p><p className="muted">{item.targetType} · {item.targetId}</p><pre style={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere'
          }}>{JSON.stringify(item.details, null, 2)}</pre></>}
    </article>)}{!busy && !data.length && <p className="empty">{l('لا توجد سجلات مطابقة للفلاتر', 'Aucun résultat pour ces filtres')}</p>}
    <div className="pager"><button disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>{l('السابق', 'Précédent')}</button><span>{page}/{Math.max(1, pages)}</span><button disabled={page >= pages || busy} onClick={() => setPage(p => p + 1)}>{l('التالي', 'Suivant')}</button></div>
    {target && <div className="modal-backdrop"><form className="modal-content" role="dialog" aria-modal="true" onSubmit={perform}><h2>{l('تأكيد القرار الإداري', 'Confirmer la décision')}</h2><Field label={l('سبب القرار وملاحظاته', 'Motif et notes')}><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>{target.kind === 'report' && target.action === 'resolved' && <Field label={l('الإجراء على الهدف', 'Mesure de modération')}><select value={moderation} onChange={e => setModeration(e.target.value)}><option value="none">{l('توثيق المعالجة فقط', 'Consigner uniquement')}</option><option value="hide_product">{l('حجب المنتج', 'Masquer le produit')}</option><option value="suspend_supplier">{l('تعليق المورد', 'Suspendre le fournisseur')}</option></select></Field>}<Notice error>{error}</Notice><div className="actions"><button className="primary" disabled={busy}>{l('تأكيد وتسجيل', 'Confirmer et enregistrer')}</button><button type="button" onClick={() => setTarget(null)}>{l('إلغاء', 'Annuler')}</button></div></form></div>}
  </main></>;
}
