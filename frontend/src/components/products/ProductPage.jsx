import { useEffect, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';
import { Link, productPath, storePath, supplierPath, navigate } from '../../navigation';
import { Notice } from '../common/WorkspaceUI';
import { usePublicMeta, usePublicResource } from '../common/usePublicPage';
import ShareLink from '../common/ShareLink';
import ProductGallery from './ProductGallery';
import ProductSectionNav from './ProductSectionNav';
import ProductQuantityPricing from './ProductQuantityPricing';
import ComparableOffersDialog from './ComparableOffersDialog';
import { parseQuantity, validOrderQuantity } from './detailPricing';
import ProductSupplierReviews from './ProductSupplierReviews';
import RelatedProducts from './RelatedProducts';
import SupplierRating from './SupplierRating';
import RFQModal from './RFQModal';
import AddToQuoteCart from '../cart/AddToQuoteCart';
import '../../styles/atlas-product-detail.css';

export default function ProductPage({ id, search, user, sessionLoading, onBack, onRequireLogin, onRfqCreated }) {
  const l = useLabels();
  const { data, error, loading } = usePublicResource('/products/' + id);
  const [rfqIntent, setRfqIntent] = useState(null), [enteredQuantity, setEnteredQuantity] = useState(null);
  // Only the display budget survives visibility revalidation; cards never do.
  const [recommendationLimit, setRecommendationLimit] = useState(4);
  const [comparison,setComparison]=useState(null);
  const product = data?.product, store = data?.store, supplier = product?.supplierId;
  usePublicMeta(product?.name, product?.description, product ? productPath(id) : '');
  const supplierId = supplier?._id || supplier;
  const available = product?.availability === 'in_stock' || product?.inStock === true;
  const rawQuantity = enteredQuantity ?? String(product?.moq ?? '');
  const quantity = validOrderQuantity(product, rawQuantity);
  function rfqPath(value) {
    return productPath(id) + '?rfq=1' + (value !== null && (enteredQuantity !== null || value !== product.moq) ? '&qty=' + value : '');
  }
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!product || sessionLoading || user?.role !== 'buyer' || params.get('rfq') !== '1') return;
    const values = params.getAll('qty');
    const requested = values.length === 0 ? parseQuantity(product.moq) : values.length === 1 ? parseQuantity(values[0]) : null;
    const valid = validOrderQuantity(product, requested);
    if (values.length) setEnteredQuantity(requested === null ? '' : String(requested));
    if (available && valid !== null && params.getAll('rfq').length === 1) setRfqIntent({ id, quantity: valid });
    navigate(productPath(id), { replace: true });
  }, [product, user?.role, sessionLoading, search, id, available]);
  return <>
    <main className="container atlas-product-page atlas-detail-page" id="market-main" tabIndex="-1">
      {loading && <p role="status">{l('جاري تحميل المنتج…', 'Chargement du produit…')}</p>}
      {error && <section className="panel"><h1>{l('المنتج غير متاح', 'Produit indisponible')}</h1><Notice error>{error.status === 404 ? l('هذا المنتج غير موجود أو غير متاح للعرض العام.', 'Ce produit n’existe pas ou n’est pas disponible publiquement.') : error.message}</Notice><Link to="/">{l('العودة للسوق', 'Retour au catalogue')}</Link></section>}
      {product && <>
        <nav className="actions atlas-breadcrumbs" aria-label={l('مسار الصفحة', 'Fil d’Ariane')}><Link to="/">{l('السوق', 'Catalogue')}</Link>{store?._id && <><span aria-hidden="true">/</span><Link to={storePath(store._id)}>{store.name}</Link></>}<span aria-hidden="true">/</span><span>{product.category}</span></nav>
        <ProductSectionNav />
        <div className="atlas-detail-layout" id="product-overview" tabIndex="-1">
          <ProductGallery key={id} product={product} onCompare={()=>setComparison({id,quantity:parseQuantity(rawQuantity)})}/>
          <section className="atlas-detail-summary"><span className="atlas-eyebrow">{product.category}</span><h1>{product.name}</h1>
            <div className="atlas-detail-stock"><span className={'badge ' + (available ? 'green' : 'amber')}>{available ? l('متوفر بحسب المورد', 'Disponible selon le fournisseur') : l('غير متوفر', 'Indisponible')}</span><span>{product.city || supplier?.city}</span></div>
            <ProductQuantityPricing product={product} quantity={rawQuantity} onQuantityChange={setEnteredQuantity} />
            <div className="atlas-detail-request" role="region" aria-label={l('إجراءات المنتج', 'Actions du produit', 'Product actions')}><button className="primary" disabled={sessionLoading || !available || quantity === null || Boolean(user && user.role !== 'buyer')} onClick={() => !user ? onRequireLogin(rfqPath(quantity)) : setRfqIntent({ id, quantity })}>{l('طلب عرض سعر', 'Demander un devis')}</button>
            <button type="button" onClick={()=>setComparison({id,quantity:parseQuantity(rawQuantity)})}>{l('مقارنة','Comparer','Compare')}</button>
            {!sessionLoading && <AddToQuoteCart product={product} user={user} />}
            {store?._id && <Link className="atlas-detail-store-action button-link" to={storePath(store._id)}>{l('المتجر', 'Boutique', 'Store')}</Link>}</div>
            {!user && <p className="muted atlas-rfq-note">{l('تصفح دون حساب. إرسال الطلب يتطلب دخول المشتري.', 'Consultation libre. Un compte acheteur est requis pour envoyer la demande.')}</p>}
            {user && user.role !== 'buyer' && <p>{l('إرسال طلب عرض السعر متاح لحساب المشتري.', 'L’envoi d’une demande de devis est réservé au compte acheteur.')}</p>}
            {supplierId && <aside className="atlas-detail-supplier" aria-label={l('معلومات المورد', 'Informations du fournisseur')}><span className="atlas-detail-muted">{l('مقدم هذا المنتج', 'Proposé par')}</span><h2><Link to={supplierPath(supplierId)}>{supplier?.name || l('المورد', 'Fournisseur')}</Link></h2><p>{supplier?.city || product.city}{product.country ? ' · ' + product.country : ''}</p>
              {supplier?.isVerified && supplier.verificationStatus === 'verified' && <p className="badge green">{l('راجعته إدارة المنصة', 'Vérifié par la plateforme')}</p>}
              <SupplierRating supplierId={supplierId} />
              {store?._id && <Link className="button-link" to={storePath(store._id)}>{l('زيارة المتجر', 'Voir la boutique')} · {store.name}</Link>}
            </aside>}
          </section>
        </div>
        <div id="product-details" className="atlas-detail-content" tabIndex="-1">
        <section className="atlas-detail-section" id="product-description"><div className="atlas-detail-info-grid"><div><h2>{l('عن هذا المنتج', 'À propos de ce produit')}</h2><p className="atlas-detail-description">{product.description || l('لم يضف المورد وصفاً بعد.', 'Le fournisseur n’a pas encore ajouté de description.')}</p></div>
          <div><h2>{l('المواصفات المتاحة', 'Caractéristiques disponibles')}</h2><dl className="atlas-detail-specs"><dt>{l('الفئة', 'Catégorie')}</dt><dd>{product.category}</dd><dt>{l('وحدة البيع', 'Unité de vente')}</dt><dd>{product.unit}</dd><dt>{l('الحد الأدنى للطلب', 'Commande minimum')}</dt><dd>{product.moq} {product.unit}</dd><dt>{l('العملة', 'Devise')}</dt><dd>{product.currency}</dd><dt>{l('موقع العرض', 'Localisation de l’offre')}</dt><dd>{product.city}{product.country ? ' · ' + product.country : ''}</dd></dl></div>
        </div><ShareLink path={productPath(id)} /></section>
        {supplierId && <ProductSupplierReviews key={supplierId + ':' + (user?._id || 'guest')} supplierId={supplierId} user={user} />}
        </div>
        <RelatedProducts key={id} product={product} visible={recommendationLimit} setVisible={setRecommendationLimit} user={user} onRequireLogin={onRequireLogin} onRfqCreated={onRfqCreated} />
      </>}
      {product&&comparison?.id===id&&<ComparableOffersDialog productId={id} initialQuantity={comparison.quantity} onClose={()=>setComparison(null)}/>}
      {product && available && rfqIntent?.id === id && <RFQModal key={id + ':' + (user?._id || 'visitor')} product={product} user={user} initialQuantity={rfqIntent.quantity} onClose={() => setRfqIntent(null)} onRequireLogin={() => onRequireLogin(rfqPath(rfqIntent.quantity))} onSuccess={onRfqCreated} />}
    </main></>;
}
