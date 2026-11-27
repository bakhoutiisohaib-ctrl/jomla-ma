import { useState } from 'react';
import RFQModal from './RFQModal';
import ReportModal from '../common/ReportModal';
import ProtectedImage from '../common/ProtectedImage';
import ProductPreview from './ProductPreview';
import { MarketIcon } from '../common/MarketLayout';
import AddToQuoteCart from '../cart/AddToQuoteCart';
import SupplierRating from './SupplierRating';
import FavoriteButton from '../favorites/FavoriteButton';
import { cardPrice } from './cardPrice';
import '../../styles/atlas-cards.css';
import { Link, productPath, storePath, supplierPath } from '../../navigation';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney, localeFor } from '../../i18n/useLabels';
function RangePrice({ min, max, currency, lang }) {
  const formatter = new Intl.NumberFormat(localeFor(lang), { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 0 });
  const amount = value => formatter.formatToParts(value)
    .filter(part => ['integer','group','decimal','fraction'].includes(part.type))
    .map(part => part.value).join('');
  return <><bdi dir="ltr">{amount(min)} – {amount(max)}</bdi> <bdi>{currency === 'MAD' && lang === 'ar' ? 'د.م.' : currency}</bdi></>;
}
export default function ProductCard({
  product,
  user,
  onRfqCreated,
  onView,
  onRequireLogin,
  onCompare,
  compared = false,
  priceContext
}) {
  const l = useLabels(),
    {
      lang
    } = useTranslation();
  const [showRFQ, setShowRFQ] = useState(false),
    [showReport, setShowReport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const supplier = product.supplierId,
    supplierId = supplier?._id || supplier;
  const storeId = product.storeId?._id || product.storeId;
  const available = product.availability === 'in_stock' || product.inStock === true;
  const price = cardPrice(product, priceContext);
  return <article className="product-card atlas-compact-card atlas-density-card">
    <div className="atlas-card-media">
      <Link to={productPath(product._id)} aria-label={l('صورة المنتج: ', 'Image du produit : ', 'Product image: ') + product.name}><ProtectedImage value={product.imageUrl} alt={product.name} loading="lazy" /></Link>
      <button type="button" className="atlas-quick-view" aria-label={l('معاينة سريعة: ', 'Aperçu rapide : ') + product.name} onClick={() => setShowPreview(true)}><MarketIcon name="eye" /><span>{l('معاينة', 'Aperçu')}</span></button>
      <FavoriteButton product={product} />
      <div className="atlas-card-image-badges">
        <SupplierRating supplierId={supplierId} compact />
        {supplier?.isVerified && supplier.verificationStatus === 'verified' && <span className="atlas-supplier-verified atlas-card-trust" aria-label={l('راجعته المنصة', 'Vérifié par la plateforme')} title={l('راجعته المنصة', 'Vérifié par la plateforme')}><span aria-hidden="true">✓</span> {l('مورد موثق', 'Vérifié', 'Verified')}</span>}
      </div>
    </div>
    <div className="product-body">
      {['exact', 'similar'].includes(product.matchType) && <span className="badge">{product.matchBasis === 'exact_image' ? l('الصورة نفسها', 'Même fichier image') : product.matchType === 'exact' ? l('تطابق نصي', 'Correspondance textuelle') : l('مرشح مشابه', 'Résultat similaire')}</span>}
    <h3><Link to={productPath(product._id)} title={product.name}>{product.name}</Link></h3>
    <p className="price atlas-card-price" data-price-kind={price.kind}>
      {price.kind === 'request' ? l('السعر عند الطلب', 'Prix sur demande', 'Price on request')
        : price.kind === 'unknown' ? l('السعر غير متاح', 'Prix indisponible', 'Price unavailable')
        : price.kind === 'range' ? <RangePrice min={price.min} max={price.max} currency={product.currency} lang={lang} />
        : <bdi>{formatMoney(price.value, product.currency, lang)}</bdi>}
      {!['request','unknown'].includes(price.kind) && <small> / {product.unit}</small>}
    </p>
    {['range','quantity','base'].includes(price.kind) && <p className="atlas-card-price-context">
      {price.kind === 'range' ? l('حسب الكمية', 'Selon quantité', 'By quantity')
        : price.kind === 'base' ? l('السعر الأساسي للبحث', 'Prix de base du filtre', 'Search base price')
        : l('للكمية المطلوبة: ', 'Pour la quantité : ', 'For quantity: ') + price.quantity + ' ' + product.unit}
    </p>}
    <div className="atlas-card-origin">
    {supplier?.name && <Link className="atlas-card-supplier" title={supplier.name} to={storeId ? storePath(storeId) : supplierPath(supplierId)}><MarketIcon name="store" /><span>{supplier.name}</span></Link>}
    {(product.city || supplier?.city) && <span className="atlas-card-city" title={product.city || supplier?.city}>{product.city || supplier?.city}</span>}</div>{!available && <p className="atlas-card-unavailable">{l('غير متوفر', 'Indisponible', 'Unavailable')}</p>}
    </div><div className="product-footer"><div className="actions"><p className="atlas-card-moq">{l('أقل طلب', 'Min.', 'MOQ')}: <strong>{product.moq} {product.unit}</strong></p>
      <button className="primary" aria-label={l('طلب عرض سعر', 'Demander un devis')} disabled={!available || Boolean(user && user.role !== 'buyer')} title={user && user.role !== 'buyer' ? l('طلب العرض متاح لحساب المشتري', 'Demande réservée aux acheteurs') : undefined} onClick={() => {
          onView?.(product._id);
          if (!localStorage.getItem('supplierToken')) onRequireLogin?.(productPath(product._id) + '?rfq=1');else setShowRFQ(true);
        }}>{l('طلب عرض', 'Devis')}</button>
      <AddToQuoteCart product={product} user={user} compact />
    </div></div>
    {showRFQ && <RFQModal product={product} user={user} onSuccess={onRfqCreated} onClose={() => setShowRFQ(false)} onRequireLogin={onRequireLogin} />}
    {showReport && <ReportModal targetType="product" targetId={product._id} targetName={product.name} onClose={() => setShowReport(false)} />}
    {showPreview && <ProductPreview id={product._id} user={user} onCompare={onCompare} compared={compared} onReport={() => { setShowPreview(false); setShowReport(true); }} onClose={() => setShowPreview(false)} />}
  </article>;
}
