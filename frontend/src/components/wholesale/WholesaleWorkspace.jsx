import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Link, opportunityPath } from '../../navigation';
import { OpportunityTerms } from './OpportunityTerms';
import '../../styles/atlas-wholesale.css';

const fresh = () => ({ productId: '', title: '', description: '', terms: '', price: '', unit: '', currency: 'MAD', moq: 1,
  expiresAt: localDate(new Date(Date.now()+7*86400000)), priceTiers: [] });
function localDate(value) { const d = new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
const key = () => {
  if (!window.crypto?.getRandomValues) throw Error('Secure random unavailable');
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
};
function confirmedOpportunity(result, attempt, mode = 'write') {
  const row = result?.opportunity;
  if (!row || !/^[a-f0-9]{24}$/i.test(row._id || '') ||
      row.productId !== attempt.productId || (attempt.id && row._id !== attempt.id) ||
      !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      !['draft','published','paused','expired'].includes(row.status) ||
      !Array.isArray(row.priceTiers) || typeof row.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(row.expiresAt))) return null;
  if (mode === 'inspect') return row.revision >= attempt.body.revision ? row : null;
  // An idempotent POST replay returns the current saved row, which may have
  // been changed by another session since the original draft was created.
  if (!attempt.id) {
    if (row.revision === 0 && row.status === 'draft') return row;
    return mode === 'replay' && row.revision > 0 ? row : null;
  }
  const requested = attempt.body.status;
  const statusMatches = row.status === requested || (requested === 'published' && row.status === 'expired');
  return statusMatches && row.revision === attempt.body.revision + 1 ? row : null;
}
export default function WholesaleWorkspace() {
  const token = useSessionToken();
  return <OwnedWorkspace key={token} token={token} />;
}
function OwnedWorkspace({ token }) {
  const l = useLabels();
  const [rows, setRows] = useState([]), [products, setProducts] = useState([]), [productPage, setProductPage] = useState(1), [productPages, setProductPages] = useState(1);
  const [page, setPage] = useState(1), [total, setTotal] = useState(0), [form, setForm] = useState(fresh), [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState(''), [uncertain, setUncertain] = useState(false);
  const mounted = useRef(true), controllers = useRef(new Set()), writing = useRef(false), attempt = useRef(null), formElement = useRef(null), generation = useRef(0);
  const valid = useCallback(() => mounted.current && token === getSessionToken(), [token]);
  useEffect(() => { mounted.current = true; const list = controllers.current; return () => { mounted.current = false; list.forEach(c => c.abort()); }; }, []);
  const call = useCallback(async (url, options = {}) => {
    const controller = new AbortController(); controllers.current.add(controller);
    try { const result = await apiRequest('/wholesale-opportunities'+url, { ...options, token, signal: controller.signal, cache:'no-store' }); return valid() ? result : undefined; }
    finally { controllers.current.delete(controller); }
  }, [token, valid]);
  const load = useCallback(async () => {
    const version = ++generation.current; setLoading(true);
    try {
      const [mine, eligible] = await Promise.all([call('/mine?page='+page+'&limit=12'), call('/eligible-products?page='+productPage)]);
      if (!valid() || version !== generation.current || !mine || !eligible) return;
      setRows(mine.data); setTotal(mine.total); setProducts(eligible.data); setProductPages(eligible.pages || 1);
    } catch (failure) { if (valid() && version === generation.current) setError(failure.message); }
    finally { if (valid() && version === generation.current) setLoading(false); }
  }, [call, valid, page, productPage]);
  useEffect(() => { load(); }, [load]);
  function open(row) { if (writing.current || uncertain) return; attempt.current = null; setEditing(row); setMessage(''); setError(''); setForm({ ...row, productId: row.productId, expiresAt: localDate(row.expiresAt), priceTiers: row.priceTiers.map(t => ({...t})) }); }
  function reset() { if (writing.current || uncertain) return; setEditing(null); setForm(fresh()); attempt.current = null; setError(''); setMessage(''); }
  async function save(status, resume = false) {
    if (writing.current || (!resume && uncertain) || (!resume && status !== 'paused' && !formElement.current.reportValidity())) return;
    if (!resume) {
      try {
        const body = status === 'paused' && editing ? { revision:editing.revision, status:'paused' }
          : { ...Object.fromEntries(['productId','title','description','terms','unit','currency'].map(f => [f,form[f]])), price:Number(form.price), moq:Number(form.moq), expiresAt:new Date(form.expiresAt).toISOString(), priceTiers:form.priceTiers.map(t => ({ minQty:Number(t.minQty), ...(t.maxQty === '' || t.maxQty == null ? {} : { maxQty:Number(t.maxQty) }), price:Number(t.price) })), ...(editing ? { revision:editing.revision,status } : {}) };
        attempt.current = { body, key:editing ? null : key(), id:editing?._id, productId:editing?.productId || body.productId };
      } catch { setError(l('تحقق من التاريخ واستخدم متصفحاً يدعم التوليد الآمن.', 'Vérifiez la date et utilisez un navigateur avec génération sécurisée.')); return; }
    }
    if (!attempt.current) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const a = attempt.current, result = await call(a.id ? '/'+a.id : '', { method:a.id ? 'PUT':'POST', headers:a.key ? {'Idempotency-Key':a.key} : {}, body:a.body });
      if (!valid()) return;
      const row = confirmedOpportunity(result, a, resume ? 'replay' : 'write');
      if (!row) throw new Error(l('لم يتأكد حفظ الفرصة. راجع الحالة المحفوظة قبل إنشاء محاولة جديدة.', 'Sauvegarde non confirmée. Vérifiez la version enregistrée avant toute nouvelle tentative.', 'Opportunity save unconfirmed. Check the saved version before a new attempt.'));
      setUncertain(false); attempt.current = null; setEditing(row); setForm({ ...row, expiresAt:localDate(row.expiresAt) });
      setMessage(!a.id && row.revision > 0
        ? l('هذه النسخة المحفوظة؛ راجعها قبل أي تعديل جديد.', 'Voici la version enregistrée ; vérifiez-la avant toute modification.')
        : l('حُفظت الفرصة: ', 'Opportunité enregistrée : ')+(row.status === 'published' ? l('منشورة', 'publiée') : l('غير منشورة للعامة', 'non publiée'))); await load();
    } catch (failure) {
      if (!valid()) return;
      setError(failure.message);
      if (!failure.status || failure.status >= 500 || failure.status === 408) setUncertain(true);
      else { attempt.current = null; setUncertain(false); }
    } finally { writing.current = false; if (valid()) setBusy(false); }
  }
  async function inspectSaved() {
    if (writing.current || !attempt.current?.id) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try { const a = attempt.current, result = await call('/mine/'+a.id); if (valid()) {
      const row = confirmedOpportunity(result, a, 'inspect');
      if (!row) throw new Error(l('تعذر تأكيد هوية الفرصة المحفوظة.', 'Impossible de confirmer l’identité de l’opportunité enregistrée.', 'Could not confirm the saved opportunity identity.'));
      setUncertain(false); attempt.current=null; setEditing(row); setForm({ ...row, expiresAt:localDate(row.expiresAt) });
      setMessage(l('هذه النسخة المحفوظة؛ راجعها قبل أي تعديل جديد.', 'Voici la version enregistrée ; vérifiez-la avant toute modification.')); await load();
    } } catch (failure) { if (valid()) setError(failure.message); }
    finally { writing.current=false; if(valid())setBusy(false); }
  }
  function productSelected(value) { const p = products.find(row => row._id === value); if (p) setForm(f => ({ ...f, productId:value,title:p.name,unit:p.unit,currency:p.currency,moq:p.moq })); }
  const input = name => ({ value:form[name], onChange:e => setForm(f => ({ ...f,[name]:e.target.value })) });
  return <section className="wholesale-workspace"><p className="supplier-help">{l('الفرصة مرتبطة بمنتج منشور ومتجر معتمد. التوثيق التجاري اختياري، وطلب السعر ليس اتفاقاً نهائياً.', 'L’opportunité dépend d’un produit publié et d’une boutique approuvée. La vérification commerciale est facultative ; la demande de devis ne constitue pas un accord.')}</p>
    <div className="actions"><button onClick={reset} disabled={busy || uncertain}>{l('فرصة جديدة', 'Nouvelle opportunité')}</button><button onClick={load} disabled={busy}>{l('تحديث الفرص', 'Actualiser les opportunités')}</button><Link to="/opportunities">{l('عرض القسم العام', 'Voir la rubrique publique')}</Link></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {uncertain && <section role="status" className="panel"><p>{l('الحفظ غير محسوم؛ قد تكون الفرصة محفوظة. لا تنشئ محاولة جديدة. المدخلات الأصلية ثابتة، ولا تُخزن على الجهاز؛ عند تحديث الصفحة راجع قائمة فرصك أولاً.', 'Résultat incertain ; l’opportunité est peut-être enregistrée. Ne créez pas une nouvelle tentative. Les données sont figées et ne sont pas stockées sur l’appareil ; après rechargement, vérifiez d’abord votre liste.')}</p><button disabled={busy} onClick={() => attempt.current?.id ? inspectSaved() : save('draft',true)}>{attempt.current?.id ? l('التحقق من الحالة المحفوظة', 'Vérifier la version enregistrée') : l('استكمال حفظ المحاولة نفسها', 'Reprendre la même sauvegarde')}</button></section>}
    <form className="panel wholesale-editor" ref={formElement} onSubmit={e => { e.preventDefault(); save('draft'); }}><h2>{editing ? l('تعديل الفرصة', 'Modifier l’opportunité') : l('إنشاء فرصة جملة', 'Créer une opportunité de gros')}</h2>
      <fieldset disabled={busy || uncertain}><div className="wholesale-fields">
        {!editing && <><label>{l('المنتج المنشور', 'Produit publié')}<select required value={form.productId} onChange={e => productSelected(e.target.value)}><option value="">{l('اختر منتجاً', 'Choisissez un produit')}</option>{products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></label><div className="actions"><button type="button" disabled={productPage<=1} onClick={() => setProductPage(p=>p-1)}>{l('منتجات سابقة', 'Produits précédents')}</button><span>{productPage}/{productPages}</span><button type="button" disabled={productPage>=productPages} onClick={() => setProductPage(p=>p+1)}>{l('منتجات تالية', 'Produits suivants')}</button></div></>}
        <label>{l('عنوان الفرصة', 'Titre de l’opportunité')}<input required maxLength={160} {...input('title')} /></label>
        <label>{l('السعر لكل وحدة', 'Prix par unité')}<input required type="number" min="0.01" max="1000000000" step="0.01" {...input('price')} /></label>
        <label>MOQ<input required type="number" min="1" max="1000000000" step="1" {...input('moq')} /></label>
        <label>{l('وحدة البيع', 'Unité de vente')}<input required readOnly value={form.unit} /></label>
        <label>{l('العملة', 'Devise')}<input required readOnly value={form.currency} /></label>
        <label>{l('تاريخ الانتهاء', 'Date d’expiration')}<input required type="datetime-local" {...input('expiresAt')} /></label>
        <label>{l('وصف الفرصة', 'Description de l’opportunité')}<textarea rows={3} maxLength={2000} {...input('description')} /></label>
        <label>{l('شروط الفرصة', 'Conditions de l’opportunité')}<textarea rows={3} maxLength={2000} {...input('terms')} /></label>
      </div>
      <h3>{l('أسعار متدرجة اختيارية', 'Tarifs par quantité facultatifs')}</h3>
      {form.priceTiers.map((tier,i) => <div className="wholesale-tier" key={i}>{['minQty','maxQty','price'].map(f => <label key={f}>{f==='minQty'?l('من كمية', 'À partir de'):f==='maxQty'?l('إلى كمية (اختياري)', 'Jusqu’à (facultatif)'):l('سعر الشريحة', 'Prix du palier')}<input type="number" required={f!=='maxQty'} min={f==='price'?'0.01':'1'} step={f==='price'?'0.01':'1'} value={tier[f] ?? ''} onChange={e => setForm(old => ({ ...old, priceTiers:old.priceTiers.map((t,n) => n===i ? {...t,[f]:e.target.value} : t) }))} /></label>)}<button type="button" onClick={() => setForm(f => ({...f,priceTiers:f.priceTiers.filter((_,n)=>n!==i)}))}>{l('حذف الشريحة', 'Retirer le palier')}</button></div>)}
      <button type="button" disabled={form.priceTiers.length>=20} onClick={() => setForm(f => ({...f,priceTiers:[...f.priceTiers,{minQty:f.moq,maxQty:'',price:''}]}))}>{l('إضافة شريحة سعر', 'Ajouter un palier')}</button>
      <p>{l('لا تعرض المنصة خصماً دون سعر مرجعي موثوق. النشر يتم فقط بزر النشر.', 'Aucune remise sans prix de référence fiable. La publication nécessite le bouton Publier.')}</p>
      <div className="actions"><button type="submit">{l('حفظ مسودة', 'Enregistrer le brouillon')}</button>{editing && <><button type="button" className="primary" onClick={() => save('published')}>{l('نشر الفرصة', 'Publier l’opportunité')}</button><button type="button" onClick={() => save('paused')}>{l('إيقاف الفرصة', 'Suspendre l’opportunité')}</button></>}</div></fieldset>
    </form>
    {loading && <p role="status">{l('جارٍ تحميل فرصك…', 'Chargement de vos opportunités…')}</p>}
    <div className="product-grid">{rows.map(row => <article className="panel" key={row._id}><h3>{row.title}</h3><span className="badge">{({draft:l('مسودة خاصة','Brouillon privé'),published:l('منشورة','Publiée'),paused:l('متوقفة','Suspendue'),expired:l('منتهية','Expirée')})[row.status]}</span><OpportunityTerms opportunity={row}/><button disabled={busy || uncertain} onClick={() => open(row)}>{l('تعديل وإدارة', 'Modifier et gérer')}</button>{row.status==='published' && <Link to={opportunityPath(row._id)}>{l('فتح الرابط العام', 'Ouvrir le lien public')}</Link>}</article>)}</div>
    {!loading && !rows.length && <p>{l('لا توجد فرص بعد. احفظ مسودتك الأولى.', 'Aucune opportunité. Enregistrez votre premier brouillon.')}</p>}
    <div className="pager"><button disabled={page<=1 || busy || uncertain} onClick={() => setPage(p=>p-1)}>{l('السابق', 'Précédent')}</button><span>{page}/{Math.max(1,Math.ceil(total/12))}</span><button disabled={page*12>=total || busy || uncertain} onClick={() => setPage(p=>p+1)}>{l('التالي', 'Suivant')}</button></div>
  </section>;
}
