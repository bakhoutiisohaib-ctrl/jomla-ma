import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { WholesaleRfqContext } from '../wholesale/OpportunityTerms';

export const agreedProduct = rfq => rfq?.decision?.agreement?.product || rfq?.offer?.productSnapshot || rfq?.wholesaleOpportunity?.product || rfq?.productId;

export default function CommercialAgreement({ rfq, onRetry, busy = false }) {
  const { lang } = useTranslation();
  const l = useLabels();
  const decision = rfq?.decision;
  const agreement = decision?.agreement;
  const pending = rfq?.status === 'deciding' && decision?.phase === 'pending';
  const opportunityContext = agreement?.wholesaleOpportunity || rfq?.wholesaleOpportunity;
  if (!agreement && !pending && rfq?.status !== 'accepted') return <WholesaleRfqContext context={opportunityContext} />;
  return <><WholesaleRfqContext context={opportunityContext} /><section className="panel" aria-label={l('بيانات الاتفاق', 'Données de l’accord')}>
    <h3>{pending ? l('القرار محفوظ وقيد الاستكمال', 'Décision enregistrée, finalisation en cours') : agreement ? l('بيانات الاتفاق المثبتة', 'Données figées de l’accord') : l('سجل اتفاق قديم', 'Ancien accord')}</h3>
    {pending && <p role="status">{l('لم يكتمل تثبيت القرار بعد. يمنع تغيير العرض أو اتخاذ قرار مخالف، وتُعاد محاولة الاستكمال تلقائياً.', 'La finalisation n’est pas terminée. L’offre et la décision sont verrouillées ; une nouvelle tentative est automatique.')}</p>}
    {pending && onRetry && <button type="button" disabled={busy} onClick={onRetry}>{l('إعادة استكمال القرار', 'Réessayer la finalisation')}</button>}
    {!agreement && rfq?.status === 'accepted' && <p>{l('سجل قديم دون نسخة تاريخية مثبتة. لم نُعد بناء بيانات الاتفاق تخميناً؛ قد تختلف بيانات المنتج الحالية.', 'Ancien accord sans copie historique figée. Aucune reconstitution supposée ; les données actuelles du produit peuvent différer.')}</p>}
    {agreement && <>
      <p><strong>{agreement.product.name}</strong> · {agreement.product.category}</p>
      <p>{agreement.product.description}</p>
      <p>{l('المورد', 'Fournisseur')}: {agreement.supplier.name} · {l('المشتري', 'Acheteur')}: {agreement.buyer.name}</p>
      <p>{l('الكمية', 'Quantité')}: {agreement.quantity} {agreement.unit}</p>
      <p>{l('سعر الوحدة', 'Prix unitaire')}: {formatMoney(agreement.unitPrice, agreement.currency, lang)} · {l('الإجمالي', 'Total')}: {formatMoney(agreement.totalPrice, agreement.currency, lang)}</p>
      <p>{l('العملة', 'Devise')}: {agreement.currency} · {l('التسليم بالأيام', 'Délai en jours')}: {agreement.deliveryDays}</p>
      <p>{l('شروط الدفع', 'Conditions de paiement')}: {agreement.paymentTerms || l('لم يحدد المورد', 'Non précisé')}</p>
      {agreement.notes && <p>{l('ملاحظات العرض', 'Remarques de l’offre')}: {agreement.notes}</p>}
      {agreement.requestNotes && <p>{l('متطلبات المشتري', 'Exigences de l’acheteur')}: {agreement.requestNotes}</p>}
      <p>{l('مرجع العرض', 'Référence de l’offre')}: {agreement.offerId}</p>
      {agreement.source === 'legacy_product_at_decision' && <p>{l('عرض قديم: ثُبت تعريف المنتج المتاح وقت هذا القرار الجديد، وليس وقت إنشاء العرض القديم.', 'Offre ancienne : description figée lors de cette nouvelle décision, et non lors de la création de l’offre ancienne.')}</p>}
    </>}
  </section></>;
}
