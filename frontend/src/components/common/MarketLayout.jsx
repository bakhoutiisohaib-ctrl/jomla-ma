import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useEffect, useState } from 'react';
import { Link, navigate } from '../../navigation';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { useQuoteCart } from '../cart/QuoteCartContext';
import { useFavorites } from '../favorites/FavoritesContext';
import '../../styles/atlas-favorites.css';
import '../../styles/atlas-cart.css';
import '../../styles/atlas-mobile-nav.css';

export function MarketIcon({ name, ...props }) {
  const paths = { search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    camera: 'M3 7h4l2-3h6l2 3h4v14H3zM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    store: 'M3 10h18L19 3H5zM5 10v11h14V10M9 21v-7h6v7',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.9 8.9 8.8-8.9a5.5 5.5 0 0 0 0-7.8', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    package: 'm3 7 9-5 9 5v10l-9 5-9-5zm0 0 9 5 9-5M12 12v10M8 4l9 5v5',
    message: 'M4 3h16v14H9l-5 4zM8 7h8M8 11h6',
    arrow: 'M5 12h14m-6-6 6 6-6 6', filter: 'M4 6h16M7 12h10M10 18h4' };
  return <svg {...props} className="atlas-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.grid} /></svg>;
}

export function NotificationBell({ user, onAccount }) {
  const token = useSessionToken(), l = useLabels();
  const owner = token && user ? token + ':' + (user._id || user.id) : '';
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!owner) return;
    let active = true, generation = 0, controller;
    async function load() {
      const request = ++generation;
      controller?.abort();
      if (document.visibilityState === 'hidden') return;
      controller = new AbortController();
      try {
        const data = await apiRequest('/notifications', { token, signal: controller.signal, cache: 'no-store' });
        if (active && request === generation && token === getSessionToken()) setResult({ owner,
          count: Number.isSafeInteger(data.unreadCount) && data.unreadCount >= 0 ? data.unreadCount : null });
      } catch (error) {
        if (active && request === generation && error.name !== 'AbortError') setResult({ owner, count: null });
      }
    }
    load();
    const timer = setInterval(load, 30000);
    document.addEventListener('visibilitychange', load); window.addEventListener('focus', load);
    return () => { active = false; generation++; controller?.abort(); clearInterval(timer);
      document.removeEventListener('visibilitychange', load); window.removeEventListener('focus', load); };
  }, [owner, token]);
  if (!owner) return null;
  const count = result?.owner === owner ? result.count : null;
  const description = count == null ? l('تعذر تأكيد العدد حالياً', 'Nombre non confirmé actuellement') : count === 0
    ? l('لا توجد إشعارات جديدة', 'Aucune nouvelle notification') : l(count + ' غير مقروءة', count + ' non lue(s)', count + ' unread');
  return <details className="atlas-notifications" key={owner}>
    <summary aria-label={l('الإشعارات', 'Notifications') + ': ' + description}><MarketIcon name="bell" />
      {count > 0 && <span className="atlas-unread" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </summary>
    <div className="atlas-notification-panel"><strong>{l('الإشعارات', 'Notifications')}</strong><p>{description}</p>
      <p>{l('افتح قسم الإشعارات في مساحتك لقراءتها وإدارتها.', 'Ouvrez la rubrique Notifications dans votre espace pour les lire et les gérer.')}</p>
      <button type="button" onClick={onAccount}>{l('فتح مساحة الحساب', 'Ouvrir l’espace du compte')}</button>
    </div>
  </details>;
}

