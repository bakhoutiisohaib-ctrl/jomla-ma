import BrandHomeLink from './BrandHomeLink';
import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useLabels } from '../../i18n/useLabels';
export function WorkspaceHeader({
  title,
  onBack,
  onLogout,
  children
}) {
const l = useLabels();
  return <header className="workspace-header"><div className="header-inner">
    <div><BrandHomeLink><strong>🇲🇦 Jomla.ma</strong></BrandHomeLink><span className="header-title">{title}</span></div>
    <nav className="actions" aria-label={l('التنقل', 'Navigation')}>
      {children}
      <LanguageSwitch />
      {onBack && <button onClick={onBack}>{l('السوق', 'Catalogue')}</button>}
      {onLogout && <button onClick={onLogout}>{l('خروج', 'Déconnexion')}</button>}
    </nav>
  </div></header>;
}
export function Field({
  label,
  children,
  ...props
}) {
  return <label className="field"><span>{label}</span>{children || <input {...props} />}</label>;
}
export function Notice({
  children,
  error = false
}) {
  return children ? <p className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{children}</p> : null;
}
