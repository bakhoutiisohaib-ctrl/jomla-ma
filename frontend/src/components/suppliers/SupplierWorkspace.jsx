import BrandHomeLink from '../common/BrandHomeLink';
import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useEffect, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from '../common/MarketLayout';
import '../../styles/atlas-supplier.css';

export function SupplierHeader({ profile, unread, onNotifications, onBack, onLogout, children }) {
  const l = useLabels();
  return <><a className="supplier-skip" href="#supplier-main">{l('تجاوز إلى المحتوى','Aller au contenu')}</a>
    <header className="supplier-header"><BrandHomeLink className="supplier-brand"><span>ج</span><div><strong dir="ltr">jomla.ma</strong><small>{l('مساحة المورد','Espace fournisseur')}</small></div></BrandHomeLink>
      <nav aria-label={l('الحساب واللغة','Compte et langue')}><button onClick={onBack}>{l('السوق','Catalogue')}</button><LanguageSwitch /><button className="supplier-bell" onClick={onNotifications} aria-label={l('تنبيهات الحساب','Alertes du compte')+': '+unread}><MarketIcon name="bell" />{unread>0 && <span>{unread>99?'99+':unread}</span>}</button>{children}<button onClick={onLogout}>{l('خروج','Déconnexion')}</button></nav>
      <p className="supplier-account-name">{profile.name}</p>
    </header></>;
}

export const advancedSupplierTabs = ['wholesale','jobs','verification','reviews','trades'];
const navIcons = {overview:'grid',organization:'user',stores:'store',products:'package',drafts:'eye',add:'package',rfq:'message',direct:'message',sourcing:'search',notifications:'bell',wholesale:'truck',jobs:'camera',verification:'user',reviews:'heart',trades:'package'};
export function SupplierSidebar({ tabs, tab, onTab, advanced, onModeChange }) {
  const l = useLabels();
  const [expanded, setExpanded] = useState(() => window.innerWidth > 700);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width:700px)');
    if (!media) return;
    const change = () => setExpanded(!media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return <aside className="supplier-sidebar"><p className="supplier-eyebrow">{l('أدِر تجارتك','Gérez votre activité')}</p>
    <div className="supplier-mode" role="group" aria-label={l('طريقة عرض المكتب','Mode du bureau','Office mode')}>
      <button type="button" aria-pressed={!advanced} onClick={()=>onModeChange(false)}>{l('مبسط','Simple','Simple')}</button>
      <button type="button" aria-pressed={advanced} onClick={()=>onModeChange(true)}>{l('متقدم','Avancé','Advanced')}</button>
    </div>
    <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>{l('أقسام المورد','Espace fournisseur')}: {tabs.find(([key])=>key===tab)?.[1]}</summary><nav aria-label={l('أقسام المورد','Espace fournisseur')}>{tabs.filter(([key,,allowed])=>allowed && (advanced || !advancedSupplierTabs.includes(key))).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{onTab(key);if(window.innerWidth<=700)setExpanded(false);}}>{key==='add'?<span className="supplier-add-symbol" aria-hidden="true">+</span>:<MarketIcon name={navIcons[key]}/>}<span>{label}</span></button>)}</nav></details>
    <p className="supplier-sidebar-note">{l('متجر معتمد للنشر. توثيق تجاري اختياري.', 'Boutique approuvée pour publier. Vérification commerciale facultative.')}</p>
  </aside>;
}
