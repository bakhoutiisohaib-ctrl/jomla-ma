import { localeFor } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';

export function OpportunityTerms({ opportunity }) {
  const l = useLabels(), { lang } = useTranslation();
  return <><p className="price">{formatMoney(opportunity.price, opportunity.currency, lang)} / {opportunity.unit}</p>
    <p>MOQ: {opportunity.moq} {opportunity.unit}</p>
    <p>{l('تنتهي في', 'Expire le')}: <time dateTime={opportunity.expiresAt}>{new Date(opportunity.expiresAt).toLocaleString(localeFor(lang))}</time></p>
    {!!opportunity.priceTiers?.length && <div className="table-wrap"><table><caption>{l('سعر الوحدة حسب الكمية', 'Prix unitaire par quantité')}</caption><thead><tr><th>{l('الكمية', 'Quantité')}</th><th>{l('السعر', 'Prix')}</th></tr></thead><tbody>{opportunity.priceTiers.map((t, i) => <tr key={i}><td>{t.minQty}–{t.maxQty ?? '∞'} {opportunity.unit}</td><td>{formatMoney(t.price, opportunity.currency, lang)}</td></tr>)}</tbody></table></div>}
  </>;
}
export function WholesaleRfqContext({ context }) {
  const l = useLabels(), { lang } = useTranslation();
  if (!context) return null;
  return <section className="panel wholesale-rfq-context" aria-label={l('فرصة الجملة المرتبطة', 'Opportunité de gros associée')}>
    <h3>{l('فرصة الجملة المرتبطة', 'Opportunité de gros associée')}: {context.title}</h3>
    <p>{context.product?.name} · {context.store?.name}</p>
    <p>{l('مرجع الفرصة', 'Référence de l’opportunité')}: {context.id} · {l('النسخة', 'Version')}: {context.revision}</p>
    <p>{l('السعر الاسترشادي عند الطلب', 'Prix indicatif lors de la demande')}: {formatMoney(context.indicativeUnitPrice, context.currency, lang)} / {context.unit} · MOQ: {context.moq}</p>
    <p>{context.description}</p><p>{context.terms}</p>
    <p className="muted">{l('هذه نسخة شروط الفرصة عند إنشاء الطلب. إرسال RFQ لا يثبت هذا السعر؛ الاتفاق النهائي يعتمد العرض المقبول داخل المحادثة.', 'Copie des conditions lors de la demande. Le RFQ ne confirme pas ce prix ; l’accord final dépend de l’offre acceptée dans la conversation.')}</p>
  </section>;
}
