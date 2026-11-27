import { labelFor } from './i18n/useLabels';
import { useState, useEffect, useCallback } from 'react';
import ProductCard from './components/products/ProductCard';
import RegisterPage from './components/auth/RegisterPage';
import LoginPage from './components/auth/LoginPage';
import RecoveryPage from './components/auth/RecoveryPage';
import SupplierPage from './components/suppliers/SupplierPage';
import StorePage from './components/suppliers/StorePage';
import ProductPage from './components/products/ProductPage';
import WholesalePage from './components/wholesale/WholesalePage';
import { Link, useRoute, navigate, pagePath, storePath, dashboardPath, loginPath, safeReturnTo } from './navigation';
import SupplierDashboard from './components/suppliers/SupplierDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import BuyerDashboard from './components/buyer/BuyerDashboard';
import SourcingModal from './components/products/SourcingModal';
import { WorkspaceHeader, Field, Notice } from './components/common/WorkspaceUI';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';
import { useLabels, formatMoney } from './i18n/useLabels';
import { apiRequest, clearSession } from './api/config';
import { getSessionToken, useSessionToken } from './api/session';
import MarketLayout, { MarketIcon } from './components/common/MarketLayout';
import { QuoteCartProvider } from './components/cart/QuoteCartContext';
import QuoteCartPage from './components/cart/QuoteCartPage';
import { FavoritesProvider } from './components/favorites/FavoritesContext';
import FavoritesPage from './components/favorites/FavoritesPage';
import './styles/atlas-public.css';
import './styles/private-pilot.css';
import { HomeIntroduction, HomeCategories } from './components/common/HomeIntroduction';
import './styles/atlas-home.css';
import { BusinessTypeFilter, DeclaredBusinessTypes } from './components/common/BusinessTypes';
import { TaxonomyBrowser } from './components/common/ProductTaxonomy';
function AppContent() {
  const {
      t,
      lang
    } = useTranslation(),
    l = useLabels();
  const sessionToken = useSessionToken();
  const route = useRoute(), page = route.page;
  const setPage = value => navigate(pagePath(value));
  const [account, setUser] = useState(null);
  const user = account?.sessionToken === sessionToken ? account.data : null;
  const sessionLoading = Boolean(sessionToken && account?.sessionToken !== sessionToken);
  const [query, setQuery] = useState(''),
    [term, setTerm] = useState('');
  const [filters, setFilters] = useState({
    city: '',
    category: '',
    categoryMode: '',
    taxonomyPath: '',
    quantity: '',
    minPrice: '',
    maxPrice: '',
    supplier: '',
    businessType: '',
    order: ''
  });
  const [number, setNumber] = useState(1),
    [pagination, setPagination] = useState({
      pages: 1,
      total: 0
    });
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [priceContext, setPriceContext] = useState({});
  const [products, setProducts] = useState([]),
    [stores, setStores] = useState([]),
    [storeLoading, setStoreLoading] = useState(false),
    [storeError, setStoreError] = useState(''),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(''),
    [image, setImage] = useState(null),
    [visual, setVisual] = useState(null);
  const [external, setExternal] = useState(null),
    [compare, setCompare] = useState([]);
  const [sourcing, setSourcing] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!sessionToken) {
      setUser(null);
      setCompare([]);
      setSourcing(false);
      return;
    }
    let active = true;
    apiRequest('/suppliers/me/profile').then(data => {
      if (active) setUser({
        data: { ...data, _id: data._id || data.id },
        sessionToken
      });
    }).catch(e => {
      if (e.status === 401 || e.status === 403) clearSession(sessionToken);
    });
    return () => {
      active = false;
    };
  }, [sessionToken]);
  useEffect(() => {
    const allowed = page === 'buyer' ? ['buyer'] : page === 'supplier' ? ['supplier', 'staff'] : null;
    if (!allowed) return;
    if (!sessionToken) navigate(loginPath(route.href), { replace: true });
    else if (user && !allowed.includes(user.role)) navigate(dashboardPath(user.role), { replace: true });
  }, [page, sessionToken, user, route.href]);
  const load = useCallback(async signal => {
    setLoading(true);
    setError('');
    setExternal(null);
    setVisual(null);
    const params = new URLSearchParams({
      q: term,
      page: String(number),
      limit: '12',
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))
    });
    try {
      let data;
      if (image) {
        const body = new FormData();
        body.append('image', image);
        Object.entries(filters).forEach(([k, v]) => {
          if (v !== '') body.append(k, v);
        });
        data = await apiRequest('/image-search?' + params.toString(), {
          method: 'POST',
          body,
          signal
        });
      } else if (term) data = await apiRequest('/ai-search?page=' + number + '&limit=12', {
        method: 'POST',
        body: {
          query: term,
          ...filters,
          page: number,
          limit: 12
        },
        signal
      });else data = await apiRequest('/products/search?' + params.toString(), {
        signal
      });
      if (signal?.aborted) return;
      if (image) setVisual(data.detectedProduct || (labelFor(lang, "بحث بالصورة", "Recherche visuelle")));
      if (!filters.businessType && !filters.taxonomyPath && filters.categoryMode !== 'exact' && data.externalDiscovery?.enabled) setExternal(data.externalDiscovery);
      const latestProducts = data.data || data.products || [];
      // Associate price labels with the successful response, not the next
      // filter value while its request is still pending.
      setPriceContext({
        quantity: filters.quantity === '' ? undefined : Number(filters.quantity),
        basePriceSearch: filters.minPrice !== '' || filters.maxPrice !== '' ||
          ['price_asc', 'price_desc'].includes(filters.order)
      });
      setProducts(latestProducts);
      setCompare(current => current.map(selected => latestProducts.find(p => p._id === selected._id) || selected));
      setPagination(data.pagination || {
        page: number,
        pages: Math.max(1, Math.ceil((data.total || 0) / 12)),
        total: data.total || 0
      });
    } catch (e) {
      if (!signal?.aborted && e.name !== 'AbortError') {
        setError(e.message);
        setProducts([]);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [term, filters, number, image, lang]);
  useEffect(() => {
    if (page !== 'home') return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refresh, page]);
  useEffect(() => {
    if (page !== 'stores') return;
    const c = new AbortController();
    setStoreLoading(true); setStoreError(''); setStores([]);
    const params = new URLSearchParams({ limit: '100' });
    if (filters.businessType) params.set('businessType', filters.businessType);
    apiRequest('/stores?' + params.toString(), { signal: c.signal }).then(d => {
      if (!c.signal.aborted) setStores(d.data || []);
    }).catch(e => {
      if (!c.signal.aborted && e.name !== 'AbortError') setStoreError(e.message);
    }).finally(() => { if (!c.signal.aborted) setStoreLoading(false); });
    return () => c.abort();
  }, [page, filters.businessType, refresh]);
  function selectBusinessType(businessType) {
    if (businessType === filters.businessType) return;
    setProducts([]); setStores([]); setExternal(null); setVisual(null); setError(''); setStoreError('');
    setLoading(page === 'home'); setStoreLoading(page === 'stores');
    setFilters(current => ({ ...current, businessType })); setNumber(1);
  }
  async function logout() {
    const token = getSessionToken();
    clearSession(token);
    setUser(null);
    if (['buyer', 'supplier', 'admin'].includes(page)) navigate('/', { replace: true });
    setCompare([]);
    setSourcing(false);
    setRefresh(n => n + 1);
    try {
      await apiRequest('/suppliers/logout', {
        method: 'POST',
        token
      });
    } catch {}
  }
  function authenticated(account, options = {}) {
    setUser({ data: account, sessionToken: getSessionToken() });
    navigate(safeReturnTo(route.search, account.role) || (options.browse ? '/' : dashboardPath(account.role)), { replace: true });
  }
  function dashboard() {
    setPage(user?.role === 'buyer' ? 'buyer' : user?.role === 'admin' ? 'admin' : 'supplier');
  }
  const back = () => {
    setPage('home');
    setRefresh(n => n + 1);
  };
  const requireLogin = returnTo => navigate(loginPath(returnTo));
  const registerAs = role => {
    const params = new URLSearchParams(route.search);
    params.set('role', role);
    navigate('/register?' + params.toString());
  };
  function toggleCompare(product) {
    setCompare(current => current.some(p => p._id === product._id) ? current.filter(p => p._id !== product._id) : current.length < 4 ? [...current, product] : current);
  }
  function comparisonPrice(product) {
    const quantity = Number(filters.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return product.price;
    const tier = product.priceTiers?.find(t => t.minQty <= quantity && (t.maxQty == null || t.maxQty >= quantity));
    return tier?.price ?? product.price;
  }
  function searchMarket(event) {
    event.preventDefault(); setImage(null); setTerm(query); setNumber(1); setRefresh(x => x + 1); setPage('home');
  }
  useEffect(() => {
    if (page === 'home' && (term || image)) document.getElementById('market-main')?.scrollIntoView?.({ block: 'start' });
  }, [page, term, image]);
  const imageControl = <label className="atlas-image-search" title={l('بحث بالصورة', 'Recherche par image')}><MarketIcon name="camera" /><span className="atlas-sr">{l('بحث بالصورة', 'Recherche par image')}</span>
    <input type="file" aria-label={l('صورة البحث', 'Image de recherche')} accept="image/jpeg,image/png,image/webp" onChange={event => {
      const file = event.target.files?.[0]; if (file) { setImage(file); setNumber(1); setPage('home'); } event.target.value = '';
    }} /></label>;
  const publicPage = content => <FavoritesProvider token={sessionToken} user={user}><MarketLayout page={page} user={user} query={query} onQueryChange={setQuery} onSearch={searchMarket} loading={loading}
    onAccount={dashboard} onLogout={logout} onLogin={() => requireLogin(route.href)} onRegister={() => registerAs('supplier')}
    onSourcing={() => { setPage('home'); user ? setSourcing(true) : requireLogin(); }} imageControl={imageControl}>
    {content}
  </MarketLayout></FavoritesProvider>;
  if (page === 'login') return <LoginPage onLogin={authenticated} onBack={back} onForgotPassword={() => navigate('/forgot-password')} onCreateAccount={() => registerAs('buyer')} onBecomeSupplier={() => registerAs('supplier')} />;
  if (page === 'forgotPassword' || page === 'resetPassword') return <RecoveryPage key={page} reset={page === 'resetPassword'} onBack={back} onLogin={() => navigate('/login')} onRequest={() => navigate('/forgot-password')} />;
  if (page === 'register') return <RegisterPage key={route.search} initialRole={new URLSearchParams(route.search).get('role') || 'buyer'} onRegister={authenticated} onBack={back} onGoLogin={() => navigate('/login' + route.search)} />;
  if (['buyer', 'supplier'].includes(page) && (!user || (page === 'buyer' ? user.role !== 'buyer' : !['supplier', 'staff'].includes(user.role)))) return <><WorkspaceHeader title="Jomla.ma" onBack={back} /><main className="container"><p role="status">{l('جاري التحقق من الجلسة…', 'Vérification de la session…')}</p></main></>;
  if (page === 'admin') return <AdminDashboard key={sessionToken} user={user} onBack={back} onLogout={logout} onLogin={authenticated} />;
  if (page === 'supplier' && user && ['supplier', 'staff'].includes(user.role)) return <SupplierDashboard key={sessionToken} supplier={user} onBack={back} onLogout={logout} onGoAdmin={() => setPage('admin')} />;
  if (page === 'buyer' && user?.role === 'buyer') return <BuyerDashboard key={sessionToken} user={user} onBack={back} onLogout={logout} />;
  if (page === 'product') return publicPage(<ProductPage key={route.id} id={route.id} search={route.search} user={user} sessionLoading={sessionLoading} onBack={back} onRequireLogin={requireLogin} onRfqCreated={() => navigate('/buyer')} />);
  if (page === 'favorites') return publicPage(<FavoritesPage key={sessionToken || 'guest'} user={user} token={sessionToken} onRequireLogin={requireLogin} onRfqCreated={() => navigate('/buyer')} />);
  if (page === 'cart') return publicPage(<QuoteCartPage key={sessionToken || 'guest'} user={user} sessionLoading={sessionLoading} onRequireLogin={requireLogin} />);
  if (['opportunities','opportunity'].includes(page)) return publicPage(<WholesalePage key={route.id || 'list'} id={route.id} search={route.search} user={user} sessionLoading={sessionLoading} onRequireLogin={requireLogin} onRfqCreated={() => navigate('/buyer')} />);
  if (page === 'store') return publicPage(<StorePage key={route.id} id={route.id} search={route.search} user={user} onBack={back} onRequireLogin={requireLogin} onRfqCreated={() => navigate('/buyer')} />);
  if (page === 'supplierPublic') return <SupplierPage key={route.id} supplierId={route.id} user={user} onBack={back} onRequireLogin={requireLogin} />;
  if (page === 'notFound') return publicPage(<main className="container panel" id="market-main" tabIndex="-1"><h1>{l('الرابط غير موجود', 'Page introuvable')}</h1><p>{l('تحقق من الرابط أو عد إلى السوق.', 'Vérifiez le lien ou revenez au catalogue.')}</p><Link to="/">{l('العودة للسوق', 'Retour au catalogue')}</Link></main>);
  return publicPage(<>
    {page === 'home' && !term && !image && !Object.values(filters).some(Boolean) && number === 1 && <HomeIntroduction user={user}
      onSupplier={() => user ? dashboard() : registerAs('supplier')}
      onSourcing={() => user ? setSourcing(true) : requireLogin()} />}
    <main className="container" id="market-main" tabIndex="-1"><Notice error>{page === 'stores' ? storeError : error}</Notice>
      <BusinessTypeFilter selected={filters.businessType} onSelect={selectBusinessType} />
      {page === 'stores' ? <section className="panel"><h2>{l('المتاجر المعتمدة', 'Boutiques approuvées')}</h2>
      {storeLoading ? <p role="status">{l('جاري تحميل المتاجر…', 'Chargement des boutiques…', 'Loading stores…')}</p> : storeError ? <button onClick={() => setRefresh(n => n + 1)}>{l('إعادة المحاولة', 'Réessayer', 'Retry')}</button> :
      <><div className="product-grid">{stores.map(s => <article className="panel" key={s._id}><h3>{s.name}</h3><p>{s.city}</p><p>{s.description}</p><DeclaredBusinessTypes values={s.supplierId?.businessTypes}/><Link to={storePath(s._id)}>{l('فتح المتجر', 'Voir la boutique')}</Link></article>)}</div>
      {!stores.length && <p>{filters.businessType ? l('لا توجد متاجر مطابقة لهذا النشاط حالياً.', 'Aucune boutique pour cette activité actuellement.', 'No stores for this activity currently.') : l('لا توجد متاجر معتمدة بعد', 'Aucune boutique approuvée pour le moment')}</p>}</>}</section> : <>
      <TaxonomyBrowser value={filters.taxonomyPath} onChange={taxonomyPath => {
        if (taxonomyPath === filters.taxonomyPath) return;
        setProducts([]); setExternal(null); setVisual(null); setLoading(true); setNumber(1);
        setFilters(current => ({ ...current, taxonomyPath, category: '', categoryMode: '' }));
      }} />
      <HomeCategories key={JSON.stringify([filters.businessType, filters.taxonomyPath, categoryRevision])} businessType={filters.businessType} taxonomyPath={filters.taxonomyPath} selected={filters.category} exact={filters.categoryMode === 'exact'}
        onSelect={category => {
          const categoryMode = category ? 'exact' : '';
          if (category === filters.category && categoryMode === filters.categoryMode) return;
          setProducts([]); setExternal(null); setLoading(true);
          setFilters(current => ({ ...current, category, categoryMode })); setNumber(1);
        }} />
      <section className="panel atlas-filters" aria-label={l('فلاتر البحث', 'Filtres de recherche')}><div className="atlas-section-heading"><h2>{l('اكتشف ما يناسب تجارتك', 'Trouvez ce qui vous convient')}</h2></div><details className="atlas-filter-disclosure"><summary><MarketIcon name="filter" />{l('تصفية النتائج', 'Filtrer les résultats')}<span>{Object.entries(filters).filter(([key, value]) => key !== 'categoryMode' && value !== '').length || ''}</span></summary><div className="filters">
        {[['city', l('المدينة', 'Ville'), 'text'], ['category', l('الفئة', 'Catégorie'), 'text'], ['quantity', l('الكمية المطلوبة', 'Quantité souhaitée'), 'number'], ['minPrice', l('أقل سعر', 'Prix minimum'), 'number'], ['maxPrice', l('أعلى سعر', 'Prix maximum'), 'number'], ['supplier', l('اسم المورد', 'Nom du fournisseur'), 'text']].map(([key, label, type]) => <Field key={key} label={label} type={type} min={type === 'number' ? 0 : undefined} value={filters[key]} onChange={e => {
              setFilters({
                ...filters,
                [key]: e.target.value,
                ...(key === 'category' ? { categoryMode: '' } : {})
              });
              setNumber(1);
            }} />)}
        <Field label={l('الترتيب', 'Trier')}><select value={filters.order} onChange={e => {
                setFilters({
                  ...filters,
                  order: e.target.value
                });
                setNumber(1);
              }}><option value="">{l('الأقرب للبحث', 'Pertinence')}</option><option value="price_asc">{l('السعر تصاعدياً', 'Prix croissant')}</option><option value="price_desc">{l('السعر تنازلياً', 'Prix décroissant')}</option></select></Field>
      </div></details></section>
      <div className="atlas-catalog-tools">{(term || image || Object.values(filters).some(Boolean)) && <button className="atlas-clear-filters" onClick={() => { setProducts([]); setExternal(null); setLoading(true); setQuery(''); setTerm(''); setImage(null); setFilters(current => Object.fromEntries(Object.keys(current).map(key => [key, '']))); setNumber(1); setCategoryRevision(n => n + 1); }}>{l('إعادة ضبط البحث', 'Réinitialiser la recherche')}</button>}</div>
      {visual && <Notice>{l('الصورة نفسها تعني تطابق الملف فقط. النتائج المشابهة تحتاج مراجعة هوية المنتج ومواصفاته.', 'Même image signifie uniquement le même fichier. Vérifiez l’identité et les caractéristiques des résultats similaires.')}</Notice>}
      {loading ? <p role="status">{l('جاري تحميل النتائج…', 'Chargement…')}</p> : <><p className="muted">{pagination.total} {l('نتيجة', 'résultat(s)')}</p><div className="product-grid">{products.map(p => <ProductCard key={p._id} product={p} priceContext={priceContext} user={user} onRfqCreated={() => setPage('buyer')} onRequireLogin={requireLogin} onCompare={toggleCompare} compared={compare.some(c => c._id === p._id)} />)}</div></>}
      {!loading && !products.length && !error && <section className="panel empty"><h2>{t('product_not_found')}</h2><p>{t('product_not_found_desc')}</p><button className="primary" onClick={() => user ? setSourcing(true) : requireLogin()}>{t('submit_sourcing_btn')}</button></section>}
      <div className="pager"><button disabled={number <= 1 || loading} onClick={() => setNumber(n => n - 1)}>{l('السابق', 'Précédent')}</button><span>{number} / {Math.max(1, pagination.pages || 1)}</span><button disabled={number >= (pagination.pages || 1) || loading} onClick={() => setNumber(n => n + 1)}>{l('التالي', 'Suivant')}</button></div>
      {compare.length > 0 && <section className="panel"><div className="actions"><h2>{l('مقارنة المنتجات', 'Comparer les produits')} ({compare.length}/4)</h2><button onClick={() => setCompare([])}>{l('مسح', 'Effacer')}</button></div><div className="table-wrap"><table><thead><tr><th>{l('المنتج', 'Produit')}</th><th>{l('السعر', 'Prix')}</th><th>MOQ</th><th>{l('المدينة', 'Ville')}</th><th>{l('المورد', 'Fournisseur')}</th></tr></thead><tbody>{compare.map(p => <tr key={p._id}><td>{p.name}</td><td>{Number(filters.quantity) > 0 && Number(filters.quantity) < p.moq ? l('أقل من الحد الأدنى', 'Quantité inférieure au minimum') : p.pricingMode === 'on_request' ? l('عند الطلب', 'Sur demande') : formatMoney(comparisonPrice(p), p.currency, lang)}</td><td>{p.moq} {p.unit}</td><td>{p.city}</td><td>{p.supplierId?.name}</td></tr>)}</tbody></table></div></section>}
      {external?.enabled && <section className="panel"><span className="badge amber">{t('external_notice_badge')}</span><h2>{l('نتائج اكتشاف خارجية تجريبية', 'Découvertes externes expérimentales')}</h2><p>{t('external_notice_desc')}</p>{external.results?.map(result => <article className="panel" key={result.url}><h3><a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a></h3><p>{result.description}</p><p className="muted">{result.sourceName} · {l('خارجي — غير موثق', 'Externe — non vérifié')}</p></article>)}</section>}
      </>}
    </main>
    {sourcing && <SourcingModal sessionToken={sessionToken} user={user} onSuccess={() => {
      setSourcing(false);
      setPage('buyer');
    }} initialData={{
      productName: visual || term || query
    }} onClose={() => setSourcing(false)} onRequireLogin={requireLogin} />}
  </>);
}
export default function App() {
  return <LanguageProvider><QuoteCartProvider>{process.env.REACT_APP_PRIVATE_PILOT === '1' && <PrivatePilotNotice />}<AppContent /></QuoteCartProvider></LanguageProvider>;
}
function PrivatePilotNotice() {
  const l = useLabels();
  return <aside className="private-pilot-notice" aria-label={l('تجربة خاصة', 'Essai privé')}>
    <strong>{l('نسخة تجريبية خاصة', 'Version de test privée')}</strong>
    <span>{l('بيانات اختبار فقط. لا شراء أو بيع حقيقي. لا تدخل معلومات شخصية أو وثائق حساسة.', 'Données fictives uniquement. Aucun achat ni vente réels. Ne saisissez pas de données personnelles ni de documents sensibles.')}</span>
  </aside>;
}
