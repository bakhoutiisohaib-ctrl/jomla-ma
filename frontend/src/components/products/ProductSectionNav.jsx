import { useEffect, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';

const sections = ['product-overview', 'product-details', 'product-discover'];
function selectedSection() {
  const id = window.location.hash.slice(1);
  if (id === 'product-description' || id === 'product-reviews') return 'product-details';
  return sections.includes(id) ? id : 'product-overview';
}

// These are in-page destinations, not mutually exclusive tab panels.
// Keep native fragment history, keyboard links and all content available.
export default function ProductSectionNav() {
  const l = useLabels();
  const [selected, setSelected] = useState(selectedSection);
  useEffect(() => {
    function sync() { setSelected(selectedSection()); }
    window.addEventListener('hashchange', sync);
    // The product is fetched asynchronously; a direct fragment may have
    // been resolved before its section existed.
    const id = window.location.hash.slice(1);
    if ([...sections, 'product-description', 'product-reviews'].includes(id)) {
      document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
    }
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const labels = [
    l('نظرة عامة', 'Aperçu', 'Overview'),
    l('التفاصيل', 'Détails', 'Details'),
    l('مقترحات', 'Similaires', 'Recommended')
  ];
  return <nav className="atlas-detail-section-nav atlas-detail-section-nav-top" aria-label={l('أقسام المنتج', 'Sections du produit', 'Product sections')}>
    {sections.map((id, index) => <a key={id} href={'#' + id} aria-current={selected === id ? 'location' : undefined}>{labels[index]}</a>)}
  </nav>;
}
