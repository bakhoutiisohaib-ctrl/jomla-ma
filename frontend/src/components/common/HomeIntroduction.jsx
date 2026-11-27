import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from './MarketLayout';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';

// Public category illustrations owned by this project, not cached supplier media.
const categoryIllustrations = {
  'المنزل': '/atlas-category-home.svg',
  'صناعة تقليدية': '/atlas-category-craft.svg',
  'نسيج': '/atlas-category-textile.svg'
};

export function HomeIntroduction({ user, onSupplier, onSourcing }) {
  const l = useLabels();
  const supplier = ['supplier', 'staff'].includes(user?.role);
  return <section className="atlas-home-intro" aria-labelledby="home-title">
    <div className="atlas-home-story">
      <div className="atlas-home-copy">
        <span className="atlas-eyebrow">{l('جملة مغربية. فرص أقرب.', 'LE GROS, PLUS PROCHE.')}</span>
        <h1 id="home-title">{l('منتجات لتجارتك،', 'Le gros,')} <em>{l('وموردون أقرب إليك.', 'plus proche.')}</em></h1>
        <p>{l('اكتشف المنتجات واطلب عرضاً يناسب احتياجك.', 'Découvrez les produits et demandez votre devis aux fournisseurs.')}</p>
        <div className="atlas-home-actions">
          <a className="button-link primary" href="#market-main">{l('تصفح المنتجات', 'Explorer les produits')}<MarketIcon name="arrow" /></a>
          <button type="button" onClick={onSourcing}>{l('طلب توريد خاص', 'Demande de sourcing')}</button>
        </div>
        <small className="atlas-home-note">{l('تصفح بحرية · أرسل طلبك بعد تسجيل الدخول', 'Parcourez librement · Connectez-vous pour demander un devis')}</small>
      </div>
      <figure className="atlas-home-scene">
        <img src="/atlas-trade-home.webp" width="960" height="640" alt={l('مشهد توضيحي مولّد: خزف ونسيج وسلال وطرود في فناء مغربي', 'Scène illustrative générée : céramique, textiles, paniers et colis dans un patio marocain')} />
        <figcaption>{l('مشهد توضيحي', 'Scène illustrative')}</figcaption>
      </figure>
    </div>
    <aside className="atlas-home-supplier" aria-labelledby="home-supplier-title">
      <MarketIcon name="store" />
      <div><h2 id="home-supplier-title">{supplier ? l('متجرك يبدأ من مساحتك', 'Votre boutique, votre espace') : user ? l('مساحتك التجارية', 'Votre espace commercial', 'Your business workspace') : l('أنت مورد؟', 'Vous êtes fournisseur ?')}</h2>
        <p>{l('عرّف بمنتجاتك وتابع طلبات عروض الأسعار في مساحة واحدة.', 'Présentez vos produits et suivez vos demandes de devis au même endroit.')}</p></div>
      <button type="button" className="primary" onClick={onSupplier}>{supplier ? l('فتح مساحة المورد', 'Mon espace fournisseur') : user ? l('فتح مساحة حسابي', 'Ouvrir mon espace') : l('إنشاء حساب مورد', 'Créer mon compte')}<MarketIcon name="arrow" /></button>
      <small>{l('متجر · منتجات · طلبات عروض', 'Boutique · Produits · Demandes de devis')}</small>
    </aside>
  </section>;
}

const CATEGORY_LIMIT = 12;
function parseDirectory(response, page) {
  const { data, pagination } = response || {};
  if (!Array.isArray(data) || data.length > CATEGORY_LIMIT ||
      !data.every(item => typeof item?.category === 'string' && item.category.trim() === item.category &&
        item.category.length > 0 && [...item.category].length <= 100 && Number.isSafeInteger(item.count) && item.count > 0) ||
      new Set(data.map(item => item.category)).size !== data.length ||
      pagination?.page !== page || pagination.limit !== CATEGORY_LIMIT ||
      !Number.isSafeInteger(pagination.total) || pagination.total < 0 ||
      pagination.pages !== Math.ceil(pagination.total / CATEGORY_LIMIT) ||
      pagination.hasNextPage !== (page < pagination.pages) || pagination.hasPrevPage !== (page > 1) ||
      data.length !== Math.min(CATEGORY_LIMIT, Math.max(0, pagination.total - (page - 1) * CATEGORY_LIMIT))) {
    throw new Error('Invalid category directory');
  }
  return { data, pagination };
}

