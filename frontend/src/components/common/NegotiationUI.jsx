import { localeFor } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels,formatMoney,statusLabel } from '../../i18n/useLabels';
import { agreedProduct } from './CommercialAgreement';

export function TradeTime({ value }) {
  const {lang}=useTranslation();const date=value?new Date(value):null;
  return date && Number.isFinite(date.getTime())?<time dateTime={date.toISOString()}>{date.toLocaleString(localeFor(lang))}</time>:null;
}
function offerMessageContent(message, offer, l, lang) {
  // The offer service assigns its offer id to the automatic message too.
  // Require both that link and the exact stored template: never translate a
  // person's message merely because it starts with similar Arabic wording.
  if (message.senderRole !== 'supplier' || !offer ||
      !Number.isFinite(offer.unitPrice) || !Number.isFinite(offer.deliveryDays) ||
      typeof offer.currency !== 'string' || typeof offer.notes !== 'string') return message.content;
  const prefix = `عرض سعر: ${offer.unitPrice} ${offer.currency}؛ التسليم ${offer.deliveryDays} أيام. `;
  if (message.content !== (prefix + offer.notes).slice(0, 5000).trim()) return message.content;
  return `${l('عرض سعر', 'Offre de prix', 'Price quote')}: ${formatMoney(offer.unitPrice, offer.currency, lang)}${lang === 'ar' ? '؛' : ';'} ${l('التسليم بالأيام', 'Délai en jours', 'Delivery in days')}: ${offer.deliveryDays}. ${message.content.slice(prefix.length)}`;
}

export function NegotiationMessages({messages=[], offers=[], role='buyer'}) {
  const l=useLabels(), {lang}=useTranslation();
  const offersById = new Map(offers.filter(o=>o?._id).map(o=>[String(o._id),o]));
  return <section className="trade-messages"><h3>{l('المحادثة','Conversation')}</h3>{!messages.length && <p className="muted">{l('لا توجد رسائل.','Aucun message.')}</p>}
    <ol>{messages.map(m=><li key={m._id} className={m.senderRole===role?'trade-message own':'trade-message'}><div><strong>{m.senderName}</strong><span>{m.senderRole==='buyer'?l('المشتري','Acheteur'):m.senderRole==='supplier'?l('المورد','Fournisseur'):m.senderRole}</span></div><p>{offerMessageContent(m,offersById.get(String(m._id)),l,lang)}</p><TradeTime value={m.sentAt}/></li>)}</ol>
  </section>;
}
export function OfferHistory({rfq,offers=[],busy=false,onChoose,disabled=false}) {
  const l=useLabels(),{lang}=useTranslation();
  return <section className="trade-offers"><h3>{l('سجل العروض','Historique des offres')}</h3>{!offers.length && <p className="muted">{l('لم يقدم المورد عرضاً بعد.','Le fournisseur n’a pas encore proposé de prix.')}</p>}
    {offers.map(o=>{
      const current=String(rfq?.currentOfferId)===String(o._id), expired=o.validUntil && new Date(o.validUntil).getTime()<=Date.now();
      const actionable=current && o.status==='active' && rfq?.status==='responded';
      const frozen=rfq?.decision?.agreement;const values=String(frozen?.offerId)===String(o._id)?frozen:o;
      const definition=values.product || o.productSnapshot || agreedProduct(rfq), quantity=values.quantity ?? rfq?.quantity;
      return <article key={o._id} className={'trade-offer '+(current?'current':'previous')}><div className="trade-offer-heading"><strong>{o.status==='preparing'?l('عرض قيد الاستكمال','Offre en cours de finalisation'):current?l('العرض الحالي','Offre actuelle'):l('عرض سابق','Offre antérieure')}</strong><span className="trade-status">{statusLabel(o.status,lang)}</span></div>
        <TradeTime value={o.createdAt}/>{definition?.name && <p>{definition.name}</p>}
        <dl><dt>{l('سعر الوحدة','Prix unitaire')}</dt><dd>{values.unitPrice==null?'—':values.currency || rfq?.currency?formatMoney(values.unitPrice,values.currency || rfq.currency,lang):values.unitPrice+' '+l('عملة غير محددة','Devise non précisée')}</dd><dt>{l('الكمية','Quantité')}</dt><dd>{quantity ?? '—'} {values.unit || definition?.unit}</dd><dt>{l('الإجمالي','Total')}</dt><dd>{values.totalPrice==null?'—':values.currency || rfq?.currency?formatMoney(values.totalPrice,values.currency || rfq.currency,lang):values.totalPrice+' '+l('عملة غير محددة','Devise non précisée')}</dd><dt>{l('التسليم بالأيام','Délai en jours')}</dt><dd>{values.deliveryDays ?? '—'}</dd><dt>{l('شروط الدفع','Conditions de paiement')}</dt><dd>{values.paymentTerms || l('لم يحدد المورد','Non précisé par le fournisseur')}</dd></dl>
        {o.validUntil && <p>{l('صالح حتى','Valable jusqu’au')}: <TradeTime value={o.validUntil}/>{expired && <strong> · {l('انتهت الصلاحية؛ يلزم عرض جديد','Expirée ; une nouvelle offre est nécessaire')}</strong>}</p>}
        {values.notes && <p>{values.notes}</p>}
        {actionable && onChoose && <><p className="trade-help">{l('هذا العرض الحالي الذي سيطبق قرارك عليه.','Votre décision porte sur cette offre actuelle.')}</p><div className="actions"><button type="button" className="primary" disabled={busy || disabled || expired} onClick={()=>onChoose(o,'accept')}>{l('قبول العرض','Accepter l’offre')}</button><button type="button" disabled={busy || disabled || expired} onClick={()=>onChoose(o,'reject')}>{l('رفض العرض','Refuser l’offre')}</button></div></>}
      </article>;
    })}
  </section>;
}
