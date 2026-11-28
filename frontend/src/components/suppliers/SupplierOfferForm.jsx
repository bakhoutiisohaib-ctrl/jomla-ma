import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field } from '../common/WorkspaceUI';
import { agreedProduct } from '../common/CommercialAgreement';

const empty = { unitPrice: '', deliveryDays: 3, paymentTerms: '', notes: '' };
function newKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('Secure random unavailable');
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}
export default function SupplierOfferForm(props) {
  const token = useSessionToken();
  return <OfferSession key={token + ':' + props.rfq._id} {...props} token={token}/>;
}
function OfferSession({ rfq, progress, token, onUpdated, onBlockClose, onReject, disabled }) {
  const l = useLabels();
  const [form, setForm] = useState(() => progress?.input || empty);
  const [uncertain, setUncertain] = useState(Boolean(progress)), [knownId, setKnownId] = useState(progress?.offerId || null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const attempt = useRef(null), busy = useRef(false), alive = useRef(true), controller = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    // Another authorized staff member may reserve an offer after this form was
    // opened. Display that saved input, while retaining our own frozen attempt
    // if we already submitted one and still need to resolve its acknowledgement.
    if (progress?.offerId && !attempt.current) {
      setForm(progress.input || empty); setKnownId(progress.offerId); setUncertain(true);
    }
  }, [progress]);
  const frozen = uncertain || Boolean(progress), blocked = loading || (uncertain && !knownId && !progress?.offerId);
  useEffect(() => { onBlockClose?.(blocked); return () => onBlockClose?.(false); }, [blocked, onBlockClose]);
  const valid = signal => alive.current && !signal.aborted && token === getSessionToken();
  async function submit(event, recover = false) {
    event?.preventDefault();
    if (busy.current || disabled || !token || (!recover && (attempt.current || frozen || rfq.status === 'offering'))) return;
    if (!recover) {
      try { attempt.current = { key: newKey(), body: JSON.parse(JSON.stringify({ ...form, unitPrice: Number(form.unitPrice), deliveryDays: Number(form.deliveryDays), quantity: rfq.quantity, currency: rfq.currency })) }; }
      catch { setError(l('تعذر إنشاء معرف آمن؛ استخدم متصفحاً حديثاً واتصالاً آمناً.', 'Impossible de créer un identifiant sûr ; utilisez un navigateur récent et une connexion sécurisée.')); return; }
    }
    const pendingId = knownId || progress?.offerId;
    if (!attempt.current && !pendingId) return;
    busy.current = true; setLoading(true); setError(''); setFeedback('');
    const active = new AbortController(); controller.current = active;
    try {
      const original = attempt.current;
      const result = await apiRequest('/rfq/' + rfq._id + (original ? '/respond' : '/offers/retry'), {
        method: original ? 'PUT' : 'POST', token, signal: active.signal,
        ...(original ? { headers: { 'Idempotency-Key': original.key }, body: original.body } : { body: { offerId: pendingId } })
      });
      if (!valid(active.signal)) return;
      if(result?.rfq?._id!==rfq._id ||
         (pendingId && result.submission?.offerId!==pendingId) ||
         (result.offer?._id && result.offer._id!==result.submission?.offerId))
        throw new Error(l('لم يتأكد إرسال العرض.', 'L’envoi de l’offre n’est pas confirmé.'));
      if (result.processing || (result.rfq?.status === 'offering' && !['completed', 'expired'].includes(result.submission?.phase))) {
        setUncertain(true); setKnownId(result.submission?.offerId || pendingId || null);
      } else if (result.offer?._id && ['completed', 'expired'].includes(result.submission?.phase)) {
        attempt.current = null; setUncertain(false); setKnownId(null); setForm(empty);
        setFeedback(result.submission.phase === 'expired'
          ? l('انتهت صلاحية المحاولة قبل اعتماد البديل؛ بقي العرض السابق محفوظاً. يمكنك إعداد عرض جديد.', 'La tentative a expiré avant validation du remplacement ; l’offre précédente est conservée. Vous pouvez préparer une nouvelle offre.')
          : l('تأكد حفظ العرض وآثاره. راجع حالته الحالية في سجل العروض.', 'L’offre et ses effets sont confirmés. Consultez son état actuel dans l’historique.'));
      } else { setUncertain(true); setError(l('لم يتأكد إرسال العرض.', 'L’envoi de l’offre n’est pas confirmé.')); }
      onUpdated?.(result);
    } catch (failure) {
      if (!valid(active.signal)) return;
      setError(failure.message);
      if (failure.status >= 400 && failure.status < 500 && ![408, 409].includes(failure.status) && !pendingId) { attempt.current = null; setUncertain(false); }
      else setUncertain(true);
    } finally { busy.current = false; if (valid(active.signal)) setLoading(false); }
  }
  const unit = agreedProduct(rfq)?.unit;
  const context = [form.currency || rfq.currency, unit].filter(Boolean).join(' / ');
  return <form className="trade-supplier-reply" onSubmit={submit}>
    <h3>{l('تقديم عرض سعر', 'Proposer un devis')}</h3>
    <p>{l('الكمية', 'Quantité')}: {attempt.current?.body.quantity ?? form.quantity ?? rfq.quantity} {unit} · {l('العملة', 'Devise')}: {attempt.current?.body.currency || form.currency || rfq.currency}</p>
    <fieldset disabled={loading || frozen || disabled || rfq.status === 'offering'} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="form-grid"><Field label={l('سعر الوحدة', 'Prix unitaire') + (context ? ' (' + context + ')' : '')} type="number" step="0.01" min="0.01" required value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })}/>
        <Field label={l('أيام التسليم', 'Délai (jours)')} type="number" min="1" required value={form.deliveryDays} onChange={e => setForm({ ...form, deliveryDays: e.target.value })}/>
        <Field label={l('شروط الدفع', 'Conditions de paiement')} maxLength={2000} value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })}/>
        <Field label={l('ملاحظات العرض', 'Notes de l’offre')} maxLength={5000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></div>
    </fieldset>
    {frozen && <div role="status" className="trade-uncertain"><p>{(knownId || progress?.offerId)
      ? l('حُفظت محاولة العرض وجارٍ استكمالها. لم يتأكد الإرسال النهائي؛ استكمل المحاولة نفسها أو افتح الطلب لاحقاً.', 'Tentative enregistrée et en cours de finalisation. L’envoi définitif n’est pas confirmé ; reprenez cette tentative ou rouvrez la demande plus tard.')
      : l('نتيجة الإرسال غير محسومة؛ قد يكون العرض محفوظاً. استكمل بالبيانات الأصلية نفسها. ابقَ هنا حتى تتأكد النتيجة؛ لا تُحفظ هذه البيانات على الجهاز.', 'Résultat incertain ; l’offre est peut-être enregistrée. Reprenez avec les données d’origine. Restez ici jusqu’à confirmation ; ces données ne sont pas stockées sur l’appareil.')}</p></div>}
    {error && <p role="alert" className="atlas-alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    <div className="actions">{frozen ? <button type="button" className="primary" disabled={loading || disabled} onClick={() => submit(null, true)}>{loading ? l('جارٍ الاستكمال…', 'Reprise…') : l('استكمال إرسال العرض', 'Reprendre l’envoi de l’offre')}</button>
      : <button type="submit" className="primary" disabled={loading || disabled || rfq.status === 'offering'}>{loading ? l('جارٍ الإرسال…', 'Envoi…') : l('إرسال العرض', 'Envoyer l’offre')}</button>}
      {onReject && !frozen && <button type="button" className="danger" disabled={loading || disabled || rfq.status === 'offering'} onClick={onReject}>{l('رفض الطلب', 'Refuser la demande')}</button>}</div>
  </form>;
}
