import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from './MarketLayout';
import '../../styles/atlas-business-types.css';

export const BUSINESS_TYPES = [
  ['manufacturer', 'factory', 'المصنعون', 'Fabricants', 'Manufacturers', 'مصنّع', 'Fabricant', 'Manufacturer'],
  ['importer', 'ship', 'المستوردون', 'Importateurs', 'Importers', 'مستورد', 'Importateur', 'Importer'],
  ['distributor', 'truck', 'الموزعون', 'Distributeurs', 'Distributors', 'موزع', 'Distributeur', 'Distributor'],
  ['wholesaler', 'warehouse', 'تجار الجملة', 'Grossistes', 'Wholesalers', 'تاجر جملة', 'Grossiste', 'Wholesaler']
];
export const canonicalTypes = values => BUSINESS_TYPES.map(([key]) => key).filter(key => Array.isArray(values) && values.includes(key));
export function validTypes(values) {
  return Array.isArray(values) && canonicalTypes(values).length === values.length;
}
export function BusinessTypeFilter({ selected, onSelect }) {
  const l = useLabels();
  return <section className="atlas-business-types" aria-label={l('مصدر التوريد', 'Source d’approvisionnement', 'Supply source')}>
    <div className="atlas-business-heading"><h2>{l('تسوق حسب مصدر التوريد', 'Achetez par source d’approvisionnement', 'Shop by supply source')}</h2>
    {selected && <button type="button" className="atlas-types-clear" onClick={() => onSelect('')}>{l('كل الموردين', 'Tous les fournisseurs', 'All suppliers')}</button>}</div>
    <div className="atlas-types-grid">{BUSINESS_TYPES.map(([key, icon, ar, fr, en]) => <button key={key} type="button" aria-pressed={selected === key} onClick={() => onSelect(selected === key ? '' : key)}><MarketIcon name={icon}/><span>{l(ar, fr, en)}</span></button>)}</div>
    <p className="atlas-types-note">{l('الأنشطة حسب تصريح المورد، وليست شهادة توثيق.', 'Activités déclarées par les fournisseurs, sans certification.', 'Supplier-declared activities, not certification.')}</p>
  </section>;
}
export function BusinessTypeChoices({ values, onChange, disabled }) {
  const l = useLabels();
  return <fieldset className="atlas-type-choices" disabled={disabled}>
    <legend>{l('نشاطك التجاري (اختياري)', 'Votre activité (facultatif)', 'Your business activity (optional)')}</legend>
    <p>{l('اختر كل ما ينطبق عليك. يظهر التصريح للمشترين ولا يمنح توثيقاً.', 'Choisissez toutes les activités applicables. Déclaration publique, sans certification.', 'Choose all that apply. Public declaration, not certification.')}</p>
    {BUSINESS_TYPES.map(([key, icon, ar, fr, en, singleAr, singleFr, singleEn]) => <label className="check" key={key}><input type="checkbox" checked={values.includes(key)} onChange={e => onChange(canonicalTypes(e.target.checked ? [...values, key] : values.filter(v => v !== key)))} />{l(singleAr, singleFr, singleEn)}</label>)}
  </fieldset>;
}
export function DeclaredBusinessTypes({ values }) {
  const l = useLabels(), types = canonicalTypes(values);
  if (!types.length) return null;
  return <p className="atlas-types-note">{l('نشاط مصرح به', 'Activité déclarée', 'Declared activity')}: {BUSINESS_TYPES.filter(([key]) => types.includes(key)).map(([, , , , , ar, fr, en]) => l(ar, fr, en)).join(' · ')}</p>;
}
