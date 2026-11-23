import BrandHomeLink from '../common/BrandHomeLink';
import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useState } from 'react';
import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from '../common/MarketLayout';
import '../../styles/atlas-auth.css';

// Decorative line art only: these routes and parcels do not represent live deliveries.
function ChalkRoutes() {
  return <svg className="auth-chalk" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <g id="chalk-pin"><path d="M0 0C-35-39-21-62 0-62S35-39 0 0Z"/><circle cy="-40" r="8"/></g>
      <g id="chalk-truck"><path d="M0 0h115v65H0zM115 20h35l24 25v20h-59M146 25v24h22M8 9h99M10 58h97M25 0v58M48 0v58M71 0v58M94 0v58"/><circle cx="26" cy="70" r="12"/><circle cx="92" cy="70" r="12"/><circle cx="151" cy="70" r="12"/><path d="M-23 25h14m-22 17h22m-16 17h16"/></g>
      <g id="chalk-box"><path d="m0 0 35-18L70 0v45L35 65 0 45Zm0 0 35 20L70 0M35 20v45M18-9l35 20v15"/></g>
    </defs>
    <g className="chalk-paths" fill="none" stroke="#e8bd75" strokeWidth="1.8" strokeDasharray="3 9" strokeLinecap="round">
      <path d="M-30 700C160 720 280 520 160 380S300 180 515 240 870 130 990 230 1410 130 1490 390"/>
      <path d="M-40 200C180 110 420 190 370 430S300 780 620 740 1090 820 1230 650 1450 520 1490 600"/>
      <path d="M40 850C220 830 120 630 370 640M1010 50c130 90 130 170 90 300s80 170 330 125"/>
    </g>
    <g fill="none" stroke="#edb96f" strokeWidth="2" strokeLinejoin="round">
      <use href="#chalk-pin" x="166" y="380"/><use href="#chalk-pin" x="370" y="640"/><use href="#chalk-pin" x="1097" y="350"/><use href="#chalk-pin" x="1295" y="572"/>
      <circle className="chalk-beacon" cx="166" cy="380" r="14"/><circle className="chalk-beacon chalk-delay" cx="1295" cy="572" r="14"/>
    </g>
    <g fill="none" stroke="#d9e7c9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".8">
      <g transform="translate(65 210) rotate(-8)"><rect width="40" height="70" rx="5"/><path d="M8 9h24M14 61h12M64 15h77v51H64zM54 75h97l-10-9H64Z"/><path d="M8 110v-10a30 30 0 0 1 60 0v10M8 98h12v27H8zM56 98h12v27H56z"/></g>
      <g transform="translate(1160 120) rotate(9)"><path d="m0 20 35-20c5 18 25 18 30 0l35 20-18 32-18-10v95H35V42L18 52ZM35 0q15 17 30 0M40 115h20"/><path d="M117 22q25-13 50 0v109h-50zM117 35h50M130 40v84M148 40v84"/></g>
      <g transform="translate(78 525) rotate(5)"><path d="M10 25V9q0-9 9-9h74q9 0 9 9v16M0 25h22v40H0zm90 0h22v40H90zM22 40h68v25H22zM12 65v14m88-14v14"/><path d="M150 15h40l-8 35h-24Zm20 35v48m-18 0h36M126 113h85"/></g>
      <g transform="translate(1180 600)"><use href="#chalk-box"/><use href="#chalk-box" x="75" y="40"/><use href="#chalk-box" x="3" y="70"/></g>
      <g transform="translate(70 785)"><path d="M0 40h170V0H90v40M10 40V15h40v25M60 40V9h20v31M100 10h10m15 0h10m15 0h10M100 23h10m15 0h10m15 0h10"/></g>
      <g className="chalk-truck" transform="translate(85 730)"><use href="#chalk-truck"/></g>
      <g className="chalk-truck chalk-truck-other" transform="translate(1150 780)"><use href="#chalk-truck"/></g>
      <path d="m300 100 6-10 6 10-6 10Zm1010 640 6-10 6 10-6 10M1300 430h16m-8-8v16M235 480h16m-8-8v16"/>
    </g>
  </svg>;
}

export default function AuthScene({ children, onBack, seller, registration = false }) {
  const l = useLabels();
  const [paused, setPaused] = useState(false);
  return <div className={'atlas-auth' + (registration ? ' auth-registration' : '')} data-motion={paused ? 'paused' : 'playing'}>
    <ChalkRoutes />
    <header className="auth-header">
      <BrandHomeLink className="auth-brand" aria-label={l('Jomla.ma — العودة إلى الموقع', 'Jomla.ma — Retour au site')}><span className="auth-brand-mark">ج</span><span><strong dir="ltr">jomla.ma</strong><small>{l('سوق الجملة المغربي', 'Le marché de gros marocain')}</small></span></BrandHomeLink>
      <nav aria-label={l('اللغة والعودة للموقع', 'Langue et retour au site')}><LanguageSwitch /><button type="button" onClick={onBack}><MarketIcon name="arrow" />{l('العودة إلى الموقع', 'Retour au site')}</button></nav>
    </header>
    <main className="auth-stage" id="auth-main">
      <section className="auth-card">{children}</section>
      {seller && <aside className="auth-seller">{seller}</aside>}
    </main>
    <footer className="auth-footer"><span>{l('منتجات وكميات واضحة. تواصل مباشر داخل المنصة.', 'Des produits, des quantités claires. Un échange direct sur la plateforme.')}</span><button type="button" className="auth-motion" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? l('تشغيل حركة الخلفية', 'Animer le fond') : l('إيقاف حركة الخلفية', 'Mettre le fond en pause')}</button></footer>
  </div>;
}