export default function MarketLayout({ children, page, user, query = '', onQueryChange, onSearch, loading,
  onAccount, onLogout, onLogin, onRegister, onSourcing, imageControl }) {
  const l = useLabels(), cart = useQuoteCart(), favorites = useFavorites();
  return <div className="atlas-public" data-page={page}>
    <a className="atlas-skip" href="#market-main">{l('تجاوز إلى المحتوى', 'Aller au contenu')}</a>
    <header className="atlas-header"><div className="atlas-header-inner">
      <Link to="/" className="atlas-brand" aria-label="Jomla.ma"><span className="atlas-brand-mark">ج</span><strong dir="ltr">jomla<span>.</span><small>ma</small></strong></Link>
      <form className="atlas-search" onSubmit={onSearch} role="search"><MarketIcon name="search" />
        <label className="atlas-sr" htmlFor="market-query">{l('البحث في الكتالوج', 'Rechercher dans le catalogue')}</label>
        <input id="market-query" placeholder={l('ما الذي تبحث عنه بالجملة؟', 'Que cherchez-vous en gros ?')} value={query} onChange={event => onQueryChange?.(event.target.value)} />
        {imageControl}<button className="primary" disabled={loading}>{l('ابحث', 'Rechercher')}</button>
      </form>
      <nav className="atlas-account" aria-label={l('الحساب واللغة', 'Compte et langue')}>
        {cart && <Link to="/cart" className="atlas-cart-link" aria-label={l('سلة طلبات العروض', 'Sélection de devis') + ' (' + cart.items.length + ')'}><MarketIcon name="package" /><span className="atlas-cart-label">{l('سلة العروض', 'Sélection')}</span><span className="atlas-cart-count">{cart.items.length}</span></Link>}
        <LanguageSwitch />
        {user ? <><NotificationBell user={user} onAccount={onAccount} /><button onClick={onAccount}><MarketIcon name="user" />{l('مساحتي', 'Mon espace')}</button><button onClick={onLogout}>{l('خروج', 'Déconnexion')}</button></> : <>
          <button onClick={onLogin}><MarketIcon name="user" />{l('تسجيل الدخول', 'Connexion')}</button><button className="atlas-register" onClick={onRegister}>{l('سجل كمورد', 'Devenir Fournisseur')}</button></>}
      </nav>
    </div><nav className="atlas-nav" aria-label={l('التنقل العام', 'Navigation du marché')}>
      <Link to="/" aria-current={page === 'home' ? 'page' : undefined}><MarketIcon name="grid" />{l('كل المنتجات', 'Tous les produits')}</Link>
      <Link to="/opportunities" aria-current={['opportunities','opportunity'].includes(page) ? 'page' : undefined}><MarketIcon name="package" />{l('فرص الجملة', 'Opportunités de gros')}</Link>
      <Link to="/stores" aria-current={['stores', 'store'].includes(page) ? 'page' : undefined}><MarketIcon name="store" />{l('المتاجر', 'Boutiques')}</Link><button onClick={onSourcing}><MarketIcon name="message" />{l('طلب توريد خاص', 'Demande de sourcing')}</button>
      <Link to="/favorites" aria-current={page === 'favorites' ? 'page' : undefined}><MarketIcon name="heart" />{l('المفضلة', 'Favoris', 'Favorites')}</Link><span>{l('سوق الجملة المغربي', 'Le marché de gros marocain')}</span>
    </nav></header>
    {favorites?.message && <div className="container atlas-favorite-notice" role="status"><p>{favorites.message === 'limit' ? l('بلغت الحد الأقصى للمفضلة. أزل منتجاً قبل إضافة آخر.', 'Limite des favoris atteinte.', 'Favorites limit reached.') : l('تعذر تأكيد الحفظ. أعد تحميل المفضلة للتحقق.', 'Enregistrement non confirmé. Rechargez vos favoris.', 'Save not confirmed. Reload favorites to verify.')}</p><button onClick={() => { favorites.dismiss(); favorites.refresh(); }}>{l('إعادة التحميل', 'Recharger', 'Reload')}</button></div>}
    {children}
    <footer className="atlas-footer"><Link to="/" className="atlas-brand"><strong dir="ltr">jomla<span>.</span><small>ma</small></strong></Link>
      <p>{l('منتجات جملة وكميات واضحة وعروض أسعار داخل المنصة.', 'Produits de gros, quantités claires et devis sur la plateforme.')}</p>
      <button onClick={() => navigate('/admin')}>{l('الإشراف', 'Modération')}</button>
    </footer>
    <nav className="atlas-mobile-nav" aria-label={l('تنقل الهاتف', 'Navigation mobile', 'Mobile navigation')}>
      <Link to="/" aria-current={page === 'home' ? 'page' : undefined}><MarketIcon name="grid" /><span>{l('السوق', 'Catalogue')}</span></Link>
      <Link to="/stores" aria-current={['stores', 'store'].includes(page) ? 'page' : undefined}><MarketIcon name="store" /><span>{l('المتاجر', 'Boutiques')}</span></Link>
      <Link to="/cart" aria-current={page === 'cart' ? 'page' : undefined}><MarketIcon name="package" /><span>{l('سلة العروض', 'Sélection')}</span>{Boolean(cart?.items.length) && <span className="atlas-mobile-count">{cart.items.length}</span>}</Link>
      <Link to="/favorites" aria-current={page === 'favorites' ? 'page' : undefined}><MarketIcon name="heart" /><span>{l('المفضلة', 'Favoris', 'Favorites')}</span></Link>
      <button type="button" onClick={user ? onAccount : onLogin}><MarketIcon name="user" /><span>{l('حسابي', 'Mon compte', 'My account')}</span></button>
    </nav>
  </div>;
}
