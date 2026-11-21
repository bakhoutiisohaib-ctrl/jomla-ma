import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useEffect, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from '../common/MarketLayout';
import '../../styles/atlas-supplier.css';

export function SupplierHeader({ profile, unread, onNotifications, onBack, onLogout, children }) {
  const l = useLabels();
  return <><a className="supplier-skip" href="#supplier-main">{l('تجاوز إلى المحتوى','Aller au contenu')}</a>
    <header className="supplier-header"><div className="supplier-brand"><span>ج</span><div><strong dir="ltr">jomla.ma</strong><small>{l('مساحة المورد','Espace fournisseur')}</small></div></div>
      <nav aria-label={l('الحساب واللغة','Compte et langue')}><button onClick={onBack}>{l('السوق','Catalogue')}</button><LanguageSwitch /><button className="supplier-bell" onClick={onNotifications} aria-label={l('تنبيهات الحساب','Alertes du compte')+': '+unread}><MarketIcon name="bell" />{unread>0 && <span>{unread>99?'99+':unread}</span>}</button>{children}<button onClick={onLogout}>{l('خروج','Déconnexion')}</button></nav>
      <p className="supplier-account-name">{profile.name}</p>
    </header></>;
}

export function SupplierSidebar({ tabs, tab, onTab }) {
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
    <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>{l('أقسام المورد','Espace fournisseur')}: {tabs.find(([key])=>key===tab)?.[1]}</summary><nav aria-label={l('أقسام المورد','Espace fournisseur')}>{tabs.filter(([,,allowed])=>allowed).map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>{onTab(key);if(window.innerWidth<=700)setExpanded(false);}}><span className={'supplier-nav-dot '+(key==='add'?'supplier-nav-add':'')} aria-hidden="true">{key==='add'?'+':'›'}</span>{label}</button>)}</nav></details>
    <p className="supplier-sidebar-note">{l('متجر معتمد للنشر. توثيق تجاري اختياري.', 'Boutique approuvée pour publier. Vérification commerciale facultative.')}</p>
  </aside>;
}
