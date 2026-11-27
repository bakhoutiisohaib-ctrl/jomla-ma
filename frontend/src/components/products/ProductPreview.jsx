import { Link, productPath, storePath, supplierPath } from '../../navigation';
import AddToQuoteCart from '../cart/AddToQuoteCart';
import SupplierRating from './SupplierRating';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import AtlasDialog from '../common/AtlasDialog';
import ProtectedImage from '../common/ProtectedImage';
import { usePublicResource } from '../common/usePublicPage';
import { cardPrice } from './cardPrice';
import { detailPricing, parseQuantity } from './detailPricing';
import { Notice } from '../common/WorkspaceUI';
import '../../styles/atlas-preview.css';

export default function ProductPreview({ id, priceContext, onClose, user, onCompare, compared = false, onReport }) {
  const l = useLabels(), { lang } = useTranslation();
  // Load from the public detail route, with the same visibility revalidation as the product page.
  const { data, loading, error } = usePublicResource('/products/' + id);
  const product = data?.product, store = data?.store;
  const supplierId = product?.supplierId?._id || product?.supplierId;
  // Use the newly fetched public detail DTO, never a stale card price.
  const general = product ? cardPrice(product) : { kind: 'unknown' };
  const quantity = parseQuantity(priceContext?.moqPriceSearch?product?.moq:priceContext?.quantity);
  const selected = product && quantity !== null ? detailPricing(product, quantity) : null;
  const price = selected ? (selected.kind === 'fixed' ? {kind:priceContext?.moqPriceSearch?'moq':'quantity', value:selected.unitPrice, quantity} : {kind:selected.kind === 'request' ? 'request' : 'unknown'})
    : product && priceContext?.basePriceSearch && !['unknown','request'].includes(general.kind) ? cardPrice(product, {basePriceSearch:true}) : general;
  const tiers = product && !['unknown','request'].includes(general.kind)
    ? [...(product.priceTiers || [])].sort((a,b) => a.minQty - b.minQty) : [];
  const money = value => formatMoney(value, product?.currency, lang);
  return <AtlasDialog title={l('معاينة سريعة', 'Aperçu rapide')} subtitle={l('نظرة أقرب قبل الاختيار', 'Un regard de plus près')} onClose={onClose}>
    {loading && <p role="status">{l('جاري تحميل المنتج…', 'Chargement du produit…')}</p>}
    {error && <Notice error>{error.status === 404 ? l('هذا المنتج لم يعد متاحاً للعرض.', 'Ce produit n’est plus disponible.') : error.message}</Notice>}
    {product && <div className="atlas-preview">
      <div className="atlas-preview-image"><ProtectedImage value={product.imageUrl} alt={product.name} /><span>{product.category}</span></div>
      <div className="atlas-preview-content"><h3>{product.name}</h3>
        <p className="atlas-preview-price" data-price-kind={price.kind}>{price.kind === 'request' ? l('السعر عند الطلب', 'Prix sur demande', 'Price on request')
          : price.kind === 'unknown' ? l('السعر غير متاح', 'Prix indisponible', 'Price unavailable')
          : price.kind === 'range' ? <><bdi>{money(price.min)}</bdi> – <bdi>{money(price.max)}</bdi></> : <bdi>{money(price.value)}</bdi>}
          {!['request','unknown'].includes(price.kind) && <small> / {product.unit}</small>}</p>
        {['range','quantity','base','moq'].includes(price.kind) && <p className="atlas-preview-price-context">{price.kind === 'range' ? l('حسب الكمية', 'Selon quantité', 'By quantity') : price.kind === 'base' ? l('السعر الأساسي للبحث', 'Prix de base du filtre', 'Search base price') : <>{price.kind==='moq'?l('عند الحد الأدنى: ','Au minimum : ','At MOQ: '):l('للكمية المطلوبة: ', 'Pour la quantité : ', 'For quantity: ')}<bdi dir="ltr">{price.quantity}</bdi> {product.unit}</>}</p>}
        <SupplierRating supplierId={supplierId} />
        <dl><div><dt>{l('أقل طلب', 'Commande minimum')}</dt><dd>{product.moq} {product.unit}</dd></div><div><dt>{l('المدينة', 'Ville')}</dt><dd>{product.city || product.supplierId?.city || '—'}</dd></div><div><dt>{l('المورد', 'Fournisseur')}</dt><dd>{product.supplierId?.name || '—'}</dd></div></dl>
        <p>{product.description}</p>
        {!!tiers.length && <div className="atlas-preview-tiers"><h4>{l('أسعار حسب الكمية', 'Tarifs par quantité')}</h4>{tiers.map(tier => <div key={tier.minQty}><span>{tier.maxQty == null ? <>{l('ابتداءً من ', 'À partir de ', 'From ')}<bdi dir="ltr">{tier.minQty}</bdi></> : <bdi dir="ltr">{tier.minQty}–{tier.maxQty}</bdi>} {product.unit}</span><strong>{money(tier.price)}</strong></div>)}</div>}
        <p className="atlas-preview-availability">{product.availability === 'in_stock' || product.inStock === true ? l('متوفر بحسب المورد', 'Disponible selon le fournisseur') : l('غير متوفر حالياً', 'Indisponible actuellement')}</p>
        <div className="atlas-preview-actions">
          <Link className="button-link" to={productPath(id)} onClick={onClose}>{l('التفاصيل وطلب عرض سعر', 'Détails et demande de devis')}</Link>
          <AddToQuoteCart product={product} user={user} />
          <div className="atlas-preview-secondary">
            {onCompare && <button type="button" aria-pressed={compared} onClick={() => onCompare(product)}>{compared ? l('إزالة المقارنة', 'Retirer de la comparaison') : l('مقارنة', 'Comparer')}</button>}
            {supplierId && <Link to={store?._id ? storePath(store._id) : supplierPath(supplierId)} onClick={onClose}>{l('زيارة المتجر', 'Voir la boutique')}</Link>}
            {onReport && <button type="button" onClick={onReport}>{l('إبلاغ عن المنتج', 'Signaler ce produit')}</button>}
          </div>
        </div>
      </div>
    </div>}
  </AtlasDialog>;
}
