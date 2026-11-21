import { useLabels } from '../../i18n/useLabels';

export default function SupplierSetupGuide({ can, onTab }) {
  const l = useLabels();
  const steps = [
    ['organization', l('عرّف بشركتك', 'Présentez votre entreprise'), l('راجع اسم النشاط والمدينة وبيانات الفريق.', 'Vérifiez le nom, la ville et les membres de votre équipe.'), l('راجع ملف الشركة', 'Voir le profil entreprise'), true],
    ['stores', l('جهّز واجهة متجرك', 'Préparez votre boutique'), l('أضف وصفاً واضحاً وتابع حالة اعتماد المتجر.', 'Ajoutez une présentation et suivez l’approbation de la boutique.'), l('جهّز المتجر', 'Préparer la boutique'), can('manage_store')],
    ['add', l('أضف أول منتجاتك', 'Ajoutez vos produits'), l('صورة واضحة، كمية دنيا وأسعار. يمكنك البدء بمسودة.', 'Une image, un minimum de commande et vos tarifs. Vous pouvez commencer par un brouillon.'), l('جهّز منتجاً', 'Préparer un produit'), can('manage_products')],
    ['rfq', l('تابع فرص البيع', 'Suivez les demandes'), l('راجع طلبات المشترين وأرسل عروضك داخل المنصة.', 'Consultez les demandes et envoyez vos devis sur la plateforme.'), l('راجع طلبات المشترين', 'Voir les demandes acheteurs'), can('manage_rfq')]
  ].filter(step => step[4]);
  return <section className="panel supplier-setup"><div className="supplier-setup-heading"><p className="supplier-eyebrow">{l('من الحساب إلى استقبال الطلبات', 'DU COMPTE AUX DEMANDES')}</p><h2>{l('جهّز تجارتك خطوة بخطوة', 'Préparez votre activité, étape par étape')}</h2></div><ol>{steps.map(([tab, title, description, action], index) => <li key={tab}><span className="supplier-step-number" aria-hidden="true">0{index + 1}</span><h3>{title}</h3><p>{description}</p><button onClick={() => onTab(tab)}>{action}<span aria-hidden="true"> ↗</span></button></li>)}</ol></section>;
}
