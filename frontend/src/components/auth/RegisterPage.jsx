import { useState } from 'react';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
import AuthScene from './AuthScene';
export default function RegisterPage({
  onBack,
  onRegister,
  onGoLogin,
  initialRole = 'buyer'
}) {
  const l = useLabels();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    city: '',
    organization: '',
    role: ['buyer', 'supplier', 'staff'].includes(initialRole) ? initialRole : 'buyer'
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiRequest('/suppliers/register', {
        method: 'POST',
        body: form,
        token: ''
      });
      setSession(data.token);
      if (onRegister) onRegister({
        ...data.supplier,
        _id: data.supplier._id || data.supplier.id
      });else onBack();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <AuthScene onBack={onBack} registration>
    <p className="auth-eyebrow">{l('خطوتك الأولى مع جملة', 'VOTRE PREMIER PAS AVEC JOMLA')}</p>
    <form onSubmit={submit} aria-busy={busy}><h1>{l('انضم إلى سوق الجملة', 'Rejoignez le marché B2B')}</h1><p className="auth-intro">{form.role === 'supplier' ? l('أنشئ حسابك، ثم جهز شركتك ومتجرك من مساحة المورد.', 'Créez votre compte, puis préparez votre entreprise et votre boutique dans votre espace.') : l('حساب واحد لمتابعة طلباتك وعروض الموردين.', 'Un compte pour suivre vos demandes et les devis des fournisseurs.')}</p><div className="form-grid">
      <Field label={l('نوع الحساب', 'Type de compte')}><select value={form.role} onChange={e => setForm({
              ...form,
              role: e.target.value
            })}>
        <option value="supplier">{l('مورد', 'Fournisseur')}</option><option value="buyer">{l('مشتري مهني', 'Acheteur professionnel')}</option><option value="staff">{l('موظف مورد (يتطلب دعوة)', 'Collaborateur (invitation requise)')}</option>
      </select></Field>
      {[['name', l('الاسم', 'Nom'), 'text', 'name'], ['organization', l('اسم الشركة', 'Entreprise'), 'text', 'organization'], ['email', l('البريد الإلكتروني', 'Adresse e-mail'), 'email', 'email'], ['password', l('كلمة المرور (8 أحرف على الأقل)', 'Mot de passe (8 caractères minimum)'), 'password', 'new-password'], ['phone', l('الهاتف', 'Téléphone'), 'tel', 'tel'], ['city', l('المدينة', 'Ville'), 'text', 'address-level2']].map(([key, label, type, autoComplete]) => <Field key={key} label={label} name={key} type={type} dir={['email', 'password', 'tel'].includes(type) ? 'ltr' : undefined} autoCapitalize={['email', 'password'].includes(type) ? 'none' : undefined} spellCheck={['email', 'password'].includes(type) ? false : undefined} required={key !== 'organization'} minLength={key === 'password' ? 8 : undefined} autoComplete={autoComplete} value={form[key]} onChange={e => setForm({
            ...form,
            [key]: e.target.value
          })} />)}
    </div><Notice error>{error}</Notice><button className="primary auth-submit" disabled={busy}>{busy ? l('جاري إنشاء الحساب…', 'Création du compte…') : l('إنشاء الحساب', 'Créer mon compte')}</button></form>
    {onGoLogin && <div className="auth-create"><span>{l('عندك حساب؟', 'Déjà inscrit ?')}</span><button type="button" onClick={onGoLogin}>{l('دخول الحساب', 'Se connecter')}</button></div>}
  </AuthScene>;
}
