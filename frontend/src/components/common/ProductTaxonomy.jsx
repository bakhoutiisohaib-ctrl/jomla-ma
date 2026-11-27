import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { MarketIcon } from './MarketLayout';
import '../../styles/atlas-taxonomy.css';

const labelsValid = labels => Array.isArray(labels) && labels.length === 3 &&
  labels.every(label => typeof label === 'string' && label.trim() && label.length <= 160);
const keyValid = key => typeof key === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(key);
export function parseTaxonomy(data) {
  if (data?.version !== 'v49-1' || !Array.isArray(data.sectors) || data.sectors.length !== 10) throw new Error('Invalid taxonomy');
  const paths = new Set();
  for (const sector of data.sectors) {
    if (!keyValid(sector?.key) || !labelsValid(sector.labels) || paths.has(sector.key) ||
        !Array.isArray(sector.children) || !sector.children.length) throw new Error('Invalid sector');
    paths.add(sector.key);
    for (const child of sector.children) {
      if (typeof child?.path !== 'string' || !child.path.startsWith(sector.key + '/') ||
          !keyValid(child.path.slice(sector.key.length + 1)) || paths.has(child.path) ||
          !labelsValid(child.labels)) throw new Error('Invalid category');
      paths.add(child.path);
    }
  }
  if (paths.size !== 46) throw new Error('Invalid taxonomy size');
  return data.sectors;
}
export function useTaxonomy(enabled = true) {
  const [state, setState] = useState({ sectors: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    apiRequest('/products/taxonomy', { token: '', cache: 'no-store', signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ sectors: parseTaxonomy(data), failed: false });
      }).catch(() => { if (!controller.signal.aborted) setState({ sectors: null, failed: true }); });
    return () => controller.abort();
  }, [enabled, attempt]);
  return { ...state, loading: enabled && !state.sectors && !state.failed,
    retry: () => { setState({ sectors: null, failed: false }); setAttempt(n => n + 1); } };
}
const languageIndex = lang => lang === 'fr' ? 1 : lang === 'en' ? 2 : 0;
export function taxonomyLabel(sectors, value, lang) {
  const sector = sectors?.find(s => s.key === value?.split('/')[0]);
  if (!sector) return value || '';
  const child = sector.children.find(c => c.path === value);
  const i = languageIndex(lang);
  return sector.labels[i] + (child ? ' / ' + child.labels[i] : '');
}
function TaxonomyStatus({ state }) {
  const l = useLabels();
  return <div className="atlas-taxonomy-status" aria-live="polite">
    {state.loading && <span>{l('جاري تحميل القطاعات…','Chargement des secteurs…','Loading sectors…')}</span>}
    {state.failed && <><span>{l('تعذر تحميل التصنيف.','Impossible de charger la classification.','Unable to load classification.')}</span><button type="button" onClick={state.retry}>{l('إعادة تحميل القطاعات','Recharger les secteurs','Reload sectors')}</button></>}
  </div>;
}
export function TaxonomyBrowser({ value = '', onChange }) {
  const l = useLabels(), { lang } = useTranslation(), state = useTaxonomy();
  const i = languageIndex(lang), active = value.split('/')[0];
  const sector = state.sectors?.find(s => s.key === active);
  return <section className="atlas-taxonomy" aria-label={l('القطاعات التجارية','Secteurs commerciaux','Trade sectors')} aria-busy={state.loading}>
    <h2>{l('تسوق حسب القطاع','Achetez par secteur','Shop by sector')}</h2>
    <div className="atlas-taxonomy-rail" role="group" aria-label={l('القطاعات الرئيسية','Secteurs principaux','Main sectors')}>
      <button type="button" aria-pressed={!value} onClick={() => onChange('')}><MarketIcon name="grid"/>{l('كل القطاعات','Tous les secteurs','All sectors')}</button>
      {state.sectors?.map(s => <button type="button" key={s.key} aria-pressed={active === s.key} onClick={() => onChange(s.key)}><MarketIcon name="package"/>{s.labels[i]}</button>)}
    </div>
    {sector && <div className="atlas-taxonomy-rail atlas-taxonomy-children" role="group" aria-label={l('الفئات الفرعية','Sous-catégories','Subcategories')}>
      <button type="button" aria-pressed={value === sector.key} onClick={() => onChange(sector.key)}>{l('كل فئات القطاع','Tout le secteur','Entire sector')}</button>
      {sector.children.map(c => <button type="button" key={c.path} aria-pressed={value === c.path} onClick={() => onChange(c.path)}>{c.labels[i]}</button>)}
    </div>}
    {value && <p className="atlas-taxonomy-status">{taxonomyLabel(state.sectors,value,lang)}</p>}
    <TaxonomyStatus state={state}/>
    <p className="atlas-taxonomy-status">{l('القطاعات دليل تصنيف، وقد لا تتوفر منتجات في بعضها حالياً.','Les secteurs structurent le catalogue ; certains peuvent ne pas avoir de produits actuellement.','Sectors organize the catalog; some may currently have no products.')}</p>
  </section>;
}
export function TaxonomyFields({ value = '', onChange, state }) {
  const l = useLabels(), { lang } = useTranslation(), i = languageIndex(lang);
  const sector = state.sectors?.find(s => s.key === value.split('/')[0]);
  const child = sector?.children.find(c => c.path === value);
  return <div className="atlas-taxonomy-fields">
    <TaxonomyStatus state={state}/>
    {state.sectors && <><label>{l('القطاع الرئيسي','Secteur principal','Main sector')}
      <select value={sector?.key || ''} onChange={e => onChange(e.target.value)}>
        <option value="">{l('دون تصنيف هرمي','Sans classification hiérarchique','No hierarchical classification')}</option>
        {state.sectors.map(s => <option value={s.key} key={s.key}>{s.labels[i]}</option>)}
      </select></label>
      {sector && <label>{l('الفئة الفرعية','Sous-catégorie','Subcategory')}<select value={child?.path || ''} onChange={e => onChange(e.target.value || sector.key)}>
        <option value="">{l('القطاع فقط','Secteur uniquement','Sector only')}</option>
        {sector.children.map(c => <option key={c.path} value={c.path}>{c.labels[i]}</option>)}
      </select></label>}</>}
    {value && (!sector || (value.includes('/') && !child)) && <p>{l('التصنيف المحفوظ','Classification enregistrée','Saved classification')}: {value}</p>}
    {value && !state.sectors && <button type="button" onClick={() => onChange('')}>{l('إزالة التصنيف الهرمي','Retirer la classification','Clear classification')}</button>}
  </div>;
}
