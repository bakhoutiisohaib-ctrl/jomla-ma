import { useTranslation } from './LanguageContext';
export default function LanguageSwitch() {
  const { lang, setLang } = useTranslation();
  return <select className="atlas-language-select" aria-label={lang === 'ar' ? 'لغة الواجهة' : lang === 'fr' ? 'Langue de l’interface' : 'Interface language'} value={lang} onChange={event => setLang(event.target.value)}>
    <option value="ar" lang="ar">العربية</option>
    <option value="fr" lang="fr">Français</option>
    <option value="en" lang="en">English</option>
  </select>;
}
