import { useLabels } from '../../i18n/useLabels';
import '../../styles/atlas-supplier-trust.css';

export default function SupplierTrustFilter({value='',onChange}) {
  const l=useLabels();
  return <section className="atlas-supplier-trust" aria-labelledby="supplier-trust-title">
    <h2 id="supplier-trust-title">{l('فلاتر الموردين','Filtres fournisseurs','Supplier filters')}</h2>
    <div className="atlas-trust-options" role="group" aria-label={l('فلاتر الثقة','Filtres de confiance','Trust filters')} aria-describedby="supplier-trust-note">
      <button type="button" aria-pressed={value==='verified'} onClick={()=>onChange(value==='verified'?'':'verified')}>{l('موردون موثقون','Fournisseurs vérifiés','Verified suppliers')}</button>
      <button type="button" disabled>{l('الأعلى تقييماً','Mieux notés','Top-rated')}</button>
      <button type="button" disabled>{l('سرعة الاستجابة','Réponse rapide','Fast response')}</button>
      <button type="button" disabled>{l('داخل المغرب','Au Maroc','Based in Morocco')}</button>
      {value && <button type="button" onClick={()=>onChange('')}>{l('إلغاء فلترة الثقة','Effacer le filtre','Clear trust filter')}</button>}
    </div>
    <p id="supplier-trust-note">{l('التوثيق اختياري. فلاتر التقييم الموثوق وسرعة الاستجابة وبلد المورد غير متاحة حتى تتوفر بيانات قابلة للتحقق.','La vérification est facultative. Les filtres d’avis fiables, de délai de réponse et de pays restent indisponibles sans données vérifiables.','Verification is optional. Trusted ratings, response time and supplier country filters remain unavailable until verifiable data exists.')}</p>
  </section>;
}