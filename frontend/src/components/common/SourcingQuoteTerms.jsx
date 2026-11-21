import { labelFor } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext'
import { formatMoney } from '../../i18n/useLabels'
export default function SourcingQuoteTerms({ quote, sourcing }) {
  const { lang } = useTranslation(), snapshot = quote.agreement?.snapshot || quote.commercialSnapshot
  const values = snapshot?.offer || quote, quantity = snapshot?.request?.quantity ?? sourcing.quantity, unit = snapshot?.request?.unit ?? sourcing.unit
  const total = snapshot?.offer?.totalPrice ?? values.unitPrice * quantity
  return <>
    {snapshot && <p className="trade-help">{quote.agreement ? (labelFor(lang, "اتفاق مثبت؛ اختيار العرض فقط، دون دفع أو تسليم.", "Accord figé ; sélection uniquement, sans paiement ni livraison.")) : (labelFor(lang, "بيانات التسعير المثبتة وقت العرض", "Données figées lors du devis"))}</p>}
    {quote.agreement?.source === 'legacy_sourcing_quote_at_decision' && <p className="trade-help">{labelFor(lang, "عرض قديم: ثُبتت البيانات المتاحة عند هذا القرار الجديد.", "Offre ancienne : données disponibles figées lors de cette décision.")}</p>}
    {snapshot?.request?.productName && <p>{snapshot.request.productName}</p>}
    {snapshot?.request?.notes && <p>{snapshot.request.notes}</p>}
    <p>{labelFor(lang, "الكمية", "Quantité")}: {quantity} {unit}</p>
    <p>{labelFor(lang, "سعر الوحدة", "Prix unitaire")}: {formatMoney(values.unitPrice, values.currency, lang)} · {labelFor(lang, "الإجمالي", "Total")}: {Number.isFinite(total) ? formatMoney(total, values.currency, lang) : '—'}</p>
    <p>{labelFor(lang, "أيام التسليم", "Délai (jours)")}: {values.deliveryDays}</p>
    <p>{labelFor(lang, "شروط الدفع", "Conditions de paiement")}: {values.paymentTerms || '—'}</p>
    {values.notes && <p>{values.notes}</p>}
  </>
}
