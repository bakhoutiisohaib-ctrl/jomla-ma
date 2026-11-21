import { useState } from 'react';
import RFQModal from './RFQModal';
import ReportModal from '../common/ReportModal';
import ProtectedImage from '../common/ProtectedImage';
import ProductPreview from './ProductPreview';
import { MarketIcon } from '../common/MarketLayout';
import AddToQuoteCart from '../cart/AddToQuoteCart';
import SupplierRating from './SupplierRating';
import '../../styles/atlas-cards.css';
import { Link, productPath, storePath, supplierPath } from '../../navigation';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney } from '../../i18n/useLabels';
export default function ProductCard({
  product,
  user,
  onRfqCreated,
  onView,
  onRequireLogin,
  onCompare,
  compared = false
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
  return <article className="product-card atlas-compact-card">
    <div className="atlas-card-media"><Link to={productPath(product._id)}><ProtectedImage value={product.imageUrl} alt={product.name} loading="lazy" /></Link><button type="button" className="atlas-quick-view" aria-label={l('معاينة سريعة: ', 'Aperçu rapide : ') + product.name} onClick={() => setShowPreview(true)}><MarketIcon name="eye" /><span>{l('معاينة', 'Aperçu')}</span></button></div>
    <div className="product-body">
      {['exact', 'similar'].includes(product.matchType) && <span className="badge">{product.matchBasis === 'exact_image' ? l('الصورة نفسها', 'Même fichier image') : product.matchType === 'exact' ? l('تطابق نصي', 'Correspondance textuelle') : l('مرشح مشابه', 'Résultat similaire')}</span>}
    <h3><Link to={productPath(product._id)} title={product.name}>{product.name}</Link></h3>
    <p className="price">{product.pricingMode === 'on_request' ? l('السعر عند الطلب', 'Prix sur demande') : formatMoney(product.effectiveUnitPrice ?? product.price, product.currency, lang)}{product.pricingMode !== 'on_request' && <small> / {product.unit}</small>}</p>
    <p className="atlas-card-moq">{l('أقل طلب', 'Min.')}: <strong>{product.moq} {product.unit}</strong></p>
    {supplier?.name && <Link className="atlas-card-supplier" title={supplier.name} to={storeId ? storePath(storeId) : supplierPath(supplierId)}><MarketIcon name="store" /><span>{supplier.name}</span>{supplier.isVerified && supplier.verificationStatus === 'verified' && <span className="atlas-supplier-verified" aria-label={l('راجعته المنصة', 'Vérifié par la plateforme')} title={l('راجعته المنصة', 'Vérifié par la plateforme')}>✓</span>}</Link>}
    <p className="atlas-card-city">{product.city || supplier?.city}{!available && <span> · {l('غير متوفر', 'Indisponible')}</span>}</p>
    <SupplierRating supplierId={supplierId} />
    </div><div className="product-footer"><div className="actions">
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
