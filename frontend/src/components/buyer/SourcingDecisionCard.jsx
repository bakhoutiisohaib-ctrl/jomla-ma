import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../api/config'
import { getSessionToken, useSessionToken } from '../../api/session'
import { useTranslation } from '../../i18n/LanguageContext'
import { labelFor } from '../../i18n/useLabels'
import { statusLabel } from '../../i18n/useLabels'
import SourcingQuoteTerms from '../common/SourcingQuoteTerms'
export default function SourcingDecisionCard(props) {
  const token = useSessionToken(), allowed = Boolean(token && token === props.sessionToken && props.user?.role === 'buyer')
  return <Card {...props} key={token + ':' + (props.user?._id || props.user?.id || '') + ':' + props.sourcing._id + ':' + allowed} token={token} allowed={allowed}/>
}
function Card({ sourcing, token, allowed, busy: outsideBusy, onUpdated }) {
  const { lang } = useTranslation(), l = (ar, french) => labelFor(lang, ar, french)
  const [record, setRecord] = useState(sourcing), [attempt, setAttempt] = useState(sourcing.decisionRecovery || null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false)
  const active = useRef(true), running = useRef(false), controller = useRef(null)
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort() } }, [])
  useEffect(() => {
    setRecord(previous => (sourcing.__v ?? 0) >= (previous.__v ?? 0) ? sourcing : previous)
    setAttempt(previous => {
      const decided = previous && sourcing.quotes?.find(q => q._id === previous.quoteId)?.decision
      if (previous && decided?.action === previous.action) return null
      return previous || sourcing.decisionRecovery || null
    })
  }, [sourcing])
  const current = () => active.current && allowed && getSessionToken() === token
  async function send(original) {
    if (!current() || running.current || outsideBusy) return
    running.current = true; setLoading(true); setError(''); setConfirmed(false)
    setAttempt(original); controller.current = new AbortController()
    try {
      const url = '/sourcing/' + record._id + (original.operationId ? '/operations/' + original.operationId + '/retry' : '/quotes/' + original.quoteId + '/action')
      const result = await apiRequest(url, { token, signal: controller.current.signal, cache: 'no-store', method: original.operationId ? 'POST' : 'PUT', body: original.operationId ? {} : { action: original.action } })
      if (!current()) return
      if (!result.sourcing || ![true, false].includes(result.processing)) throw new Error('Unconfirmed decision')
      if (result.processing === false && (!result.quote || result.quote._id !== original.quoteId || result.quote.decision?.action !== original.action)) throw new Error('Unconfirmed decision receipt')
      setRecord(result.sourcing)
      if (result.processing) setAttempt({ ...original, ...result.sourcing.decisionRecovery })
      else { setAttempt(null); setConfirmed(true) }
      onUpdated?.(result)
    } catch (err) {
      if (!current() || err.name === 'AbortError') return
      if ([400, 413].includes(err.status) && !original.operationId) setAttempt(null)
      setError(err.data?.code === 'SOURCING_DOCUMENT_CAPACITY' ? l('لا يتسع السجل لتثبيت القرار بأمان؛ يلزم فحص تشغيلي.', 'Historique trop volumineux : vérification opérationnelle nécessaire.')
        : l('تعذر تأكيد القرار. استكمل الإجراء نفسه؛ لا تتخذ قراراً معاكساً.', 'Décision non confirmée. Reprenez la même action ; ne choisissez pas une action opposée.'))
    } finally { running.current = false; if (current()) setLoading(false) }
  }
  if (!allowed) return null
  const locked = loading || outsideBusy || Boolean(attempt) || Boolean(record.operation)
  return <article className="buyer-request" id={'sourcing-' + record._id}>
    <h2>{record.productName}</h2><p>{l('رقم الطلب', 'Référence')}: {record._id}</p>
    <p>{l('الكمية', 'Quantité')}: {record.quantity} {record.unit} · {l('الحالة', 'État')}: {record.status === 'fulfilled' ? l('تم اختيار عرض', 'Offre sélectionnée') : record.status === 'closed' ? l('مغلق', 'Fermée') : l('مفتوح للعروض', 'Ouverte aux offres')}</p>
    {record.notes && <p>{record.notes}</p>}
    {(attempt || record.operation) && <p role="status">{record.operation?.kind === 'sourcing_offer' && !attempt
      ? l('جارٍ استكمال عرض توريد؛ لم يُنشر العرض الجديد بعد.', 'Une offre est en cours de finalisation ; elle n’est pas encore publiée.')
      : l('القرار قيد التحقق والاستكمال؛ لم يُثبت اتفاق نهائي جديد بعد.', 'Décision en cours de vérification et de finalisation ; aucun nouvel accord final confirmé.')}</p>}
    {attempt && <div className="trade-uncertain"><p>{attempt.action === 'accept' ? l('محاولة قبول العرض', 'Tentative d’acceptation') : l('محاولة رفض العرض', 'Tentative de refus')}: {attempt.quoteId}</p>
      {attempt.requiresReview && <p role="alert">{l('العملية محفوظة وتحتاج مراجعة تشغيلية؛ لا تتجاوزها بقرار جديد.', 'Opération conservée ; vérification opérationnelle nécessaire. Ne la contournez pas.')}</p>}
      <button disabled={loading || outsideBusy} onClick={() => send(attempt)}>{loading ? l('جاري التحقق…', 'Vérification…') : l('استكمال القرار نفسه', 'Reprendre la même décision')}</button>
      <p className="trade-help">{l('المحاولة المحلية في ذاكرة الصفحة فقط. العملية المحفوظة تُسترجع من الخادم بعد إعادة الفتح، دون إرسال قرار تلقائي.', 'Tentative locale conservée uniquement en mémoire. Une opération enregistrée est récupérée après réouverture, sans envoi automatique.')}</p></div>}
    {error && <p role="alert">{error}</p>}{confirmed && <p role="status">{l('تم تأكيد تثبيت القرار.', 'Décision confirmée.')}</p>}
    {!record.quotes?.length && <p>{l('لم يقدم المورد عرضاً بعد.', 'Le fournisseur n’a pas encore proposé de prix.')}</p>}
    {record.quotes?.map(q => <section className="trade-offer" key={q._id}><h3>{q.supplierName}</h3><p>{statusLabel(q.status, lang)}</p><SourcingQuoteTerms quote={q} sourcing={record}/>
      {q.status === 'active' && ['open', 'quoted'].includes(record.status) && <div className="actions">
        <button disabled={locked} onClick={() => send(Object.freeze({ quoteId: q._id, action: 'accept' }))}>{l('قبول العرض', 'Accepter l’offre')}</button>
        <button disabled={locked} onClick={() => send(Object.freeze({ quoteId: q._id, action: 'reject' }))}>{l('رفض العرض', 'Refuser l’offre')}</button></div>}</section>)}
  </article>
}
