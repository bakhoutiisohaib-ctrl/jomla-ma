import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken } from '../../api/session';
import { Link } from '../../navigation';
import { useLabels } from '../../i18n/useLabels';
import { useFavorites } from './FavoritesContext';
import ProductCard from '../products/ProductCard';

const PAGE_SIZE = 12;
export default function FavoritesPage({ user, token, onRequireLogin, onRfqCreated }) {
  const l = useLabels(), favorites = useFavorites();
  const [page, setPage] = useState(1), [result, setResult] = useState(null), [retry, setRetry] = useState(0);
  const ids = favorites?.ids;
  const pages = Math.max(1, Math.ceil((ids?.length || 0) / PAGE_SIZE));
  const current = Math.min(page, pages);
  const selection = ids ? ids.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).join(',') : null;
  useEffect(() => {
    if (!token || selection == null || favorites?.mode !== 'buyer') { setResult(null); return; }
    let active = true, controller;
    async function load() {
      controller?.abort();
      const request = new AbortController(); controller = request;
      setResult(null);
      if (document.visibilityState === 'hidden') return;
      const rows = await Promise.all((selection ? selection.split(',') : []).map(async id => {
        try {
          const data = await apiRequest('/products/' + id, { token: '', cache: 'no-store', signal: request.signal });
          if (data?.product?._id !== id) throw new Error('Invalid product response');
          return { id, product: data.product };
        } catch (error) { return { id, missing: error.status === 404 }; }
      }));
      if (active && !request.signal.aborted && token === getSessionToken()) setResult({ selection, rows });
    }
    load();
    const timer = setInterval(load, 30000);
    document.addEventListener('visibilitychange', load);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [selection, token, retry, favorites?.mode]);
  const rows = result?.selection === selection && selection !== null ? result.rows : null;
  return <main className="container atlas-favorites-page" id="market-main" tabIndex="-1">
    <nav className="atlas-breadcrumbs"><Link to="/">{l('السوق', 'Catalogue')}</Link><span>/</span><span>{l('المفضلة', 'Favoris', 'Favorites')}</span></nav>
    <h1>{l('منتجاتي المفضلة', 'Mes produits favoris', 'My favorite products')}</h1>
    {favorites?.mode === 'guest' ? <section className="panel"><p>{l('سجل الدخول كمشتري لحفظ منتجاتك.', 'Connectez-vous comme acheteur pour enregistrer vos produits.', 'Sign in as a buyer to save products.')}</p><button onClick={() => onRequireLogin('/favorites')}>{l('دخول المشتري', 'Connexion acheteur')}</button></section>
      : favorites?.mode === 'other' ? <p>{l('المفضلة متاحة لحساب المشتري فقط.', 'Les favoris sont réservés aux acheteurs.', 'Favorites are available to buyers only.')}</p>
      : favorites?.status === 'error' ? <section className="panel"><p role="status">{l('تعذر تأكيد المفضلة حالياً.', 'Impossible de confirmer vos favoris.', 'Favorites could not be confirmed.')}</p><button onClick={favorites.refresh}>{l('إعادة المحاولة', 'Réessayer', 'Retry')}</button></section>
      : !ids ? <p role="status">{l('جاري تحميل المفضلة…', 'Chargement des favoris…', 'Loading favorites…')}</p>
      : !ids.length ? <section className="panel"><p>{l('لم تحفظ أي منتج بعد.', 'Vous n’avez pas encore de favoris.', 'No saved products yet.')}</p><Link to="/">{l('اكتشف المنتجات', 'Explorer les produits')}</Link></section>
      : <>
        <p>{ids.length} / 100 {l('منتج', 'produits', 'products')}</p>
        <button onClick={() => { favorites.refresh(); setRetry(n => n + 1); }} disabled={favorites.busy}>{l('تحديث المفضلة', 'Actualiser les favoris', 'Refresh favorites')}</button>
        {!rows ? <p role="status">{l('جاري التحقق من المنتجات…', 'Vérification des produits…', 'Checking products…')}</p> :
          <div className="product-grid">{rows.map(row => row.product ?
            <ProductCard key={row.id} product={row.product} user={user} onRequireLogin={onRequireLogin} onRfqCreated={onRfqCreated} /> :
            <article className="panel atlas-favorite-unavailable" key={row.id}><h3>{l('تعذر عرض هذا المنتج', 'Produit non affichable', 'Product not displayable')}</h3>
              <p>{row.missing ? l('لم يعد متاحاً في الكتالوج.', 'Il n’est plus disponible dans le catalogue.') : l('تعذر الاتصال. حاول مجدداً.', 'Connexion impossible. Réessayez.', 'Unable to connect. Try again.')}</p>
              <button disabled={favorites.busy} onClick={() => favorites.toggle(row.id)}>{l('إزالة من المفضلة', 'Retirer des favoris', 'Remove from favorites')}</button>
            </article>)}</div>}
        <nav className="pager" aria-label={l('صفحات المفضلة', 'Pages des favoris', 'Favorites pages')}><button disabled={current <= 1} onClick={() => setPage(current - 1)}>{l('السابق', 'Précédent')}</button><span>{current} / {pages}</span><button disabled={current >= pages} onClick={() => setPage(current + 1)}>{l('التالي', 'Suivant')}</button></nav>
      </>}
  </main>;
}
