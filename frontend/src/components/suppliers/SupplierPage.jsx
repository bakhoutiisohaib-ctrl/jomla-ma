import { useState, useEffect } from 'react';
import ProductCard from '../products/ProductCard';
import ReviewSection from '../reviews/ReviewSection';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { WorkspaceHeader, Notice } from '../common/WorkspaceUI';
export default function SupplierPage({
  supplierId,
  storeId,
  onBack,
  onRequireLogin,
  user
}) {
  const l = useLabels(),
    [supplier, setSupplier] = useState(null),
    [store, setStore] = useState(null),
    [products, setProducts] = useState([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError('');
    (async () => {
      try {
        if (storeId) {
          const data = await apiRequest('/stores/' + storeId, {
            signal: c.signal
          });
          setStore(data.store);
          setSupplier(data.store.supplierId);
          setProducts(data.products || []);
        } else {
          const [profile, catalog] = await Promise.all([apiRequest('/suppliers/' + supplierId, {
            signal: c.signal
          }), apiRequest('/products/search?supplier=' + supplierId + '&limit=100', {
            signal: c.signal
          })]);
          setSupplier(profile);
          setProducts(catalog.data || []);
        }
      } catch (e) {
        if (e.name !== 'AbortError') setError(e.message);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => c.abort();
  }, [supplierId, storeId]);
  return <><WorkspaceHeader title={store?.name || supplier?.name || l('المتجر', 'Boutique')} onBack={onBack} /><main className="container"><Notice error>{error}</Notice>{loading && <p role="status">{l('جاري التحميل…', 'Chargement…')}</p>}{supplier && <><section className="panel"><h1>{store?.name || supplier.name}</h1><p>{store?.description || supplier.description}</p><p>{store?.city || supplier.city} · {store?.address}</p>{supplier.isVerified && supplier.verificationStatus === 'verified' && <span className="badge green">{l('راجعته إدارة المنصة', 'Vérifié par la plateforme')}</span>}</section><div className="product-grid">{products.map(p => <ProductCard key={p._id} product={{
            ...p,
            supplierId: supplier
          }} user={user} onRequireLogin={onRequireLogin} onViewSupplier={() => {}} />)}</div>{!products.length && <p className="empty">{l('لا توجد منتجات منشورة متوفرة', 'Aucun produit publié disponible')}</p>}<ReviewSection supplierId={supplier._id || supplier.id} user={user} /></>}</main></>;
}
