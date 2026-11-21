import { labelFor, localizeCopy } from '../../i18n/useLabels';
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../api/config'
import { getSessionToken, useSessionToken } from '../../api/session'
import { useTranslation } from '../../i18n/LanguageContext'
import { Field } from '../common/WorkspaceUI'
const copy = {
  ar: { title: 'تقديم عرض سعر', price: 'سعر الوحدة', days: 'أيام التسليم', terms: 'شروط الدفع', notes: 'ملاحظات العرض', send: 'إرسال العرض', retry: 'استكمال العرض نفسه', loading: 'جاري التحقق…',
    pending: 'محاولة العرض محفوظة وقيد الاستكمال. لم يُنشر العرض الجديد ولم يُستبدل السابق بعد.', uncertain: 'نتيجة إرسال العرض غير محسومة. استكمل المفتاح والبيانات نفسيهما؛ لا تُرسل عرضاً آخر.',
    busy: 'توجد عملية أخرى قيد الاستكمال. احتُفظ بمحاولتك؛ أعد المحاولة نفسها لاحقاً.', conflict: 'المفتاح مرتبط ببيانات مختلفة. احتُفظ بالمحاولة دون إنشاء عرض جديد.',
    capacity: 'سجل العروض ممتلئ ويحتاج مراجعة تشغيلية؛ لم يُحجز عرض جديد.', boundary: 'المدخلات المحلية في ذاكرة هذه النافذة فقط. عند تحديث الصفحة يمكن استكمال عملية محفوظة من الخادم؛ إن لم تُحفظ، راجع سجل عروضك قبل محاولة جديدة.', foreign: 'يجري استكمال عرض آخر لهذا الطلب. لا يمكن تقديم عرض جديد الآن.', closed: 'هذا الطلب مغلق أمام عروض جديدة.' },
  fr: { title: 'Proposer un devis', price: 'Prix unitaire', days: 'Délai (jours)', terms: 'Conditions de paiement', notes: 'Notes de l’offre', send: 'Envoyer l’offre', retry: 'Reprendre la même offre', loading: 'Vérification…',
    pending: 'Tentative enregistrée, finalisation en cours. La nouvelle offre n’est pas publiée et la précédente reste inchangée.', uncertain: 'Résultat non confirmé. Reprenez la même clé et les mêmes données ; ne créez pas une autre offre.',
    busy: 'Une autre opération est en cours. Votre tentative est conservée ; reprenez-la plus tard.', conflict: 'Cette clé correspond à des données différentes. Aucun nouvel envoi créé.',
    capacity: 'Historique des offres trop volumineux : vérification opérationnelle nécessaire. Aucune nouvelle réservation.', boundary: 'Données locales conservées uniquement dans cette fenêtre. Après rechargement, une opération enregistrée reste récupérable depuis le serveur ; sinon, consultez votre historique avant une nouvelle tentative.', foreign: 'Une autre offre est en cours de finalisation. Un nouvel envoi est temporairement bloqué.', closed: 'Cette demande est fermée aux nouvelles offres.' }
}
function newKey() {
  const bytes = new Uint8Array(24); window.crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}
