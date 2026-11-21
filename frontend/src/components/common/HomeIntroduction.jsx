import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from './MarketLayout';
import ProtectedImage from './ProtectedImage';

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
      <div><h2 id="home-supplier-title">{supplier ? l('متجرك يبدأ من مساحتك', 'Votre boutique, votre espace') : l('أنت مورد؟', 'Vous êtes fournisseur ?')}</h2>
        <p>{l('عرّف بمنتجاتك وتابع طلبات عروض الأسعار في مساحة واحدة.', 'Présentez vos produits et suivez vos demandes de devis au même endroit.')}</p></div>
      <button type="button" className="primary" onClick={onSupplier}>{supplier ? l('فتح مساحة المورد', 'Mon espace fournisseur') : user ? l('فتح مساحة حسابي', 'Ouvrir mon espace') : l('إنشاء حساب مورد', 'Créer mon compte')}<MarketIcon name="arrow" /></button>
      <small>{l('متجر · منتجات · طلبات عروض', 'Boutique · Produits · Demandes de devis')}</small>
    </aside>
  </section>;
}

export function HomeCategories({ products, selected, onSelect, loading }) {
  const l = useLabels();
  // Category choices come from the current API results; never invent stock.
  const categories = [...new Set([selected, ...products.map(product => product.category)].filter(Boolean))];
  return <section className="atlas-home-categories" aria-labelledby="home-categories-title" aria-busy={loading}>
    <h2 id="home-categories-title">{l('استكشف حسب الفئة', 'Explorez par catégorie')}</h2>
    <div className="atlas-home-category-list" aria-label={l('فئات النتائج', 'Catégories des résultats')}>
      <button type="button" aria-label={l('كل الفئات', 'Toutes les catégories')} aria-pressed={!selected} onClick={() => onSelect('')}>
        <span className="atlas-home-category-art atlas-home-category-all"><MarketIcon name="grid" /></span>
        <span>{l('الكل', 'Tout', 'All')}</span>
      </button>
      {categories.map(category => <button type="button" key={category} aria-pressed={selected === category} onClick={() => onSelect(category)}>
        <span className="atlas-home-category-art"><MarketIcon name="package" />{typeof categoryIllustrations[category] === 'string'
          ? <img src={categoryIllustrations[category]} alt="" width="70" height="64" />
          : <ProtectedImage value={products.find(product => product.category === category && product.imageUrl)?.imageUrl} alt="" loading="lazy" />}</span>
        <span>{category}</span>
      </button>)}
    </div>
  </section>;
}
