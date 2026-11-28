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
      <button type="button" aria-pressed={value==='declared_ma'} onClick={()=>onChange(value==='declared_ma'?'':'declared_ma')}>{l('المغرب (بتصريح المورد)','Maroc (déclaré)','Morocco (self-declared)')}</button>
      {value && <button type="button" onClick={()=>onChange('')}>{l('إلغاء فلترة الثقة','Effacer le filtre','Clear trust filter')}</button>}
    </div>
    <p id="supplier-trust-note">{l('التوثيق اختياري. بلد الشركة بتصريح صاحبها وليس موقعاً موثقاً. فلترا التقييم وسرعة الاستجابة غير متاحين حالياً.','La vérification est facultative. Le pays est déclaré par le propriétaire, sans vérification de localisation. Les filtres de notes et de réponse restent indisponibles.','Verification is optional. Company country is self-declared, not a verified location. Ratings and response-time filters remain unavailable.')}</p>
  </section>;
}