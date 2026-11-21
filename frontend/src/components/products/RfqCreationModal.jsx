import { localizeCopy } from '../../i18n/useLabels';
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../api/config'
import { getSessionToken, useSessionToken } from '../../api/session'
import { useTranslation } from '../../i18n/LanguageContext'
import AtlasDialog from '../common/AtlasDialog'

const copy = {
  ar: { title: 'طلب عرض سعر بالجملة', login: 'سجل الدخول كمشترٍ لإرسال الطلب ومتابعة العروض.', loginButton: 'دخول المشتري', phone: 'هاتف التواصل', city: 'مدينة التوصيل', quantity: 'الكمية المطلوبة', target: 'سعر مستهدف اختياري', notes: 'المواصفات والملاحظات', submit: 'إرسال طلب عرض السعر', busy: 'جاري الإرسال…', success: 'تم إرسال طلبك. يمكنك متابعة العرض والمراسلات من «طلباتي».', reference: 'رقم الطلب', minimum: 'الحد الأدنى', error: 'تعذر تأكيد نتيجة الطلب.',
    unknown: 'نتيجة الإرسال غير مؤكدة؛ قد يكون الطلب محفوظاً. استكمل المحاولة بالبيانات الأصلية نفسها دون إرسال طلب جديد. ابقَ هنا حتى تتأكد النتيجة؛ لا تُخزن بيانات المحاولة على الجهاز.',
    pending: 'حُفظ الطلب وجارٍ استكمال المحادثة والإشعار. لم يكتمل الإرسال بعد. استكمل هنا أو راجع الطلب قيد الإنشاء في «طلباتي».', recover: 'استكمال إرسال الطلب', recovering: 'جارٍ الاستكمال…', secure: 'تعذر توليد معرف آمن للمحاولة. استخدم متصفحاً حديثاً واتصالاً آمناً.' },
  fr: { title: 'Demander un devis de gros', login: 'Connectez-vous comme acheteur pour envoyer et suivre votre demande.', loginButton: 'Connexion acheteur', phone: 'Téléphone de contact', city: 'Ville de livraison', quantity: 'Quantité demandée', target: 'Prix cible facultatif', notes: 'Spécifications et remarques', submit: 'Envoyer la demande', busy: 'Envoi…', success: 'Demande envoyée. Retrouvez les offres et la conversation dans « Mes demandes ».', reference: 'Référence', minimum: 'Minimum de commande', error: 'Résultat de la demande non confirmé.',
    unknown: 'Résultat incertain ; la demande est peut-être enregistrée. Reprenez la tentative avec les informations d’origine sans créer une nouvelle demande. Restez ici jusqu’à confirmation ; les informations de la tentative ne sont pas stockées sur l’appareil.',
    pending: 'Demande enregistrée, conversation et notification en cours de finalisation. L’envoi n’est pas terminé. Reprenez ici ou retrouvez la demande en cours de création dans « Mes demandes ».', recover: 'Reprendre l’envoi de la demande', recovering: 'Reprise…', secure: 'Impossible de générer un identifiant sûr. Utilisez un navigateur récent et une connexion sécurisée.' }
}
const inputStyle = { display: 'block', width: '100%', padding: 10, border: '1px solid #CBD5E1', borderRadius: 8, font: 'inherit', boxSizing: 'border-box', marginTop: 5 }
function creationKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  if (!window.crypto?.getRandomValues) throw new Error('Secure random unavailable')
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
}

