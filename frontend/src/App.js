import { labelFor } from './i18n/useLabels';
import { useState, useEffect, useCallback, useMemo } from 'react';
import StructuredSearchSummary, { confirmStructuredSearch } from './components/common/StructuredSearchSummary';
import {VisualSearchControl,VisualSearchSummary,confirmVisualSearch} from './components/common/VisualSearchControl';
import ProductCard from './components/products/ProductCard';
import RegisterPage from './components/auth/RegisterPage';
import LoginPage from './components/auth/LoginPage';
import RecoveryPage from './components/auth/RecoveryPage';
import SupplierPage from './components/suppliers/SupplierPage';
import StorePage from './components/suppliers/StorePage';
import ProductPage from './components/products/ProductPage';
import WholesalePage from './components/wholesale/WholesalePage';
import { Link, useRoute, navigate, pagePath, storePath, dashboardPath, loginPath, safeReturnTo, authContinuationPath } from './navigation';
import SupplierDashboard from './components/suppliers/SupplierDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import BuyerDashboard from './components/buyer/BuyerDashboard';
import SourcingModal from './components/products/SourcingModal';
import { WorkspaceHeader, Field, Notice } from './components/common/WorkspaceUI';
import { LanguageProvider, useTranslation } from './i18n/LanguageContext';
import { useLabels } from './i18n/useLabels';
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
import SupplierTrustFilter from './components/common/SupplierTrustFilter';
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
    supplierTrust: '',
    order: ''
  });
  const [number, setNumber] = useState(1),
    [pagination, setPagination] = useState({
      pages: 1,
      total: 0
    });
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [priceContext, setPriceContext] = useState({});
  const [intentRemovals,setIntentRemovals]=useState([]),[structured,setStructured]=useState(null),[completedScope,setCompletedScope]=useState(null);
  const [products, setProducts] = useState([]),
    [stores, setStores] = useState([]),
    [storeLoading, setStoreLoading] = useState(false),
    [storeError, setStoreError] = useState(''),
    [storeNumber, setStoreNumber] = useState(1),
    [storePagination, setStorePagination] = useState(null),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(''),
    [image, setImage] = useState(null),
    [visual, setVisual] = useState(null);
  const [external, setExternal] = useState(null);
  const [sourcing, setSourcing] = useState(false),
    [refresh, setRefresh] = useState(0);
  const requestScope=useMemo(()=>({term,filters,number,image,lang,refresh,intentRemovals}),[term,filters,number,image,lang,refresh,intentRemovals]);
  const catalogLoading=loading||completedScope!==requestScope;
  useEffect(() => {
    if (!sessionToken) {
      setUser(null);
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
    setStructured(null);
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
        body.append('visualVersion','v49-1');
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
          intentVersion:'v49-1',intentRemovals,includeAlternatives:true,
          ...filters,
          page: number,
          limit: 12
        },
        signal
      });else data = await apiRequest('/products/search?' + params.toString(), {
        signal
      });
      if (signal?.aborted) return;
      const confirmedVisual=image?confirmVisualSearch(data,number):null;
      setVisual(confirmedVisual);
      const confirmed=!image&&term?confirmStructuredSearch(data,term,intentRemovals,number):null;
      setStructured(confirmed);
      if (!confirmed && !confirmedVisual && !filters.businessType && !filters.taxonomyPath && !filters.supplierTrust && filters.categoryMode !== 'exact' && data.externalDiscovery?.enabled) setExternal(data.externalDiscovery);
      const latestProducts = confirmedVisual?data.products:(data.data || data.products || []);
      // Associate price labels with the successful response, not the next
      // filter value while its request is still pending.
      setPriceContext({
        structured:Boolean(confirmed),moqPriceSearch:confirmed?.priceContext.basis==='moq',
        quantity: confirmed ? confirmed.priceContext.quantity ?? undefined : filters.quantity === '' ? undefined : Number(filters.quantity),
        basePriceSearch: filters.minPrice !== '' || filters.maxPrice !== '' ||
          ['price_asc', 'price_desc'].includes(filters.order)
      });
      setProducts(latestProducts);
      setPagination(data.pagination || {
        page: number,
        pages: Math.max(1, Math.ceil((data.total || 0) / 12)),
        total: data.total || 0
      });
    } catch (e) {
      if (!signal?.aborted && e.name !== 'AbortError') {
        setError(filters.supplierTrust==='rated'&&e.status===503?labelFor(lang,'تعذر حساب فلتر التقييمات حالياً. أعد المحاولة.','Calcul des notes indisponible. Réessayez.','Rating filter temporarily unavailable. Retry.'):e.data?.code==='VISUAL_INSUFFICIENT_DETAIL'?labelFor(lang,'الصورة فارغة أو تفاصيلها غير كافية. جرّب صورة واضحة للمنتج.','Image vide ou sans détails suffisants. Essayez une image claire.','Blank or insufficiently detailed image. Try a clear product photo.'):(e.message==='UNCONFIRMED_SEARCH'||e.message==='UNCONFIRMED_VISUAL')?labelFor(lang,'تعذر تأكيد نتائج البحث. أعد المحاولة.','Résultats non confirmés. Réessayez.','Search results could not be confirmed. Retry.'):e.message);
        setStructured(null);setPagination({pages:1,total:0});
        setProducts([]);
      }
    } finally {
      if (!signal?.aborted) {setCompletedScope(requestScope);setLoading(false);}
    }
  }, [term, filters, number, image, lang,intentRemovals,requestScope]);
  useEffect(() => {
    if (page !== 'home') return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, refresh, page]);
  useEffect(() => {
    if (page !== 'stores') return;
    const c = new AbortController();
    setStoreLoading(true); setStoreError(''); setStores([]); setStorePagination(null);
    const params = new URLSearchParams({ page: String(storeNumber), limit: '12' });
    if (filters.businessType) params.set('businessType', filters.businessType);
    if (filters.supplierTrust) params.set('supplierTrust', filters.supplierTrust);
    let correctingPage = false;
    apiRequest('/stores?' + params.toString(), { signal: c.signal }).then(d => {
      if (c.signal.aborted) return;
      const p = d.pagination;
      if (!Array.isArray(d.data) || !p || p.page !== storeNumber ||
          !Number.isSafeInteger(p.pages) || p.pages < 0 || !Number.isSafeInteger(p.total) || p.total < 0) {
        throw new Error(labelFor(lang,'تعذر قراءة دليل المتاجر.','Réponse de l’annuaire invalide.','Invalid store directory response.'));
      }
      const last = Math.max(1,p.pages);
      if (storeNumber > last) { correctingPage = true; setStoreNumber(last); return; }
      setStores(d.data); setStorePagination(p);
    }).catch(e => {
      if (!c.signal.aborted && e.name !== 'AbortError') setStoreError(filters.supplierTrust==='rated'&&e.status===503?labelFor(lang,'تعذر حساب فلتر التقييمات حالياً. أعد المحاولة.','Calcul des notes indisponible. Réessayez.','Rating filter temporarily unavailable. Retry.'):e.message);
    }).finally(() => { if (!c.signal.aborted && !correctingPage) setStoreLoading(false); });
    return () => c.abort();
  }, [page, filters.businessType, filters.supplierTrust, storeNumber, refresh, lang]);
  function browseStores(next) {
    document.getElementById('store-directory-heading')?.focus();
    setStoreLoading(true); setStores([]); setStorePagination(null); setStoreError('');
    setStoreNumber(next);
  }
  function selectBusinessType(businessType) {
    if (businessType === filters.businessType) return;
    setProducts([]); setStores([]); setExternal(null); setVisual(null); setError(''); setStoreError('');
    setLoading(page === 'home'); setStoreLoading(page === 'stores');
    setFilters(current => ({ ...current, businessType })); setNumber(1); setStoreNumber(1); setStorePagination(null);
  }
  function selectSupplierTrust(supplierTrust) {
    if (supplierTrust === filters.supplierTrust) return;
    setProducts([]); setStores([]); setExternal(null); setVisual(null); setError(''); setStoreError('');
    setLoading(page === 'home'); setStoreLoading(page === 'stores');
    setFilters(current => ({ ...current, supplierTrust })); setNumber(1); setStoreNumber(1); setStorePagination(null);
  }
  async function logout() {
    const token = getSessionToken();
    clearSession(token);
    setUser(null);
    if (['buyer', 'supplier', 'admin'].includes(page)) navigate('/', { replace: true });
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
    navigate(authContinuationPath('/register', route.search, role));
  };
  function searchMarket(event) {
    event.preventDefault(); setImage(null); setIntentRemovals([]);setTerm(query.trim()); setNumber(1); setRefresh(x => x + 1); setPage('home');
  }
  function clearSearch(){setProducts([]);setExternal(null);setStructured(null);setLoading(true);setQuery('');setTerm('');setImage(null);setIntentRemovals([]);setFilters(current=>Object.fromEntries(Object.keys(current).map(key=>[key,''])));setNumber(1);setStoreNumber(1);setCategoryRevision(n=>n+1);}
  function removeCondition(key){if(catalogLoading||!structured?.intent.removable.includes(key))return;setIntentRemovals(current=>current.includes(key)?current:[...current,key]);setNumber(1);}
  useEffect(() => {
    if (page === 'home' && (term || image)) document.getElementById('market-main')?.scrollIntoView?.({ block: 'start' });
  }, [page, term, image]);
  function selectImage(file){setQuery('');setTerm('');setIntentRemovals([]);setImage(file);setNumber(1);setRefresh(n=>n+1);setPage('home');}
  function clearImage(){setImage(null);setQuery('');setTerm('');setIntentRemovals([]);setNumber(1);}
  const imageControl=<VisualSearchControl key={page} onSelect={selectImage}/>;
  const publicPage = content => <FavoritesProvider token={sessionToken} user={user}><MarketLayout page={page} user={user} query={query} onQueryChange={setQuery} onSearch={searchMarket} loading={page==='home'&&catalogLoading}
    onAccount={dashboard} onLogout={logout} onLogin={() => requireLogin(route.href)} onRegister={() => registerAs('supplier')}
    onSourcing={() => { setPage('home'); user ? setSourcing(true) : requireLogin(); }} imageControl={imageControl}>
    {content}
  </MarketLayout></FavoritesProvider>;
  if (page === 'login') return <LoginPage key={route.search} onLogin={authenticated} onBack={back} onForgotPassword={() => navigate(authContinuationPath('/forgot-password', route.search))} onCreateAccount={() => registerAs('buyer')} onBecomeSupplier={() => registerAs('supplier')} />;
  if (page === 'forgotPassword' || page === 'resetPassword') return <RecoveryPage key={page + route.search} reset={page === 'resetPassword'} onBack={back} onLogin={() => navigate(authContinuationPath('/login', route.search))} onRequest={() => navigate(authContinuationPath('/forgot-password', route.search))} />;
  if (page === 'register') return <RegisterPage key={route.search} initialRole={new URLSearchParams(route.search).get('role') || 'buyer'} onRegister={authenticated} onBack={back} onGoLogin={() => navigate(authContinuationPath('/login', route.search))} />;
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
      {page === 'stores' && <SupplierTrustFilter value={filters.supplierTrust} onChange={selectSupplierTrust}/>}
      {page === 'stores' ? <section className="panel" aria-busy={storeLoading}><h2 id="store-directory-heading" tabIndex={-1}>{l('المتاجر المعتمدة', 'Boutiques approuvées','Approved stores')}</h2>
      {storeLoading ? <p role="status">{l('جاري تحميل المتاجر…', 'Chargement des boutiques…', 'Loading stores…')}</p> : storeError ? <button onClick={() => setRefresh(n => n + 1)}>{l('إعادة المحاولة', 'Réessayer', 'Retry')}</button> :
      <>{storePagination && <p className="muted" aria-live="polite">{storePagination.total} {l('متجر','boutique(s)','store(s)')}</p>}<div className="product-grid">{stores.map(s => <article className="panel" key={s._id}><h3>{s.name}</h3><p>{s.city}</p><p>{s.description}</p><DeclaredBusinessTypes values={s.supplierId?.businessTypes}/>{s.supplierId?.isVerified === true && s.supplierId?.verificationStatus === 'verified' && <p className="badge green">{l('مورد موثق','Fournisseur vérifié','Verified supplier')}</p>}<Link to={storePath(s._id)}>{l('فتح المتجر', 'Voir la boutique')}</Link></article>)}</div>
      {storePagination && storePagination.pages > 1 && <nav className="pager atlas-store-directory-pager" aria-label={l('صفحات دليل المتاجر','Pages de l’annuaire des boutiques','Store directory pages')}>
        <button type="button" disabled={storeNumber<=1} onClick={()=>browseStores(storeNumber-1)}>{l('السابق','Précédent','Previous')}</button>
        <span aria-live="polite">{storeNumber} / {storePagination.pages}</span>
        <button type="button" disabled={storeNumber>=storePagination.pages} onClick={()=>browseStores(storeNumber+1)}>{l('التالي','Suivant','Next')}</button>
      </nav>}
      {!stores.length && <p>{filters.supplierTrust === 'verified' ? l('لا توجد متاجر لموردين موثقين تطابق هذا الاختيار حالياً.','Aucune boutique de fournisseur vérifié ne correspond à cette sélection actuellement.','No verified supplier stores match this selection currently.') : filters.supplierTrust==='rated' ? l('لا توجد متاجر تطابق معيار التقييم حالياً.','Aucune boutique ne correspond au seuil de notation.','No stores meet the rating threshold.') : filters.supplierTrust==='declared_ma' ? l('لا توجد متاجر تطابق تصريح المغرب حالياً.','Aucune boutique ne correspond à cette déclaration de pays.','No stores match the declared Morocco filter.') : filters.businessType ? l('لا توجد متاجر مطابقة لهذا النشاط حالياً.', 'Aucune boutique pour cette activité actuellement.', 'No stores for this activity currently.') : l('لا توجد متاجر معتمدة بعد', 'Aucune boutique approuvée pour le moment')}</p>}</>}</section> : <>
      <TaxonomyBrowser value={filters.taxonomyPath} onChange={taxonomyPath => {
        if (taxonomyPath === filters.taxonomyPath) return;
        setProducts([]); setExternal(null); setVisual(null); setLoading(true); setNumber(1);
        setFilters(current => ({ ...current, taxonomyPath, category: '', categoryMode: '' }));
      }} />
      <HomeCategories key={JSON.stringify([filters.businessType, filters.taxonomyPath, filters.supplierTrust, categoryRevision])} businessType={filters.businessType} taxonomyPath={filters.taxonomyPath} supplierTrust={filters.supplierTrust} selected={filters.category} exact={filters.categoryMode === 'exact'}
        onSelect={category => {
          const categoryMode = category ? 'exact' : '';
          if (category === filters.category && categoryMode === filters.categoryMode) return;
          setProducts([]); setExternal(null); setLoading(true);
          setFilters(current => ({ ...current, category, categoryMode })); setNumber(1);
        }} />
      <SupplierTrustFilter value={filters.supplierTrust} onChange={selectSupplierTrust}/>
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
      <div className="atlas-catalog-tools">{(term || image || Object.values(filters).some(Boolean)) && <button className="atlas-clear-filters" onClick={clearSearch}>{l('إعادة ضبط البحث', 'Réinitialiser la recherche')}</button>}</div>
      {!catalogLoading&&structured&&<StructuredSearchSummary result={structured} onRemove={removeCondition} onClear={clearSearch}/>}
      {!catalogLoading&&visual&&<VisualSearchSummary result={visual} onClear={clearImage}/>}
      {catalogLoading ? <p role="status">{l('جاري تحميل النتائج…', 'Chargement…')}</p> : error ? <button onClick={()=>setRefresh(n=>n+1)}>{l('إعادة المحاولة','Réessayer','Retry')}</button> : <>{!structured&&!visual&&<p className="muted">{pagination.total} {l('نتيجة', 'résultat(s)')}</p>}<div className="product-grid atlas-dense-product-grid">{products.map(p => <ProductCard key={p._id} product={p} priceContext={priceContext} user={user} onRfqCreated={() => setPage('buyer')} onRequireLogin={requireLogin} />)}</div></>}
      {!catalogLoading && !products.length && !error && (!structured||structured.canRequestSourcing)&&(!visual||visual.canRequestSourcing) && <section className="panel empty"><h2>{visual?l('لم نجد صورة مشابهة كافية','Aucune image suffisamment similaire','No sufficiently similar image'):structured?l('لا توجد منتجات تطابق هذه الشروط','Aucun produit ne correspond à ces critères','No products match these conditions'):t('product_not_found')}</h2><p>{visual?l('جرّب صورة أخرى أو صف المنتج في طلب توريد.','Essayez une autre image ou décrivez le produit dans une demande.','Try another image or describe the product in a sourcing request.'):structured?l('يمكنك تعديل شروط البحث أو طلب توريد خاص.','Modifiez vos critères ou demandez un sourcing spécifique.','Edit your conditions or request sourcing.'):t('product_not_found_desc')}</p><button className="primary" onClick={() => user ? setSourcing(true) : requireLogin()}>{t('submit_sourcing_btn')}</button></section>}
      <div className="pager"><button disabled={number <= 1 || catalogLoading} onClick={() => setNumber(n => n - 1)}>{l('السابق', 'Précédent')}</button><span>{number} / {Math.max(1, pagination.pages || 1)}</span><button disabled={number >= (pagination.pages || 1) || catalogLoading} onClick={() => setNumber(n => n + 1)}>{l('التالي', 'Suivant')}</button></div>
      {!catalogLoading&&external?.enabled && <section className="panel"><span className="badge amber">{t('external_notice_badge')}</span><h2>{l('نتائج اكتشاف خارجية تجريبية', 'Découvertes externes expérimentales')}</h2><p>{t('external_notice_desc')}</p>{external.results?.map(result => <article className="panel" key={result.url}><h3><a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a></h3><p>{result.description}</p><p className="muted">{result.sourceName} · {l('خارجي — غير موثق', 'Externe — non vérifié')}</p></article>)}</section>}
      </>}
    </main>
    {sourcing && <SourcingModal sessionToken={sessionToken} user={user} onSuccess={() => {
      setSourcing(false);
      setPage('buyer');
    }} initialData={{
      productName: image ? '' : term || query
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
