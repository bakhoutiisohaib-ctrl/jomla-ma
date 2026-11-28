import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { MarketIcon } from './MarketLayout';
import AtlasDialog from './AtlasDialog';
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
// Reference V4.9 sector motifs and muted tones. Unknown server keys use a neutral icon.
const sectorArt = {
  home: ['#e9f1e8','m3 11 9-7 9 7v9H3zM9 20v-7h6v7M5 10h14'],
  textile: ['#f1e9de','m8 4 4 3 4-3 5 4-3 5-3-2v9H9v-9l-3 2-3-5zM9 9h6'],
  electronic: ['#e7eef4','M6 6h12v12H6zM9 9h6v6H9zM3 9h3M3 15h3M18 9h3M18 15h3M9 3v3M15 3v3M9 18v3M15 18v3'],
  industry: ['#e9edec','M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  agri: ['#e8f2df','M20 4C11 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-7 11-16ZM5 20c2-6 6-9 12-12M9 13l-1-5M12 11l5 2'],
  craft: ['#f2e8d9','M5 9h14l-1.4 11H6.4L5 9ZM7 9c0-3.5 2-5 5-5s5 1.5 5 5M8 13l4 4 4-4M9 20v-4M15 20v-4'],
  packaging: ['#f1ecd9','m3 7 9-4 9 4v10l-9 4-9-4V7ZM3 7l9 5 9-5M12 12v9M7 5l9 5'],
  auto: ['#ece9ed','M4 15 6 9h12l2 6v5h-3v-2H7v2H4zM6 9l2-4h8l2 4M4 15h16M7 15h2M15 15h2'],
  building: ['#eaece7','M4 21V5l8-3 8 3v16M2 21h20M8 8h2M14 8h2M8 12h2M14 12h2M10 21v-5h4v5'],
  beauty: ['#f3e7e8','M9 3h6M10 3v5l-3 3v9c0 1 1 2 2 2h6c1 0 2-1 2-2v-9l-3-3V3M7 13h10M10 17h4']
};
function SectorIcon({ sector }) {
  const art = sectorArt[sector];
  return <span className="atlas-sector-art" style={{background:art?.[0] || '#e7f0e8'}} aria-hidden="true">
    {art ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={art[1]}/></svg> : <MarketIcon name="grid"/>}
  </span>;
}
function SectorChoices({ sectors, index, onSelect, active, firstRef }) {
  return <div className="atlas-sector-grid">
    {sectors.map((s,n) => <button type="button" ref={n===0 ? firstRef : undefined} key={s.key} aria-pressed={active===s.key} onClick={()=>onSelect(s.key)}><SectorIcon sector={s.key}/><span>{s.labels[index]}</span></button>)}
  </div>;
}
export function TaxonomyBrowser({ value = '', onChange }) {
  const l = useLabels(), { lang } = useTranslation(), state = useTaxonomy();
  const i = languageIndex(lang), active = value.split('/')[0];
  const [popup,setPopup] = useState(null);
  const rail = useRef(null), firstChoice = useRef(null), switched = useRef(false);
  const sector = state.sectors?.find(s => s.key === popup);
  const title = l('عرض جميع القطاعات','Voir tous les secteurs','View all sectors');
  const close = () => setPopup(null);
  function selectSector(key, fromDirectory = false) {
    if (fromDirectory) switched.current = true;
    onChange(key);
    setPopup(key);
  }
  useEffect(()=>{
    if(switched.current && popup && popup!=='all') {
      switched.current=false;
      firstChoice.current?.focus();
    }
  },[popup]);
  function selectLeaf(path) { onChange(path); close(); }
  return <section className="atlas-taxonomy" aria-label={l('القطاعات التجارية','Secteurs commerciaux','Trade sectors')} aria-busy={state.loading}>
    <div className="atlas-taxonomy-head"><h2>{l('تسوق حسب القطاع','Achetez par secteur','Shop by sector')}</h2>
      {state.sectors && <button type="button" className="atlas-taxonomy-all" aria-haspopup="dialog" onClick={e=>{e.currentTarget.focus();setPopup('all')}}>{title}</button>}
    </div>
    <div className="atlas-taxonomy-rail" ref={rail} role="group" aria-label={l('القطاعات الرئيسية','Secteurs principaux','Main sectors')}>
      <button type="button" aria-pressed={!value} onClick={() => {close();onChange('')}}><SectorIcon/><span>{l('كل القطاعات','Tous les secteurs','All sectors')}</span></button>
      {state.sectors?.map(s => <button type="button" key={s.key} aria-pressed={active === s.key} aria-haspopup="dialog" onClick={e=>{e.currentTarget.focus();selectSector(s.key)}}><SectorIcon sector={s.key}/><span>{s.labels[i]}</span></button>)}
    </div>
    {popup && state.sectors && (popup==='all' || sector) && <AtlasDialog title={popup==='all'?title:sector.labels[i]} subtitle={l('دليل القطاعات','Guide des secteurs','Sector directory')} onClose={close}>
      <div className="atlas-taxonomy-modal">
        {popup==='all' ? <><p>{l('اختر قطاعاً لعرض فئاته الفرعية.','Choisissez un secteur pour voir ses sous-catégories.','Choose a sector to explore its subcategories.')}</p>
          <SectorChoices sectors={state.sectors} index={i} active={active} onSelect={key=>selectSector(key,true)}/></> :
          <div className="atlas-taxonomy-children" role="group" aria-label={l('الفئات الفرعية','Sous-catégories','Subcategories')}>
            <button type="button" ref={firstChoice} aria-pressed={value===sector.key} onClick={()=>selectLeaf(sector.key)}>{l('كل فئات القطاع','Tout le secteur','Entire sector')}</button>
            {sector.children.map(c=><button type="button" key={c.path} aria-pressed={value===c.path} onClick={()=>selectLeaf(c.path)}>{c.labels[i]}</button>)}
          </div>}
        <p className="atlas-taxonomy-status">{l('القطاعات دليل تصنيف، وقد لا تتوفر منتجات في بعضها حالياً.','Les secteurs structurent le catalogue ; certains peuvent ne pas avoir de produits actuellement.','Sectors organize the catalog; some may currently have no products.')}</p>
      </div>
    </AtlasDialog>}
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
