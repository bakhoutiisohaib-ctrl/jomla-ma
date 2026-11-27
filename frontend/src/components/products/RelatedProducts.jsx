import { useState } from 'react';
import { usePublicResource } from '../common/usePublicPage';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Link, productPath } from '../../navigation';
import ProductCard from './ProductCard';

export default function RelatedProducts({ product, user, onRequireLogin, onRfqCreated }) {
  const l = useLabels(), { lang } = useTranslation(), [comparedIds, setComparedIds] = useState([]);
  const same = usePublicResource('/products/search?' + new URLSearchParams({ category: product.category || '', limit: '8', order: 'newest' }));
  const recent = usePublicResource('/products/search?limit=8&order=newest');
  const candidates = result => Array.isArray(result.data?.data) ? result.data.data.filter(item => item._id !== product._id && /^[a-f\d]{24}$/i.test(item._id)) : [];
  const related = candidates(same).filter(item => item.category === product.category).slice(0, 4);
  const discoveries = candidates(recent).filter(item => !related.some(other => other._id === item._id)).slice(0, 4);
  // Compare only current, publicly revalidated results; never keep withdrawn card snapshots.
  const compared = [...related, ...discoveries].filter(item => comparedIds.includes(item._id));
  function toggle(item) { setComparedIds(ids => ids.includes(item._id) ? ids.filter(id => id !== item._id) : ids.length < 4 ? [...ids, item._id] : ids); }
  function cards(items) { return <div className="product-grid">{items.map(item => <ProductCard key={item._id} product={item} user={user} onRequireLogin={onRequireLogin} onRfqCreated={onRfqCreated} onCompare={toggle} compared={comparedIds.includes(item._id)} />)}</div>; }
  return <section id="product-discover" className="atlas-detail-discover" tabIndex="-1" aria-label={l('واصل استكشاف المنتجات', 'Continuez votre découverte')}>
    <header className="atlas-detail-section-heading"><div><p className="atlas-eyebrow">{l('واصل التصفح', 'CONTINUEZ À EXPLORER')}</p><h2>{l('اختيارات أخرى لتجارتك', 'D’autres idées pour votre activité')}</h2></div><Link to="/">{l('كل المنتجات', 'Tout le catalogue')}</Link></header>
    {!!related.length && <section aria-label={l('منتجات مشابهة', 'Produits similaires')}><h3>{l('منتجات مشابهة', 'Produits similaires')}</h3><p className="atlas-detail-muted">{l('منتجات منشورة من الفئة نفسها.', 'Des produits publiés dans la même catégorie.')}</p>{cards(related)}</section>}
    {!!discoveries.length && <section aria-label={l('قد تهمك أيضاً', 'À découvrir aussi')}><h3>{l('قد تهمك أيضاً', 'À découvrir aussi')}</h3><p className="atlas-detail-muted">{l('من أحدث المنتجات المتاحة في الكتالوج.', 'Parmi les derniers produits disponibles au catalogue.')}</p>{cards(discoveries)}</section>}
    {(same.loading || recent.loading) && <p role="status">{l('جاري تحميل المنتجات…', 'Chargement des produits…')}</p>}
    {(same.error || recent.error) && <div role="alert"><p>{l('بعض الاقتراحات غير متاحة حالياً.', 'Certaines suggestions sont actuellement indisponibles.')}</p><button type="button" onClick={() => { same.refresh(); recent.refresh(); }}>{l('إعادة تحميل الاقتراحات', 'Recharger les suggestions')}</button></div>}
    {!related.length && !discoveries.length && !same.loading && !recent.loading && <p>{same.error || recent.error ? l('تعذر تحميل الاقتراحات حالياً. يمكنك متابعة الكتالوج.', 'Les suggestions sont indisponibles. Vous pouvez parcourir le catalogue.') : l('لا توجد اقتراحات أخرى متاحة حالياً.', 'Aucune autre suggestion disponible pour le moment.')}</p>}
    {!!compared.length && <section className="atlas-detail-section"><h3>{l('مقارنة المنتجات', 'Comparer les produits')} ({compared.length}/4)</h3><div className="table-wrap"><table><thead><tr><th>{l('المنتج', 'Produit')}</th><th>{l('السعر', 'Prix')}</th><th>MOQ</th></tr></thead><tbody>{compared.map(item => <tr key={item._id}><td><Link to={productPath(item._id)}>{item.name}</Link></td><td>{item.pricingMode === 'on_request' ? l('عند الطلب', 'Sur demande') : formatMoney(item.price, item.currency, lang)}</td><td>{item.moq} {item.unit}</td></tr>)}</tbody></table></div></section>}
  </section>;
}
