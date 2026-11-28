import { useEffect, useRef } from 'react';
import { usePublicResource } from '../common/usePublicPage';
import { useLabels } from '../../i18n/useLabels';
import { Link } from '../../navigation';
import ProductCard from './ProductCard';

const STEP = 4, WINDOW = 24;
const idOf = item => typeof item?._id === 'string' && /^[a-f\d]{24}$/i.test(item._id) ? item._id.toLowerCase() : null;
function candidates(result, current, excluded = []) {
  const seen = new Set([idOf(current), ...excluded.map(idOf)]);
  return (Array.isArray(result.data?.data) ? result.data.data : []).filter(item => {
    const id = idOf(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, WINDOW);
}

export default function RelatedProducts({ product, visible, setVisible, user, onRequireLogin, onRfqCreated }) {
  const l = useLabels();
  const moreRef = useRef(null);
  const path = typeof product.taxonomyPath === 'string' ? product.taxonomyPath : '';
  const category = typeof product.category === 'string' ? product.category : '';
  const scope = path ? { taxonomyPath: path } : category ? { category, categoryMode: 'exact' } : {};
  const same = usePublicResource('/products/search?' + new URLSearchParams({ ...scope, limit: String(WINDOW), order: 'newest' }));
  const recent = usePublicResource('/products/search?limit=' + WINDOW + '&order=newest');
  const relatedAll = candidates(same, product).filter(item => path
    ? item.taxonomyPath === path || (!path.includes('/') && item.taxonomyPath?.startsWith(path + '/'))
    : category && item.category === category);
  const discoveryAll = candidates(recent, product, relatedAll);
  const related = relatedAll.slice(0, visible), discoveries = discoveryAll.slice(0, visible);
  const more = relatedAll.length > visible || discoveryAll.length > visible;
  // Revalidation stays on the same two bounded public resources; no
  // accumulated snapshots of previous pages, including withdrawn products.
  useEffect(() => {
    if (!more || typeof IntersectionObserver !== 'function' || !moreRef.current) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active && entries.some(entry => entry.isIntersecting)) {
        active = false; observer.disconnect();
        setVisible(value => Math.min(WINDOW, value + STEP));
      }
    }, { rootMargin: '0px 0px 80px 0px' });
    observer.observe(moreRef.current);
    return () => { active = false; observer.disconnect(); };
  }, [more, visible, setVisible]);
  function cards(items) { return <div className="product-grid atlas-dense-product-grid">{items.map(item => <ProductCard key={idOf(item)} product={item} user={user} onRequireLogin={onRequireLogin} onRfqCreated={onRfqCreated} />)}</div>; }
  return <section id="product-discover" className="atlas-detail-discover" tabIndex="-1" aria-label={l('واصل استكشاف المنتجات', 'Continuez votre découverte', 'Keep exploring products')}>
    <header className="atlas-detail-section-heading"><div><p className="atlas-eyebrow">{l('واصل التصفح', 'CONTINUEZ À EXPLORER', 'KEEP EXPLORING')}</p><h2>{l('اختيارات أخرى لتجارتك', 'D’autres idées pour votre activité', 'More ideas for your business')}</h2></div><Link to="/">{l('كل المنتجات', 'Tout le catalogue', 'Full catalogue')}</Link></header>
    {!!related.length && <section aria-label={l('منتجات مشابهة', 'Produits similaires', 'Similar products')}><h3>{l('منتجات مشابهة', 'Produits similaires', 'Similar products')}</h3><p className="atlas-detail-muted">{l('منتجات منشورة من الفئة نفسها.', 'Des produits publiés dans la même catégorie.', 'Published products in the same category.')}</p>{cards(related)}</section>}
    {!!discoveries.length && <section aria-label={l('قد تهمك أيضاً', 'À découvrir aussi', 'Explore more')}><h3>{l('قد تهمك أيضاً', 'À découvrir aussi', 'Explore more')}</h3><p className="atlas-detail-muted">{l('من أحدث المنتجات المتاحة في الكتالوج.', 'Parmi les derniers produits disponibles au catalogue.', 'Recent available products in the catalogue.')}</p>{cards(discoveries)}</section>}
    {(same.loading || recent.loading) && <p role="status">{l('جاري تحميل المنتجات…', 'Chargement des produits…', 'Loading products…')}</p>}
    {(same.error || recent.error) && <div role="alert"><p>{l('بعض الاقتراحات غير متاحة حالياً.', 'Certaines suggestions sont actuellement indisponibles.', 'Some suggestions are currently unavailable.')}</p><button type="button" onClick={() => { same.refresh(); recent.refresh(); }}>{l('إعادة تحميل الاقتراحات', 'Recharger les suggestions', 'Reload suggestions')}</button></div>}
    {!related.length && !discoveries.length && !same.loading && !recent.loading && <p>{same.error || recent.error ? l('تعذر تحميل الاقتراحات حالياً. يمكنك متابعة الكتالوج.', 'Les suggestions sont indisponibles. Vous pouvez parcourir le catalogue.', 'Suggestions are unavailable. You can browse the catalogue.') : l('لا توجد اقتراحات أخرى متاحة حالياً.', 'Aucune autre suggestion disponible pour le moment.', 'No other suggestions currently available.')}</p>}
    {more && <div className="atlas-discover-more"><button type="button" ref={moreRef} onClick={() => setVisible(value => Math.min(WINDOW, value + STEP))}>{l('عرض المزيد من المنتجات', 'Voir plus de produits', 'Show more products')}</button></div>}
    {!more && !!(related.length + discoveries.length) && !same.loading && !recent.loading && <p className="atlas-discover-more"><Link to="/">{l('تابع التصفح في السوق', 'Continuer dans le catalogue', 'Continue in the catalogue')}</Link></p>}
  </section>;
}