// The parent keys this component by activity, so previous activity state is
// never displayed during a transition. Page navigation is independent of products.
export function HomeCategories({ businessType = '', taxonomyPath = '', supplierTrust = '', selected, exact, onSelect }) {
  const l = useLabels();
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null), [failed, setFailed] = useState(false);
  const loading = !result && !failed;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setFailed(false);
    const params = new URLSearchParams({ page: String(page), limit: String(CATEGORY_LIMIT) });
    if (businessType) params.set('businessType', businessType);
    if (taxonomyPath) params.set('taxonomyPath', taxonomyPath);
    if (supplierTrust) params.set('supplierTrust', supplierTrust);
    apiRequest('/products/categories?' + params.toString(), { token: '', cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (controller.signal.aborted) return;
        const next = parseDirectory(response, page);
        // A page can disappear when the catalog changes between requests.
        if (page > 1 && page > next.pagination.pages) { setPage(1); return; }
        setResult(next);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [businessType, taxonomyPath, supplierTrust, page, retry]);
  const changePage = value => { setResult(null); setFailed(false); setPage(value); };
  const categories = result?.data || [];
  const hasSelected = exact && categories.some(item => item.category === selected);
  return <section className="atlas-home-categories" aria-labelledby="home-categories-title" aria-busy={loading}>
    <h2 id="home-categories-title">{l('استكشف حسب الفئة', 'Explorez par catégorie', 'Explore by category')}</h2>
    <div className="atlas-home-category-list" aria-label={l('فئات الكتالوج', 'Catégories du catalogue', 'Catalog categories')}>
      <button type="button" aria-label={l('كل الفئات', 'Toutes les catégories', 'All categories')} aria-pressed={!selected} onClick={() => onSelect('')}>
        <span className="atlas-home-category-art atlas-home-category-all"><MarketIcon name="grid" /></span>
        <span>{l('الكل', 'Tout', 'All')}</span>
      </button>
      {categories.map(({category, count}) => <button type="button" key={category} aria-label={category} title={count + ' ' + l('منتج في الكتالوج', 'produit(s) au catalogue', 'catalog product(s)')} aria-pressed={Boolean(exact && selected === category)} onClick={() => onSelect(category)}>
        <span className="atlas-home-category-art"><MarketIcon name="package" />{Object.prototype.hasOwnProperty.call(categoryIllustrations, category)
          && <img src={categoryIllustrations[category]} alt="" width="70" height="64" />}</span>
        <span>{category}</span><small className="atlas-category-count">{count}</small>
      </button>)}
    </div>
    <div className="atlas-category-feedback" aria-live="polite">
      {loading && <span>{l('جاري تحميل الفئات…', 'Chargement des catégories…', 'Loading categories…')}</span>}
      {failed && <><span>{l('تعذر تحميل دليل الفئات.', 'Impossible de charger les catégories.', 'Unable to load categories.')}</span><button type="button" onClick={() => { setFailed(false); setRetry(n => n + 1); }}>{l('إعادة تحميل الفئات', 'Recharger les catégories', 'Reload categories')}</button></>}
      {result && !categories.length && <span>{l('لا توجد فئات منشورة لهذا الاختيار حالياً.', 'Aucune catégorie publiée pour ce choix actuellement.', 'No published categories for this selection currently.')}</span>}
      {result && categories.length > 0 && <span>{l('الأعداد من الكتالوج، وليس نتائج البحث الحالي.', 'Les nombres concernent le catalogue, pas la recherche en cours.', 'Counts are from the catalog, not current search results.')}</span>}
      {selected && !hasSelected && <span>{l('الفئة المفلترة', 'Catégorie filtrée', 'Filtered category')}: {selected}</span>}
    </div>
    {(page > 1 || result?.pagination.hasNextPage) && <nav className="atlas-category-pager" aria-label={l('صفحات الفئات', 'Pages de catégories', 'Category pages')}>
      <button type="button" disabled={loading || page <= 1} onClick={() => changePage(page - 1)}>{l('الفئات السابقة', 'Catégories précédentes', 'Previous categories')}</button>
      <span>{page} / {result?.pagination.pages || '…'}</span>
      <button type="button" disabled={loading || !result?.pagination.hasNextPage} onClick={() => changePage(page + 1)}>{l('فئات أخرى', 'Autres catégories', 'More categories')}</button>
    </nav>}
  </section>;
}
