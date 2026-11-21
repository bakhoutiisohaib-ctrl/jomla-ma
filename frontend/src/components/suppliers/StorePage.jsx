import { useEffect, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';
import { Link, navigate, storePath } from '../../navigation';
import { Field, Notice } from '../common/WorkspaceUI';
import { usePublicMeta, usePublicResource } from '../common/usePublicPage';
import ShareLink from '../common/ShareLink';
import ProtectedImage from '../common/ProtectedImage';
import ProductCard from '../products/ProductCard';
import ReviewSection from '../reviews/ReviewSection';

export default function StorePage({ id, search, user, onBack, onRequireLogin, onRfqCreated }) {
  const l = useLabels(), params = new URLSearchParams(search);
  const q = params.get('q') || '', pageText = params.get('page') || '1';
  const page = /^\d+$/.test(pageText) && Number.isSafeInteger(Number(pageText)) && Number(pageText) > 0 ? Number(pageText) : 1;
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const query = new URLSearchParams({ q, page: String(page), limit: '12' });
  const { data, error, loading } = usePublicResource('/stores/' + id + '?' + query);
  const store = data?.store, supplier = store?.supplierId;
  usePublicMeta(store?.name, store?.description, store ? storePath(id) : '');
  const browse = (value, number) => navigate(storePath(id) + '?' + new URLSearchParams({ ...(value ? { q: value } : {}), page: String(number) }));
  return <><main className="container atlas-store-page" id="market-main" tabIndex="-1">
    {loading && <p role="status">{l('جاري تحميل المتجر…', 'Chargement de la boutique…')}</p>}
    {error && <section className="panel"><h1>{l('المتجر غير متاح', 'Boutique indisponible')}</h1><Notice error>{error.status === 404 ? l('هذا المتجر غير موجود أو غير متاح للعرض العام.', 'Cette boutique n’existe pas ou n’est pas disponible publiquement.') : error.message}</Notice><Link to="/">{l('العودة للسوق', 'Retour au catalogue')}</Link></section>}
    {store && <>
      <nav className="atlas-breadcrumbs" aria-label={l('مسار الصفحة', 'Fil d’Ariane')}><Link to="/">{l('السوق', 'Catalogue')}</Link><span>/</span><Link to="/stores">{l('المتاجر', 'Boutiques')}</Link></nav>
      <section className="panel atlas-store-cover"><ProtectedImage value={store.logoUrl} alt={l('شعار المتجر', 'Logo de la boutique')} className="store-logo" />
        <div><span className="atlas-eyebrow">{l('متجر على Jomla.ma', 'BOUTIQUE SUR JOMLA.MA')}</span><h1>{store.name}</h1><p>{store.description}</p><p>{store.city} {store.address && '· ' + store.address}</p></div>
      </section><div className="atlas-store-layout"><aside className="panel atlas-store-about"><h2>{l('عن المتجر', 'À propos de la boutique')}</h2>
        <p>{l('المورد', 'Fournisseur')}: {supplier.name}</p>{supplier.description && <p>{supplier.description}</p>}
        {(store.phone || supplier.phone) && <p>{l('الهاتف', 'Téléphone')}: {store.phone || supplier.phone}</p>}
        {supplier.isVerified && supplier.verificationStatus === 'verified' && <span className="badge green">{l('راجعته إدارة المنصة', 'Vérifié par la plateforme')}</span>}
        <ShareLink path={storePath(id)} />
      </aside><section className="atlas-store-products" aria-label={l('منتجات المتجر', 'Produits de la boutique')}>
      <form className="panel actions" onSubmit={event => { event.preventDefault(); browse(input, 1); }}>
        <Field label={l('البحث داخل المتجر', 'Rechercher dans la boutique')} value={input} maxLength={120} onChange={event => setInput(event.target.value)} />
        <button className="primary">{l('بحث', 'Chercher')}</button>
      </form>
      <p>{data.pagination?.total || 0} {l('منتج منشور', 'produit(s) publié(s)')}</p>
      <div className="product-grid">{data.products.map(product => <ProductCard key={product._id} product={product} user={user} onRequireLogin={onRequireLogin} onRfqCreated={onRfqCreated} />)}</div>
      {!data.products.length && <p className="panel">{l('لا توجد منتجات منشورة تطابق البحث.', 'Aucun produit publié ne correspond à la recherche.')}</p>}
      <nav className="pager" aria-label={l('صفحات منتجات المتجر', 'Pages des produits de la boutique')}>
        <button disabled={page <= 1} onClick={() => browse(q, page - 1)}>{l('السابق', 'Précédent')}</button><span>{page} / {Math.max(1, data.pagination?.pages || 1)}</span>
        <button disabled={!data.pagination?.hasNextPage} onClick={() => browse(q, page + 1)}>{l('التالي', 'Suivant')}</button>
      </nav>
      </section></div>
      <ReviewSection supplierId={supplier._id} />
    </>}
  </main></>;
}
