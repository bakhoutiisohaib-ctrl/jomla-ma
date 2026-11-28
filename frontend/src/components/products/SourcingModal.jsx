import BuyerContactGate from '../auth/BuyerContactGate';
import { localizeCopy } from '../../i18n/useLabels';
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../api/config'
import { getSessionToken, useSessionToken } from '../../api/session'
import { beginAttempt, forgetAttempt, getAttempt } from './sourcingCreationAttempt'
import { useTranslation } from '../../i18n/LanguageContext'
const copy = {
  ar: { title: 'طلب توريد خاص', login: 'سجل الدخول كمشترٍ لإنشاء الطلب ومقارنة عروض الموردين.', loginButton: 'دخول المشتري', name: 'المنتج المطلوب', category: 'الفئة', quantity: 'الكمية', unit: 'وحدة البيع', phone: 'هاتف التواصل', city: 'مدينة التوصيل', target: 'السعر المستهدف للوحدة (MAD) — اختياري', notes: 'المواصفات والملاحظات', submit: 'إرسال طلب التوريد', busy: 'جاري الإرسال…', close: 'إغلاق', success: 'تم حفظ طلب التوريد. ستظهر عروض الموردين في «طلباتي» مع إشعارات داخل حسابك.', reference: 'رقم الطلب', piece: 'قطعة' },
  fr: { title: 'Demande d’approvisionnement', login: 'Connectez-vous comme acheteur pour créer une demande et comparer les offres.', loginButton: 'Connexion acheteur', name: 'Produit recherché', category: 'Catégorie', quantity: 'Quantité', unit: 'Unité de vente', phone: 'Téléphone de contact', city: 'Ville de livraison', target: 'Prix cible par unité (MAD) — facultatif', notes: 'Spécifications et remarques', submit: 'Envoyer la demande', busy: 'Envoi…', close: 'Fermer', success: 'Demande enregistrée. Retrouvez les offres et les notifications dans « Mes demandes ».', reference: 'Référence', piece: 'pièce' }
}
const input = { display: 'block', width: '100%', boxSizing: 'border-box', border: '1px solid #CBD5E1', borderRadius: 8, padding: 10, marginTop: 5, font: 'inherit' }
const button = { border: 0, borderRadius: 8, padding: '11px 16px', cursor: 'pointer', font: 'inherit' }
const recovery = {
  ar: { uncertain: 'نتيجة الإنشاء غير محسومة. احتُفظ ببيانات المحاولة؛ استكملها دون إنشاء طلب آخر. تجنب تحديث الصفحة أو إغلاق التبويب قبل حسمها.', retry: 'استكمال المحاولة نفسها', lookup: 'التحقق من نتيجة المحاولة', missing: 'لم تظهر نتيجة مؤكدة بعد. هذا لا يعني أن الطلب لم يُحفظ. استكمل بالمفتاح والبيانات نفسيهما.', conflict: 'المفتاح مرتبط ببيانات مختلفة. تحقق من النتيجة الأصلية؛ لم يُنشأ طلب جديد.', index: 'الإنشاء متوقف لحين تهيئة فهرس منع التكرار. احتُفظ بالمحاولة لاستكمالها لاحقاً.' },
  fr: { uncertain: 'Résultat non confirmé. Les données de cette tentative sont conservées ; reprenez-la sans créer une autre demande. Évitez de recharger la page ou de fermer cet onglet avant confirmation.', retry: 'Reprendre la même tentative', lookup: 'Vérifier le résultat', missing: 'Aucun résultat confirmé pour le moment. La demande peut avoir été enregistrée. Reprenez avec la même clé et les mêmes données.', conflict: 'Cette clé correspond à des données différentes. Vérifiez le résultat initial ; aucune nouvelle demande créée.', index: 'Création suspendue : l’index anti-doublon doit être préparé. Cette tentative reste disponible pour une reprise.' }
}
export default function SourcingModal(props) {
  const token = useSessionToken()
  const buyerId = String(props.user?._id || props.user?.id || '')
  const allowed = Boolean(token && token === props.sessionToken && buyerId && props.user?.role === 'buyer')
  return <BuyerContactGate key={token + ':' + buyerId} user={allowed ? props.user : null} token={token} onClose={props.onClose}>{account => <SourcingForm {...props} user={account || props.user} key={token + ':' + buyerId + ':' + allowed} token={token} buyerId={buyerId} allowed={allowed} />}</BuyerContactGate>
}
function SourcingForm({ initialData = {}, onClose, onSuccess, onRequireLogin, user, token, buyerId, allowed }) {
  const { lang } = useTranslation()
  const c = localizeCopy(copy, lang)
  const r = recovery[lang] || recovery.ar
  const [attempt, setAttempt] = useState(() => allowed ? getAttempt(buyerId) : null)
  const [form, setForm] = useState(() => attempt?.body || ({ buyerPhone: allowed ? user?.phone || '' : '', buyerCity: allowed ? user?.city || '' : '', productName: initialData.productName || initialData.query || '', category: initialData.category || '', quantity: initialData.quantity || 1, unit: initialData.unit || c.piece, targetPrice: initialData.targetPrice ?? '', imageUrl: initialData.imageUrl || '', notes: '' }))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const active = useRef(true), busy = useRef(false), controller = useRef(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false; controller.current?.abort()
      if (getSessionToken() !== token) forgetAttempt(buyerId)
    }
  }, [token, buyerId])
  const current = () => active.current && getSessionToken() === token && allowed
  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }))
  async function send(lookup = false) {
    if (!current() || busy.current) return
    busy.current = true; setLoading(true); setError('')
    controller.current = new AbortController()
    try {
      const original = attempt || beginAttempt(buyerId, { ...form, quantity: Number(form.quantity), targetPrice: form.targetPrice == null || form.targetPrice === '' ? null : Number(form.targetPrice) })
      setAttempt(original)
      const data = await apiRequest(lookup ? '/sourcing/creation-result' : '/sourcing', { token,
        signal: controller.current.signal, cache: 'no-store', headers: { 'Idempotency-Key': original.key },
        ...(lookup ? {} : { method: 'POST', body: original.body }) })
      if (!current()) return
      if (!data.sourcing?._id) throw new Error(r.uncertain)
      forgetAttempt(buyerId); setAttempt(null); setSuccess(data.sourcing); onSuccess?.(data.sourcing)
    } catch (err) {
      if (!current() || err.name === 'AbortError') return
      if (!lookup && err.status === 400) {
        // A confirmed input rejection occurs before insertion.
        forgetAttempt(buyerId); setAttempt(null); setError(err.message)
      } else setError(lookup && err.status === 404 ? r.missing : err.status === 409 ? r.conflict : err.data?.code === 'SOURCING_CREATION_INDEX_REQUIRED' ? r.index : r.uncertain)
      if (err.status === 401) onRequireLogin?.()
    } finally { busy.current = false; if (current()) setLoading(false) }
  }
  function submit(event) { event.preventDefault(); send() }
  return <div onClick={() => { if (!loading) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.65)', zIndex: 1200, display: 'grid', placeItems: 'center', padding: 16 }}>
    <section role="dialog" aria-modal="true" aria-labelledby="sourcing-title" dir={lang === 'ar' ? 'rtl' : 'ltr'} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, boxSizing: 'border-box', maxHeight: '90dvh', overflowY: 'auto', padding: 24, borderRadius: 16, background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><h2 id="sourcing-title" style={{ fontSize: 19 }}>{c.title}</h2><button aria-label={c.close} onClick={onClose} style={button}>×</button></div>
      {!allowed ? <><p>{c.login}</p><button onClick={() => onRequireLogin?.()} style={{ ...button, background: '#C1272D', color: 'white' }}>{c.loginButton}</button></>
        : success ? <div role="status"><p>{c.success}</p><p>{c.reference}: <code style={{ overflowWrap: 'anywhere' }}>{success._id}</code></p></div>
        : <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          {attempt && <p role="status" style={{ margin: 0 }}>{r.uncertain}</p>}
          <fieldset disabled={loading || Boolean(attempt)} style={{ display: 'grid', gap: 14, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label>{c.name}<input required maxLength={300} value={form.productName} onChange={e => set('productName', e.target.value)} style={input} /></label>
          <label>{c.category}<input maxLength={200} value={form.category} onChange={e => set('category', e.target.value)} style={input} /></label>
          <label>{c.phone}<input required type="tel" maxLength={20} pattern="[+0-9 ()-]{8,20}" autoComplete="tel" value={form.buyerPhone} onChange={e => set('buyerPhone', e.target.value)} style={input} /></label>
          <label>{c.city}<input maxLength={200} value={form.buyerCity} onChange={e => set('buyerCity', e.target.value)} style={input} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            <label>{c.quantity}<input required type="number" min="1" step="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} style={input} /></label>
            <label>{c.unit}<input required maxLength={50} value={form.unit} onChange={e => set('unit', e.target.value)} style={input} /></label>
          </div>
          <label>{c.target}<input type="number" min="0" step="0.01" value={form.targetPrice ?? ''} onChange={e => set('targetPrice', e.target.value)} style={input} /></label>
          <label>{c.notes}<textarea rows={3} maxLength={5000} value={form.notes} onChange={e => set('notes', e.target.value)} style={input} /></label>
          </fieldset>
          {error && <p role="alert" style={{ color: '#B91C1C', margin: 0 }}>{error}</p>}
          <button disabled={loading} style={{ ...button, background: '#C1272D', color: 'white' }}>{loading ? c.busy : attempt ? r.retry : c.submit}</button>
          {attempt && <button type="button" disabled={loading} onClick={() => send(true)} style={button}>{r.lookup}</button>}
        </form>}
      <button onClick={onClose} style={{ ...button, width: '100%', marginTop: 14 }}>{c.close}</button>
    </section>
  </div>
}