export default function RFQModal(props) {
  const token = useSessionToken()
  return <RfqSession key={token + ':' + props.product._id + ':' + (props.opportunity?._id || '')} {...props} token={token} />
}
function RfqSession({ product, opportunity, onClose, onSuccess, onRequireLogin, user, token }) {
  const { lang } = useTranslation(), c = localizeCopy(copy, lang)
  const [form, setForm] = useState(() => {
    // A session event can arrive before App has loaded the replacement profile.
    // Never seed the new account's form with a stale previous profile.
    let current = false
    try { const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); current = String(JSON.parse(atob(encoded)).id) === String(user?._id || user?.id || '') } catch { /* no verified profile to prefill */ }
    return { quantity: product.moq || 1, buyerPhone: current ? user?.phone || '' : '', buyerCity: current ? user?.city || '' : '', targetPrice: '', notes: '' }
  })
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [submitted, setSubmitted] = useState(null)
  const [uncertain, setUncertain] = useState(false), [pendingId, setPendingId] = useState(null)
  const attempt = useRef(null), busy = useRef(false), mounted = useRef(true), controller = useRef(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const valid = signal => mounted.current && !signal.aborted && token === getSessionToken()
  const closeBlocked = loading || (uncertain && !pendingId)
  async function submit(event, recover = false) {
    event?.preventDefault()
    if (busy.current || !token || submitted || (attempt.current && !recover)) return
    if (!recover) {
      try { attempt.current = { key: creationKey(), body: JSON.parse(JSON.stringify({ ...form, productId: product._id, ...(opportunity ? { opportunityId:opportunity._id } : {}), quantity: Number(form.quantity), targetPrice: form.targetPrice === '' ? null : Number(form.targetPrice) })) } }
      catch { setError(c.secure); return }
    }
    if (!attempt.current) return
    busy.current = true; setLoading(true); setError('')
    const active = new AbortController(); controller.current = active
    try {
      const data = await apiRequest('/rfq', { method: 'POST', token, signal: active.signal,
        headers: { 'Idempotency-Key': attempt.current.key }, body: attempt.current.body })
      if (!valid(active.signal)) return
      if (data.processing || data.rfq?.status === 'creating') {
        setPendingId(data.rfq?._id || null); setUncertain(true)
      } else if (data.rfq?._id) {
        attempt.current = null; setUncertain(false); setSubmitted(data.rfq); onSuccess?.(data.rfq)
      } else { setUncertain(true); setError(c.error) }
    } catch (failure) {
      if (!valid(active.signal)) return
      setError(failure.message || c.error)
      const definitive = failure.status >= 400 && failure.status < 500 && ![408, 409].includes(failure.status)
      if (!definitive || pendingId) setUncertain(true)
      else { attempt.current = null; setUncertain(false) }
    } finally {
      busy.current = false
      if (valid(active.signal)) setLoading(false)
    }
  }
  return <AtlasDialog title={c.title} busy={closeBlocked} onClose={() => { if (!closeBlocked) onClose() }}>
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <p><strong>{product.name}</strong></p><p>{c.minimum}: {product.moq || 1} {product.unit} · {product.currency || 'MAD'}</p>
      {!token ? <><p>{c.login}</p><button className="primary" onClick={() => onRequireLogin?.()}>{c.loginButton}</button></>
        : submitted ? <div role="status"><p>{c.success}</p><p>{c.reference}: <code>{submitted._id}</code></p></div>
        : <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
          <fieldset disabled={loading || uncertain} style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 14, minWidth: 0 }}>
            <label>{c.phone}<input required type="tel" autoComplete="tel" maxLength={20} pattern="[+0-9 ()-]{8,20}" value={form.buyerPhone} onChange={e => setForm(f => ({ ...f, buyerPhone: e.target.value }))} style={inputStyle} /></label>
            <label>{c.city}<input maxLength={200} value={form.buyerCity} onChange={e => setForm(f => ({ ...f, buyerCity: e.target.value }))} style={inputStyle} /></label>
            <label>{c.quantity}<input required type="number" step="1" min={product.moq || 1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={inputStyle} /></label>
            <label>{c.target} ({product.currency || 'MAD'})<input type="number" min="0" step="0.01" value={form.targetPrice} onChange={e => setForm(f => ({ ...f, targetPrice: e.target.value }))} style={inputStyle} /></label>
            <label>{c.notes}<textarea maxLength={5000} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inputStyle} /></label>
          </fieldset>
          {uncertain && <div role="status" className="trade-uncertain"><p>{pendingId ? c.pending : c.unknown}</p>{pendingId && <p>{c.reference}: <code style={{ overflowWrap: 'anywhere' }}>{pendingId}</code></p>}</div>}
          {error && <p role="alert" className="atlas-alert">{error}</p>}
          {uncertain ? <button type="button" className="primary" disabled={loading} onClick={() => submit(null, true)}>{loading ? c.recovering : c.recover}</button>
            : <button type="submit" className="primary" disabled={loading}>{loading ? c.busy : c.submit}</button>}
        </form>}
    </div>
  </AtlasDialog>
}
