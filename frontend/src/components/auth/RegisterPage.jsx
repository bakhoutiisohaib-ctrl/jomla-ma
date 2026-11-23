import { useState } from 'react';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
import { MarketIcon } from '../common/MarketLayout';
import { BuyerContactForm } from './BuyerContactGate';
import AuthScene from './AuthScene';
export default function RegisterPage({ onBack, onRegister, onGoLogin, initialRole = 'buyer' }) {
  const l = useLabels();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '', city: '', organization: '', gender: 'undisclosed', role: ['buyer', 'supplier', 'staff'].includes(initialRole) ? initialRole : 'buyer' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [created, setCreated] = useState(null), [details, setDetails] = useState(false);
  const buyer = form.role === 'buyer';
  function proceed(account) { if (onRegister) onRegister(account, { browse: account.role === 'buyer' }); else onBack(); }
  async function submit(e) {
    e.preventDefault(); if (busy) return; setError('');
    if (form.password !== form.confirmPassword) { setError(l('كلمتا المرور غير متطابقتين', 'Les mots de passe ne correspondent pas', 'Passwords do not match')); return; }
    setBusy(true);
    try {
      const body = buyer ? { role: 'buyer', email: form.email, password: form.password, confirmPassword: form.confirmPassword, gender: form.gender } : form;
      const data = await apiRequest('/suppliers/register', { method: 'POST', body, token: '' });
      setSession(data.token); setForm(previous => ({ ...previous, password: '', confirmPassword: '' }));
      const account = { ...data.supplier, _id: data.supplier._id || data.supplier.id };
      if (buyer) setCreated({ account, token: data.token }); else proceed(account);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (created) return <AuthScene onBack={() => proceed(created.account)} registration>
    <h1>{l('حسابك واجد', 'Votre compte est prêt', 'Your account is ready')}</h1>
    <p>{l('تصفح الآن، وأكمل معلومات التواصل عند أول طلب عرض سعر.', 'Explorez maintenant. Complétez vos coordonnées lors de votre première demande de devis.', 'Browse now and complete your contact details when requesting your first quote.')}</p>
    <div className="auth-onboarding-actions"><button className="primary auth-submit" onClick={() => proceed(created.account)}>{l('استمر للتصفح', 'Continuer à découvrir', 'Continue browsing')}<MarketIcon name="arrow" /></button><button type="button" onClick={() => setDetails(value => !value)}>{l('أكمل معلوماتك (اختياري)', 'Compléter mon profil (facultatif)', 'Complete my details (optional)')}</button></div>
    {details && <BuyerContactForm user={created.account} token={created.token} onDone={proceed} />}
  </AuthScene>;
  const fields = [['email', l('البريد الإلكتروني', 'Adresse e-mail', 'Email'), 'email', 'email'], ['password', l('كلمة المرور (8 أحرف على الأقل)', 'Mot de passe (8 caractères minimum)', 'Password (at least 8 characters)'), 'password', 'new-password'], ['confirmPassword', l('تأكيد كلمة المرور', 'Confirmer le mot de passe', 'Confirm password'), 'password', 'new-password']];
  if (!buyer) fields.unshift(['name', l('الاسم', 'Nom', 'Name'), 'text', 'name'], ['organization', l('اسم الشركة', 'Entreprise', 'Company'), 'text', 'organization']);
  if (!buyer) fields.push(['phone', l('الهاتف', 'Téléphone', 'Phone'), 'tel', 'tel'], ['city', l('المدينة', 'Ville', 'City'), 'text', 'address-level2']);
  return <AuthScene onBack={onBack} registration>
    <form onSubmit={submit} aria-busy={busy}><h1>{l('انضم إلى سوق الجملة', 'Rejoignez le marché B2B', 'Join the wholesale marketplace')}</h1>
    <p className="auth-intro">{buyer ? l('سجّل ببريدك وابدأ التصفح. يمكنك إضافة معلوماتك لاحقاً.', 'Inscrivez-vous avec votre e-mail et commencez à explorer. Ajoutez vos coordonnées plus tard.', 'Sign up with your email and start browsing. Add your details later.') : l('أنشئ حسابك، ثم جهز شركتك ومتجرك من مساحة المورد.', 'Créez votre compte, puis préparez votre entreprise et votre boutique dans votre espace.', 'Create your account, then set up your company and store.')}</p>
    <div className="form-grid">
      <Field label={l('نوع الحساب', 'Type de compte', 'Account type')}><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="buyer">{l('مشتري', 'Acheteur', 'Buyer')}</option><option value="supplier">{l('مورد', 'Fournisseur', 'Supplier')}</option><option value="staff">{l('موظف مورد (يتطلب دعوة)', 'Collaborateur (invitation requise)', 'Staff (invitation required)')}</option></select></Field>
      {fields.map(([key, label, type, autoComplete]) => <Field key={key} label={label} name={key} type={type} dir={['email', 'password', 'tel'].includes(type) ? 'ltr' : undefined} autoCapitalize="none" required={key !== 'organization'} minLength={type === 'password' ? 8 : undefined} autoComplete={autoComplete} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}
      {buyer && <Field label={l('الجنس (اختياري)', 'Genre (facultatif)', 'Gender (optional)')}><select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}><option value="undisclosed">{l('أفضل عدم الإفصاح', 'Je préfère ne pas préciser', 'Prefer not to say')}</option><option value="female">{l('أنثى', 'Femme', 'Female')}</option><option value="male">{l('ذكر', 'Homme', 'Male')}</option></select></Field>}
    </div><Notice error>{error}</Notice><button className="primary auth-submit" disabled={busy}>{busy ? l('جاري إنشاء الحساب…', 'Création du compte…', 'Creating account…') : l('إنشاء الحساب', 'Créer mon compte', 'Create account')}<MarketIcon name="arrow" /></button></form>
    {onGoLogin && <div className="auth-create"><span>{l('عندك حساب؟', 'Déjà inscrit ?', 'Already have an account?')}</span><button type="button" onClick={onGoLogin}>{l('دخول الحساب', 'Se connecter', 'Sign in')}</button></div>}
  </AuthScene>;
}
