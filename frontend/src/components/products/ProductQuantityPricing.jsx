import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { cardPrice } from './cardPrice';
import { detailPricing, parseQuantity, validOrderQuantity } from './detailPricing';

export default function ProductQuantityPricing({ product, quantity, onQuantityChange }) {
  const l = useLabels(), { lang } = useTranslation();
  const result = detailPricing(product, quantity);
  const valid = validOrderQuantity(product, quantity), minimum = parseQuantity(product.moq);
  const tiers = cardPrice(product).kind !== 'unknown' && product.pricingMode !== 'on_request'
    ? [...(product.priceTiers || [])].sort((a, b) => a.minQty - b.minQty) : [];
  const money = value => formatMoney(value, product.currency, lang);
  const unavailable = l('السعر غير متاح', 'Prix indisponible', 'Price unavailable');
  const fixed = result.kind === 'fixed';
  function adjust(delta) {
    const next = valid === null ? minimum : valid + delta;
    if (validOrderQuantity(product, next) !== null) onQuantityChange(String(next));
  }
  return <div className="atlas-detail-pricing">
    <p className="atlas-detail-muted">{l('سعر الوحدة للكمية المختارة', 'Prix unitaire pour la quantité choisie', 'Unit price for selected quantity')}</p>
    <p className="atlas-detail-price" data-price-kind={result.kind}>{fixed ? <>{money(result.unitPrice)} <small>/ {product.unit}</small></> : product.pricingMode === 'on_request' ? l('السعر عند الطلب', 'Prix sur demande', 'Price on request') : unavailable}</p>
    <p className="atlas-detail-moq">{l('الحد الأدنى للطلب', 'Commande minimum')}: <strong>{minimum ?? '—'} {product.unit}</strong></p>
    {!!tiers.length && <div className="table-wrap atlas-detail-tiers"><table><caption>{l('شرائح السعر حسب الكمية', 'Tarifs par quantité')}</caption><thead><tr><th>{l('الكمية', 'Quantité')}</th><th>{l('سعر الوحدة', 'Prix unitaire')}</th></tr></thead>
      <tbody>{tiers.map(tier => <tr key={tier.minQty} data-selected-tier={fixed && result.tierMin === tier.minQty ? 'true' : undefined}><td><button type="button" className="atlas-tier-choice" aria-pressed={fixed && result.tierMin === tier.minQty} onClick={() => onQuantityChange(String(tier.minQty))}>{tier.maxQty == null ? <>{l('ابتداءً من ', 'À partir de ', 'From ')}<bdi dir="ltr">{tier.minQty}</bdi></> : <bdi dir="ltr">{tier.minQty}–{tier.maxQty}</bdi>} {product.unit}</button></td><td>{money(tier.price)}</td></tr>)}</tbody></table></div>}
    <div className="atlas-quantity-panel">
      <label htmlFor="atlas-detail-quantity">{l('اختر الكمية', 'Choisir la quantité', 'Choose quantity')}</label>
      <div className="atlas-quantity-stepper">
        <button type="button" aria-label={l('تقليل الكمية', 'Diminuer la quantité', 'Decrease quantity')} disabled={valid === null || valid <= minimum} onClick={() => adjust(-1)}>−</button>
        <input id="atlas-detail-quantity" type="text" inputMode="numeric" dir="ltr" maxLength={16} value={quantity} aria-invalid={valid === null} aria-describedby="atlas-detail-estimate" onChange={event => onQuantityChange(event.target.value)} />
        <button type="button" aria-label={l('زيادة الكمية', 'Augmenter la quantité', 'Increase quantity')} disabled={minimum === null || valid === Number.MAX_SAFE_INTEGER} onClick={() => adjust(1)}>+</button>
      </div>
      <div id="atlas-detail-estimate" aria-live="polite">
        {valid === null ? <p className="atlas-quantity-error">{l('أدخل كمية صحيحة لا تقل عن الحد الأدنى.', 'Saisissez une quantité entière valide au moins égale au minimum.', 'Enter a valid whole quantity at least equal to the minimum.')}</p>
          : fixed ? <><p className="atlas-detail-muted">{result.tierMin === null && !!tiers.length ? l('السعر الأساسي ينطبق على هذه الكمية.', 'Le prix de base s’applique à cette quantité.', 'Base price applies to this quantity.') : null}</p>
            <p className="atlas-quantity-total">{l('الإجمالي التقديري', 'Total estimatif', 'Estimated total')}: <strong>{result.total === null ? '—' : money(result.total)}</strong></p></>
          : <p>{result.kind === 'request' ? l('يحدد المورد السعر في عرضه.', 'Le fournisseur fixe le prix dans son offre.', 'The supplier sets the price in their quote.') : unavailable}</p>}
        <p className="atlas-detail-muted">{l('تقدير غير ملزم، دون الشحن والرسوم. السعر النهائي وفق عرض المورد.', 'Estimation non contractuelle, hors livraison et frais. Prix final selon le devis du fournisseur.', 'Non-binding estimate, excluding delivery and fees. Final price follows the supplier quote.')}</p>
      </div>
    </div>
  </div>;
}
