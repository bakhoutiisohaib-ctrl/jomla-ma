import { useRef, useState } from 'react';
import { useLabels } from '../../i18n/useLabels';

export default function ShareLink({ path }) {
  const l = useLabels(), input = useRef(null);
  const [message, setMessage] = useState('');
  const url = new URL(path, window.location.origin).href;
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setMessage(l('تم نسخ الرابط.', 'Lien copié.'));
    } catch {
      input.current?.focus(); input.current?.select();
      setMessage(l('انسخ الرابط المحدد من الحقل.', 'Copiez le lien sélectionné dans le champ.'));
    }
  }
  return <div className="share-link">
    <label>{l('رابط المشاركة', 'Lien à partager')}<input ref={input} readOnly value={url} dir="ltr" /></label>
    <div className="actions"><button type="button" onClick={copy}>{l('نسخ الرابط', 'Copier le lien')}</button>
      <a href={url} target="_blank" rel="noopener noreferrer">{l('فتح في تبويب جديد', 'Ouvrir dans un nouvel onglet')}</a></div>
    {message && <p role="status">{message}</p>}
  </div>;
}
