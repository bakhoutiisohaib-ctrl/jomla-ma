import { localeFor } from '../../i18n/useLabels';
import { useEffect, useState } from 'react';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Link, opportunityPath, productPath, storePath, navigate } from '../../navigation';
import { usePublicMeta, usePublicResource } from '../common/usePublicPage';
import ProtectedImage from '../common/ProtectedImage';
import RFQModal from '../products/RFQModal';
import ShareLink from '../common/ShareLink';
import { OpportunityTerms } from './OpportunityTerms';
import '../../styles/atlas-wholesale.css';

export default function WholesalePage({ id, search = '', user, sessionLoading, onRequireLogin, onRfqCreated }) {
  const l = useLabels(), { lang } = useTranslation();
  const [filters, setFilters] = useState({ category: '', currency: 'MAD', maxPrice: '', quantity: '' }), [query, setQuery] = useState('currency=MAD'), [page, setPage] = useState(1);
  const [rfq, setRfq] = useState(null), [clock, setClock] = useState(Date.now());
  const endpoint = '/wholesale-opportunities' + (id ? '/' + id : '?' + query + '&page=' + page + '&limit=12');
  const { data, loading, error } = usePublicResource(endpoint), opportunity = data?.opportunity;
  usePublicMeta(opportunity?.title || l('فرص الجملة', 'Opportunités de gros'), opportunity?.description, id ? opportunityPath(id) : '/opportunities');
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (opportunity && user?.role === 'buyer' && new URLSearchParams(search).get('rfq') === '1') {
    setRfq(opportunity); navigate(opportunityPath(id), { replace: true });
  } }, [opportunity, user?.role, search, id]);
  const live = opportunity && new Date(opportunity.expiresAt).getTime() > clock;
  const available = (data?.data || []).filter(o => new Date(o.expiresAt).getTime() > clock);
  function filter(event) { event.preventDefault(); setPage(1); setQuery(new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([,v]) => v !== ''))).toString()); }
  return <main className="container wholesale-page" id="market-main" tabIndex="-1">
    <nav className="actions atlas-breadcrumbs"><Link to="/">{l('السوق', 'Catalogue')}</Link><Link to="/opportunities">{l('فرص الجملة', 'Opportunités de gros')}</Link></nav>
    {loading && <p role="status">{l('جارٍ تحميل فرص الجملة…', 'Chargement des opportunités…')}</p>}
    {error && <section className="panel"><h1>{l('الفرصة غير متاحة', 'Opportunité indisponible')}</h1><p role="alert">{error.status === 404 ? l('الفرصة غير موجودة أو غير سارية أو لم تعد مؤهلة للعرض.', 'Cette opportunité n’existe pas, a expiré ou n’est plus disponible.') : error.message}</p></section>}
    {!id && <><header className="panel wholesale-intro"><span className="atlas-eyebrow">Jomla.ma</span><h1>{l('فرص الجملة', 'Opportunités de gros')}</h1><p>{l('فرص ينشرها الموردون لمنتجات متاحة. اختر الكمية، راجع الشروط ثم اطلب عرضاً نهائياً.', 'Des opportunités publiées par les fournisseurs. Vérifiez quantités et conditions, puis demandez un devis final.')}</p></header>
      <form className="panel wholesale-filters" onSubmit={filter}>
        <label>{l('الفئة', 'Catégorie')}<input maxLength={100} value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} /></label>
        <label>{l('العملة', 'Devise')}<input required maxLength={3} pattern="[A-Za-z]{3}" value={filters.currency} onChange={e => setFilters(f => ({ ...f, currency: e.target.value.toUpperCase() }))} /></label>
        <label>{l('أقصى سعر للوحدة', 'Prix unitaire maximum')}<input type="number" min="0" step="0.01" value={filters.maxPrice} onChange={e => setFilters(f => ({ ...f, maxPrice: e.target.value }))} /></label>
        <label>{l('الكمية المطلوبة', 'Quantité souhaitée')}<input type="number" min="1" step="1" value={filters.quantity} onChange={e => setFilters(f => ({ ...f, quantity: e.target.value }))} /></label>
        <button className="primary">{l('تصفية الفرص', 'Filtrer les opportunités')}</button>
      </form>
      {data && <><p>{data.total} {l('فرصة متاحة', 'opportunité(s) disponible(s)')}</p><div className="product-grid">{available.map(o => <article className="product-card" key={o._id}><Link to={opportunityPath(o._id)}><ProtectedImage value={o.product.imageUrl} alt={o.product.name} /></Link><div className="product-body"><span className="badge">{l('فرصة سارية', 'Opportunité en cours')}</span><h2><Link to={opportunityPath(o._id)}>{o.title}</Link></h2><p>{o.product.name}</p><p className="price">{formatMoney(o.effectivePrice ?? o.price, o.currency, lang)} / {o.unit}</p><p>MOQ: {o.moq} {o.unit}</p><p>{o.store.name} · {o.supplier.name}</p><p>{l('تنتهي في', 'Expire le')}: {new Date(o.expiresAt).toLocaleDateString(localeFor(lang))}</p><Link className="button-link primary" to={opportunityPath(o._id)}>{l('تفاصيل وطلب عرض سعر', 'Détails et demande de devis')}</Link></div></article>)}</div>
        {!available.length && <p className="panel">{l('لا توجد فرص سارية بهذه الشروط.', 'Aucune opportunité en cours pour ces critères.')}</p>}
        <div className="pager"><button disabled={page <= 1} onClick={() => setPage(p => p-1)}>{l('السابق', 'Précédent')}</button><span>{page}/{Math.max(1, Math.ceil(data.total/(data.limit || 12)))}</span><button disabled={page*(data.limit || 12) >= data.total} onClick={() => setPage(p => p+1)}>{l('التالي', 'Suivant')}</button></div></>}
    </>}
    {opportunity && <div className="detail-layout"><section className="panel product-gallery"><ProtectedImage value={opportunity.product.imageUrl} alt={opportunity.product.name} /></section><section className="panel atlas-product-summary"><span className="badge">{live ? l('فرصة سارية', 'Opportunité en cours') : l('انتهت الفرصة', 'Opportunité expirée')}</span><h1>{opportunity.title}</h1><p>{opportunity.description}</p><OpportunityTerms opportunity={opportunity} /><h2>{l('شروط الفرصة', 'Conditions')}</h2><p className="wholesale-text">{opportunity.terms || l('لم تُذكر شروط إضافية.', 'Aucune condition supplémentaire indiquée.')}</p><p><Link to={productPath(opportunity.productId)}>{opportunity.product.name}</Link></p><p><Link to={storePath(opportunity.storeId)}>{opportunity.store.name}</Link> · {opportunity.supplier.name} · {opportunity.store.city}</p>
      <p className="muted">{l('السعر استرشادي. إرسال RFQ ليس قبولاً نهائياً للسعر ولا حجزاً للمخزون.', 'Prix indicatif. Une demande de devis ne confirme ni prix final ni réservation de stock.')}</p>
      <button className="primary" disabled={!live || sessionLoading || Boolean(user && user.role !== 'buyer')} onClick={() => user ? setRfq(opportunity) : onRequireLogin(opportunityPath(id)+'?rfq=1')}>{l('طلب عرض سعر لهذه الفرصة', 'Demander un devis pour cette opportunité')}</button>
      {user && user.role !== 'buyer' && <p>{l('يلزم حساب مشتري لإرسال الطلب.', 'Un compte acheteur est requis pour envoyer une demande.')}</p>}
      <ShareLink path={opportunityPath(id)} />
    </section></div>}
    {rfq && (!user || user.role === 'buyer') && <RFQModal opportunity={rfq} product={{ ...rfq.product, moq: rfq.moq, unit: rfq.unit, currency: rfq.currency }} user={user} onClose={() => setRfq(null)} onRequireLogin={() => onRequireLogin(opportunityPath(id)+'?rfq=1')} onSuccess={onRfqCreated} />}
  </main>;
}
