import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useSessionToken } from '../../api/session';
import { Link, productPath } from '../../navigation';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { useQuoteCart, CART_LIMIT } from './QuoteCartContext';
import ProtectedImage from '../common/ProtectedImage';
import { MarketIcon } from '../common/MarketLayout';
import { Notice } from '../common/WorkspaceUI';
import RFQModal from '../products/RFQModal';
import '../../styles/atlas-cart.css';

export default function QuoteCartPage({ user, sessionLoading, onRequireLogin }) {
  const cart = useQuoteCart(), l = useLabels(), { lang } = useTranslation(), token = useSessionToken();
  const [result, setResult] = useState(null), [retry, setRetry] = useState(0);
  const [active, setActive] = useState(null), [sent, setSent] = useState(null), [error, setError] = useState('');
  const selection = cart.items.join(',');
  useEffect(() => {
    let live = true, controller;
    const ids = selection ? selection.split(',') : [];
    async function load() {
      controller?.abort(); controller = new AbortController();
      const request = controller;
      if (document.visibilityState === 'hidden') { setResult(null); return; }
      const rows = await Promise.all(ids.map(async id => {
        try { return { id, ...await apiRequest('/products/' + id, { signal: request.signal, token: '', cache: 'no-store' }) }; }
        catch (failure) { return { id, error: failure }; }
      }));
      if (live && !request.signal.aborted) setResult({ selection, rows });
    }
    load(); const timer = setInterval(load, 30000);
    document.addEventListener('visibilitychange', load);
    return () => { live = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [selection, retry]);
  const rows = result?.selection === selection ? result.rows : null;
  const groups = new Map();
  for (const row of rows || []) {
    const supplier = row.product?.supplierId;
    const key = supplier?._id || 'unavailable';
    if (!groups.has(key)) groups.set(key, { name: supplier?.name || l('منتجات تحتاج المراجعة', 'Produits à vérifier'), rows: [] });
    groups.get(key).rows.push(row);
  }
  function remove(id) { if (!cart.remove(id)) setError(l('تعذر تحديث السلة في هذا المتصفح.', 'Impossible de mettre à jour la sélection dans ce navigateur.')); }
  return <main className="container atlas-cart-page" id="market-main" tabIndex="-1">
    <nav className="atlas-breadcrumbs"><Link to="/">{l('السوق', 'Catalogue')}</Link><span>/</span><span>{l('سلة طلبات العروض', 'Sélection de devis')}</span></nav>
    <div className="atlas-cart-heading"><div><span className="atlas-eyebrow">{l('جهز طلبك على مهل', 'PRÉPAREZ VOTRE DEMANDE')}</span><h1>{l('سلة طلبات العروض', 'Votre sélection de devis')}</h1><p>{l('اجمع المنتجات، ثم راجع الكمية والتوصيل وأرسل طلباً مستقلاً لكل منتج إلى مورده.', 'Réunissez les produits, puis précisez la quantité et la livraison avant d’envoyer une demande distincte pour chaque produit à son fournisseur.')}</p></div><span className="atlas-cart-counter">{cart.items.length}<small>{l('منتج', 'produit(s)')}</small></span></div>
    <Notice error>{error}</Notice>
    {sent?.token === token && <Notice>{l('تم إرسال طلب العرض بنجاح. المرجع: ', 'Demande de devis envoyée. Référence : ')}<bdi>{sent.id}</bdi>{' '}<Link to="/buyer">{l('متابعة طلباتي', 'Suivre mes demandes')}</Link></Notice>}
    {!cart.items.length ? <section className="panel atlas-cart-empty"><MarketIcon name="package" /><h2>{l('سلتك جاهزة لأول اختيار', 'Votre sélection attend son premier produit')}</h2><p>{l('أضف المنتجات من الكتالوج، وستجدها مجمعة هنا حسب المورد.', 'Ajoutez des produits depuis le catalogue : ils seront regroupés ici par fournisseur.')}</p><Link className="button-link primary" to="/">{l('اكتشف المنتجات', 'Explorer les produits')}</Link></section> : <>
      {!user && !sessionLoading && <Notice>{l('يمكنك تجهيز السلة الآن. سجل الدخول كمشتري عند إرسال الطلبات.', 'Préparez votre sélection, puis connectez-vous comme acheteur pour envoyer les demandes.')} <button onClick={() => onRequireLogin('/cart')}>{l('دخول المشتري', 'Connexion acheteur')}</button></Notice>}
      {user && user.role !== 'buyer' && <Notice>{l('إرسال طلبات العروض متاح لحساب المشتري.', 'L’envoi de demandes de devis est réservé au compte acheteur.')}</Notice>}
      {!rows && <p role="status">{l('جاري تحديث المنتجات…', 'Actualisation des produits…')}</p>}
      {[...groups].map(([key, group]) => <section className="panel atlas-cart-group" key={key}><h2><MarketIcon name="store" />{group.name}</h2>{group.rows.map(row => <article className="atlas-cart-row" key={row.id}>
        {row.product ? <><Link className="atlas-cart-image" to={productPath(row.id)}><ProtectedImage value={row.product.imageUrl} alt={row.product.name} /></Link><div className="atlas-cart-info"><h3><Link to={productPath(row.id)}>{row.product.name}</Link></h3><p>{row.product.pricingMode === 'on_request' ? l('السعر عند الطلب', 'Prix sur demande') : formatMoney(row.product.price, row.product.currency, lang)} / {row.product.unit}</p><small>{l('أقل طلب: ', 'Minimum : ')}{row.product.moq} {row.product.unit}</small></div><div className="atlas-cart-row-actions"><button className="primary" disabled={sessionLoading || Boolean(user && user.role !== 'buyer') || row.product.availability !== 'in_stock'} onClick={() => user ? setActive({ product: row.product, token }) : onRequireLogin('/cart')}>{l('مراجعة وإرسال الطلب', 'Vérifier et envoyer')}</button>{row.product.availability !== 'in_stock' && <small>{l('غير متوفر حالياً', 'Indisponible actuellement')}</small>}<button onClick={() => remove(row.id)} aria-label={l('إزالة من السلة: ', 'Retirer de la sélection : ') + row.product.name}>{l('إزالة', 'Retirer')}</button></div></> : <><div className="atlas-cart-info"><h3>{l('تعذر عرض هذا المنتج', 'Produit non affichable')}</h3><p>{row.error?.status === 404 ? l('لم يعد متاحاً في الكتالوج.', 'Il n’est plus disponible dans le catalogue.') : l('تعذر الاتصال. اختياراتك محفوظة؛ حاول من جديد.', 'Connexion impossible. Votre sélection est conservée ; réessayez.')}</p></div><div className="atlas-cart-row-actions"><button onClick={() => setRetry(value => value + 1)}>{l('إعادة المحاولة', 'Réessayer')}</button><button onClick={() => remove(row.id)}>{l('إزالة', 'Retirer')}</button></div></>}
      </article>)}</section>)}
    </>}
    <p className="atlas-cart-footnote">{l('حتى ' + CART_LIMIT + ' منتجاً. تُحفظ اختيارات المنتجات في جلسة هذا المتصفح فقط؛ الطلبات المرسلة تبقى في حسابك.', 'Jusqu’à ' + CART_LIMIT + ' produits. La sélection reste dans cette session du navigateur ; les demandes envoyées restent dans votre compte.', 'Up to ' + CART_LIMIT + ' products. Your selection stays in this browser session; submitted requests stay in your account.')}</p>
    {active?.token === token && user?.role === 'buyer' && <RFQModal product={active.product} user={user} onRequireLogin={() => onRequireLogin('/cart')} onClose={() => setActive(null)} onSuccess={rfq => { setSent({ id: rfq._id, token }); remove(active.product._id); setActive(null); }} />}
  </main>;
}
