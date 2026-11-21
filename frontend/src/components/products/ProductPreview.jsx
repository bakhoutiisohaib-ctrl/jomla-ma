import { Link, productPath, storePath, supplierPath } from '../../navigation';
import AddToQuoteCart from '../cart/AddToQuoteCart';
import SupplierRating from './SupplierRating';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import AtlasDialog from '../common/AtlasDialog';
import ProtectedImage from '../common/ProtectedImage';
import { usePublicResource } from '../common/usePublicPage';
import { Notice } from '../common/WorkspaceUI';
import '../../styles/atlas-preview.css';

export default function ProductPreview({ id, onClose, user, onCompare, compared = false, onReport }) {
  const l = useLabels(), { lang } = useTranslation();
  // Load from the public detail route, with the same visibility revalidation as the product page.
  const { data, loading, error } = usePublicResource('/products/' + id);
  const product = data?.product, store = data?.store;
  const supplierId = product?.supplierId?._id || product?.supplierId;
  return <AtlasDialog title={l('معاينة سريعة', 'Aperçu rapide')} subtitle={l('نظرة أقرب قبل الاختيار', 'Un regard de plus près')} onClose={onClose}>
    {loading && <p role="status">{l('جاري تحميل المنتج…', 'Chargement du produit…')}</p>}
    {error && <Notice error>{error.status === 404 ? l('هذا المنتج لم يعد متاحاً للعرض.', 'Ce produit n’est plus disponible.') : error.message}</Notice>}
    {product && <div className="atlas-preview">
      <div className="atlas-preview-image"><ProtectedImage value={product.imageUrl} alt={product.name} /><span>{product.category}</span></div>
      <div className="atlas-preview-content"><h3>{product.name}</h3>
        <p className="atlas-preview-price">{product.pricingMode === 'on_request' ? l('السعر عند الطلب', 'Prix sur demande') : formatMoney(product.effectiveUnitPrice ?? product.price, product.currency, lang)}{product.pricingMode !== 'on_request' && <small> / {product.unit}</small>}</p>
        <SupplierRating supplierId={supplierId} />
        <dl><div><dt>{l('أقل طلب', 'Commande minimum')}</dt><dd>{product.moq} {product.unit}</dd></div><div><dt>{l('المدينة', 'Ville')}</dt><dd>{product.city || product.supplierId?.city || '—'}</dd></div><div><dt>{l('المورد', 'Fournisseur')}</dt><dd>{product.supplierId?.name || '—'}</dd></div></dl>
        <p>{product.description}</p>
        {!!product.priceTiers?.length && product.pricingMode !== 'on_request' && <div className="atlas-preview-tiers"><h4>{l('أسعار حسب الكمية', 'Tarifs par quantité')}</h4>{product.priceTiers.map((tier, index) => <div key={index}><span>{tier.minQty}–{tier.maxQty ?? '∞'} {product.unit}</span><strong>{formatMoney(tier.price, product.currency, lang)}</strong></div>)}</div>}
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