export default function SourcingOfferForm(props) {
  const token = useSessionToken(), actor = props.supplier
  const owner = actor?.ownerId || actor?._id || actor?.id || ''
  const allowed = Boolean(token && token === props.sessionToken && (['supplier', 'admin'].includes(actor?.role) || (actor?.role === 'staff' && actor.permissions?.some(p => ['all', 'manage_rfq'].includes(p)))))
  return <Form {...props} key={token + ':' + owner + ':' + props.sourcing._id + ':' + allowed} token={token} allowed={allowed} />
}
function Form({ sourcing, token, allowed, onUpdated, onBlockClose }) {
  const { lang } = useTranslation(), c = localizeCopy(copy, lang)
  const recovery = sourcing.offerRecovery
  const [attempt, setAttempt] = useState(() => recovery ? { operationId: recovery.operationId, input: recovery.input } : null)
  const [form, setForm] = useState(() => recovery?.input || { unitPrice: '', deliveryDays: 3, paymentTerms: '', notes: '' })
  const review = labelFor(lang, "العملية محفوظة وتحتاج مراجعة تشغيلية. لا تنشئ عرضاً بديلاً لتجاوزها.", "Opération conservée ; une vérification opérationnelle est nécessaire. Ne créez pas une offre de remplacement.")
  const [phase, setPhase] = useState(recovery ? 'pending' : 'idle'), [error, setError] = useState(recovery?.requiresReview ? review : ''), [loading, setLoading] = useState(false), [waiting, setWaiting] = useState(false)
  const active = useRef(true), busy = useRef(false), controller = useRef(null), timer = useRef(null)
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); clearTimeout(timer.current) } }, [])
  useEffect(() => {
    if (recovery && !attempt) { setAttempt({ operationId: recovery.operationId, input: recovery.input }); setForm(recovery.input); setPhase('pending') }
  }, [recovery, attempt])
  useEffect(() => { onBlockClose?.(loading || Boolean(attempt && !attempt.operationId)); return () => onBlockClose?.(false) }, [loading, attempt, onBlockClose])
  const current = () => active.current && allowed && getSessionToken() === token
  async function submit(event) {
    event.preventDefault()
    if (!current() || busy.current || waiting) return
    busy.current = true; setLoading(true); setError(''); controller.current = new AbortController()
    let original = attempt
    try {
      original ||= { key: newKey(), input: Object.freeze({ unitPrice: Number(form.unitPrice), deliveryDays: Number(form.deliveryDays), paymentTerms: form.paymentTerms || '', notes: form.notes || '' }) }
      setAttempt(original); setPhase(original.operationId ? 'pending' : 'uncertain')
      const data = await apiRequest('/sourcing/' + sourcing._id + (original.operationId ? '/operations/' + original.operationId + '/retry' : '/quote'), {
        token, signal: controller.current.signal, method: 'POST',
        ...(original.operationId ? { body: {} } : { headers: { 'Idempotency-Key': original.key }, body: original.input }) })
      if (!current()) return
      if (data.processing === true) {
        if (data.code === 'SOURCING_OFFER_CONFLICT') setError(review)
        const saved = data.sourcing?.offerRecovery
        if (saved?.operationId) { setAttempt({ ...original, operationId: saved.operationId }); setPhase('pending') }
        else setPhase('uncertain')
        setWaiting(true); timer.current = setTimeout(() => { if (current()) setWaiting(false) }, 1000)
      } else if (data.processing === false && data.quote?._id) {
        setAttempt(null); setPhase('completed')
      } else throw new Error('Unconfirmed response')
      onUpdated?.(data)
    } catch (err) {
      if (!current() || err.name === 'AbortError') return
      if ([400, 413].includes(err.status) && !attempt?.operationId) { setAttempt(null); setPhase('idle'); setError(err.status === 413 ? c.capacity : err.message) }
      else {
        setPhase(original?.operationId ? 'pending' : 'uncertain')
        setError(err.data?.code === 'SOURCING_OPERATION_PENDING' ? c.busy : err.data?.code === 'SOURCING_OFFER_KEY_CONFLICT' ? c.conflict : err.data?.code === 'SOURCING_DOCUMENT_CAPACITY' ? c.capacity : c.uncertain)
      }
    } finally { busy.current = false; if (current()) setLoading(false) }
  }
  if (!allowed) return null
  if (phase === 'completed') return <p role="status">{labelFor(lang, "تم تأكيد حفظ العرض.", "Offre confirmée.")}</p>
  if (!attempt && sourcing.operation) return <p role="status">{sourcing.operation.kind === 'sourcing_decision' ? (labelFor(lang, "قرار المشتري قيد الاستكمال؛ لم يُثبت اتفاق نهائي جديد بعد.", "La décision de l’acheteur est en cours de finalisation ; aucun nouvel accord final confirmé.")) : c.foreign}</p>
  if (!attempt && !['open', 'quoted'].includes(sourcing.status)) return <p>{c.closed}</p>
  const set = (field, value) => setForm(previous => ({ ...previous, [field]: value }))
  return <form className="trade-supplier-reply" onSubmit={submit}>
    <h3>{c.title}</h3>
    {phase !== 'idle' && <p role="status" className="trade-uncertain">{phase === 'pending' ? c.pending : c.uncertain}</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={loading || Boolean(attempt)} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}><div className="form-grid">
      <Field label={c.price + (sourcing.unit ? ' (MAD / ' + sourcing.unit + ')' : '')} type="number" step="0.01" min="0.01" required value={form.unitPrice} onChange={e => set('unitPrice', e.target.value)} />
      <Field label={c.days} type="number" min="1" step="1" required value={form.deliveryDays} onChange={e => set('deliveryDays', e.target.value)} />
      <Field label={c.terms} maxLength={2000} value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} />
      <Field label={c.notes} maxLength={5000} value={form.notes} onChange={e => set('notes', e.target.value)} />
    </div></fieldset>
    {attempt && <p className="trade-help">{c.boundary}</p>}
    <button className="primary" disabled={loading || waiting}>{loading ? c.loading : attempt ? c.retry : c.send}</button>
  </form>
}
