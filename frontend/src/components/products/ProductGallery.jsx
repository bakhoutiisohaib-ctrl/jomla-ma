import { useEffect, useRef, useState } from 'react';
import ProtectedImage from '../common/ProtectedImage';
import AtlasDialog from '../common/AtlasDialog';
import FavoriteButton from '../favorites/FavoriteButton';
import { useTranslation } from '../../i18n/LanguageContext';
import { mediaUrl } from '../../api/media';
import { useLabels } from '../../i18n/useLabels';

export default function ProductGallery({ product }) {
  const l = useLabels(), { lang } = useTranslation();
  const touchOrigin = useRef(null), suppressClickUntil = useRef(0);
  const photos = [...new Set([product.imageUrl, ...(Array.isArray(product.images) ? product.images : [])].filter(value => mediaUrl(value)))];
  const [selected, setSelected] = useState(''), [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState(1);
  const current = photos.includes(selected) ? selected : photos[0], index = photos.indexOf(current);
  const imageLabel = product.name + ' · ' + l('الصورة', 'Image') + ' ' + (index + 1);
  useEffect(() => {
    setZoom(1);
    if (!current) { setSelected(''); setExpanded(false); }
  }, [current]);
  function move(delta) {
    if (photos.length < 2) return;
    setSelected(photos[(index + delta + photos.length) % photos.length]);
    setZoom(1);
  }
  function arrowDirection(dx) { return (dx < 0 ? 1 : -1) * (lang === 'ar' ? -1 : 1); }
  function touchStart(event) {
    suppressClickUntil.current = 0;
    const t = event.touches[0];
    touchOrigin.current = event.touches.length === 1 && t ? { x: t.clientX, y: t.clientY, id: t.identifier } : null;
  }
  function touchMove(event) {
    if (event.touches.length !== 1) {
      touchOrigin.current = null;
      suppressClickUntil.current = Date.now() + 600;
    }
  }
  function touchEnd(event) {
    const start = touchOrigin.current;
    touchOrigin.current = null;
    const t = start && Array.from(event.changedTouches).find(t => t.identifier === start.id);
    if (!t || event.touches.length) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 45) suppressClickUntil.current = Date.now() + 600;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) move(arrowDirection(dx));
  }
  function openImage(event) {
    if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      return;
    }
    setZoom(1); setExpanded(true);
  }
  function keyImage(event) {
    if (photos.length > 1 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      move(arrowDirection(event.key === 'ArrowLeft' ? -1 : 1));
    }
  }
  return <section className="atlas-detail-gallery" aria-label={l('صور المنتج', 'Images du produit')}>
    {current ? <>
      <div className="atlas-gallery-frame">
      <button type="button" className="atlas-gallery-main" aria-label={l('تكبير صورة المنتج', 'Agrandir l’image du produit')} onClick={openImage}
        onKeyDown={keyImage} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={() => { touchOrigin.current = null; }}>
        <ProtectedImage value={current} alt={imageLabel} />
        <span className="atlas-gallery-expand">＋ {l('تكبير الصورة', 'Agrandir')}</span>
      </button>
      <FavoriteButton product={product} />
      </div>
      <div className="atlas-gallery-controls">
        {photos.length > 1 && <button type="button" aria-label={l('الصورة السابقة', 'Image précédente')} onClick={() => move(-1)}>{l('السابق', 'Précédente')}</button>}
        <span role="status" dir="ltr" className="atlas-gallery-counter">{index + 1} / {photos.length}</span>
        {photos.length > 1 && <button type="button" aria-label={l('الصورة التالية', 'Image suivante')} onClick={() => move(1)}>{l('التالي', 'Suivante')}</button>}
      </div>
      {photos.length > 1 && <div className="atlas-gallery-thumbnails" aria-label={l('اختيار الصورة', 'Choisir une image')}>
        {photos.map((value, number) => <button type="button" key={value} aria-pressed={value === current} aria-label={l('عرض الصورة ', 'Afficher l’image ') + (number + 1)} onClick={() => { setSelected(value); setZoom(1); }}>
          <ProtectedImage value={value} alt="" loading="lazy" /><span>{number + 1}</span>
        </button>)}
      </div>}
    </> : <p className="atlas-gallery-empty">{l('لا توجد صورة متاحة.', 'Aucune image disponible.')}</p>}
    {expanded && current && <AtlasDialog title={l('صور المنتج', 'Images du produit')} subtitle={product.name} onClose={() => setExpanded(false)}>
      <div className="atlas-zoom-toolbar">
        <button type="button" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.5))}>{l('تكبير', 'Zoom avant')} ＋</button>
        <button type="button" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.5))}>{l('تصغير', 'Zoom arrière')} −</button>
        <button type="button" onClick={() => setZoom(1)}>{l('الحجم الأصلي', 'Réinitialiser')}</button>
        <output aria-live="polite">{zoom * 100}%</output>
      </div>
      <div className="atlas-zoom-viewport" tabIndex="0" aria-label={l('الصورة المكبرة؛ مرّر لاستكشافها', 'Image agrandie ; faites défiler pour l’explorer')}>
        <div className="atlas-zoom-surface" style={{ width: zoom * 100 + '%', height: zoom * 100 + '%' }}><ProtectedImage value={current} alt={imageLabel} /></div>
      </div>
      <div className="atlas-gallery-controls">
        {photos.length > 1 && <button type="button" aria-label={l('الصورة السابقة', 'Image précédente')} onClick={() => move(-1)}>{l('السابق', 'Précédente')}</button>}
        <span role="status" dir="ltr" className="atlas-gallery-counter">{index + 1} / {photos.length}</span>
        {photos.length > 1 && <button type="button" aria-label={l('الصورة التالية', 'Image suivante')} onClick={() => move(1)}>{l('التالي', 'Suivante')}</button>}
      </div>
    </AtlasDialog>}
  </section>;
}
