import { useLabels } from '../../i18n/useLabels';
import '../../styles/atlas-supplier-trust.css';

export default function SupplierTrustFilter({value='',onChange}) {
  const l=useLabels();
  return <section className="atlas-supplier-trust" aria-labelledby="supplier-trust-title">
    <h2 id="supplier-trust-title">{l('فلاتر الموردين','Filtres fournisseurs','Supplier filters')}</h2>
    <div className="atlas-trust-options" role="group" aria-label={l('فلاتر الثقة','Filtres de confiance','Trust filters')} aria-describedby="supplier-trust-note">
      <button type="button" aria-pressed={value==='verified'} onClick={()=>onChange(value==='verified'?'':'verified')}>{l('موردون موثقون','Fournisseurs vérifiés','Verified suppliers')}</button>
      <button type="button" aria-pressed={value==='rated'} onClick={()=>onChange(value==='rated'?'':'rated')}>{l('الأعلى تقييماً','Mieux notés','Top-rated')}</button>
      <button type="button" aria-pressed={value==='fast_response'} onClick={()=>onChange(value==='fast_response'?'':'fast_response')}>{l('سرعة الاستجابة','Réponse rapide','Fast response')}</button>
      <button type="button" aria-pressed={value==='declared_ma'} onClick={()=>onChange(value==='declared_ma'?'':'declared_ma')}>{l('المغرب (بتصريح المورد)','Maroc (déclaré)','Morocco (self-declared)')}</button>
      {value && <button type="button" onClick={()=>onChange('')}>{l('إلغاء فلترة الثقة','Effacer le filtre','Clear trust filter')}</button>}
    </div>
    <p id="supplier-trust-note">{l('التوثيق اختياري. بلد الشركة بتصريح صاحبها وليس موقعاً موثقاً.','La vérification est facultative. Le pays est déclaré par le propriétaire, sans vérification de localisation.','Verification is optional. Company country is self-declared, not a verified location.')}</p>
    {value==='rated'&&<p>{l('الأعلى تقييماً: معدل 4.5/5 فأكثر (بعد التقريب) من ثلاثة تقييمات محتسبة على الأقل. لا يغيّر ترتيب البحث.','Mieux notés : moyenne arrondie d’au moins 4,5/5 et au moins trois avis comptabilisés. Le tri reste inchangé.','Top-rated: rounded average of at least 4.5/5 from at least three counted reviews. Search ordering is unchanged.')}</p>}
    {value==='fast_response'&&<p>{l('سرعة الاستجابة: أول رد تجاري مكتمل (عرض سعر أو رفض) خلال 24 ساعة في 80% على الأقل من الطلبات المحتسبة. آخر 30 يوماً، أول طلب مستحق لكل مشترٍ، ثلاثة مشترين على الأقل. الطلبات الجديدة المسجلة فقط؛ لا ضمان للرد.','Réponse rapide : première réponse commerciale finalisée (offre ou refus) sous 24 h pour au moins 80 % des demandes comptées. 30 derniers jours, première demande arrivée à échéance par acheteur, au moins trois acheteurs. Nouvelles demandes enregistrées uniquement ; sans garantie.','Fast response: first completed commercial reply (offer or refusal) within 24 hours for at least 80% of counted requests. Past 30 days, first matured request per buyer, at least three buyers. Newly recorded requests only; no response guarantee.')}</p>}
  </section>;
}