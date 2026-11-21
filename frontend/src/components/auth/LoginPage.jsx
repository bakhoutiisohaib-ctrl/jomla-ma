import { useState } from 'react';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
import { MarketIcon } from '../common/MarketLayout';
import AuthScene from './AuthScene';
export default function LoginPage({
  onLogin,
  onBack,
  onCreateAccount,
  onForgotPassword,
  onBecomeSupplier
}) {
  const l = useLabels();
  const [form, setForm] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await apiRequest('/suppliers/login', {
        method: 'POST',
        body: form,
        token: ''
      });
      setSession(data.token);
      onLogin({
        ...data.supplier,
        _id: data.supplier._id || data.supplier.id
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <AuthScene onBack={onBack} seller={onBecomeSupplier && <>
    <span className="auth-seller-icon"><MarketIcon name="store" /></span>
    <p className="auth-eyebrow">{l('مساحة خاصة للمورد', 'VOTRE ESPACE FOURNISSEUR')}</p>
    <h2>{l('منتجاتك تستحق أن تُكتشف.', 'Vos produits méritent d’être découverts.')}</h2>
    <p>{l('عرّف بتجارتك واستقبل طلبات المشترين من مساحة تجمع أعمالك.', 'Présentez votre activité et recevez les demandes des acheteurs dans un même espace.')}</p>
    <ul><li>{l('أنشئ متجرك وأضف منتجاتك', 'Créez votre boutique et ajoutez vos produits')}</li><li>{l('حدد الكميات وأسعار الجملة', 'Précisez les quantités et les tarifs de gros')}</li><li>{l('تابع الطلبات وعروض الأسعار', 'Suivez les demandes et vos devis')}</li></ul>
    <button type="button" className="auth-seller-cta" onClick={onBecomeSupplier}>{l('ابدأ البيع', 'Devenir fournisseur')}<MarketIcon name="arrow" /></button>
    <small>{l('عندك حساب مورد؟ استعمل نموذج الدخول نفسه.', 'Déjà fournisseur ? Utilisez le formulaire de connexion.')}</small>
  </>}>
    <span className="auth-card-icon"><MarketIcon name="user" /></span>
    <p className="auth-eyebrow">{l('أهلاً بك في سوق الجملة', 'BIENVENUE CHEZ JOMLA')}</p>
    <form onSubmit={submit} aria-busy={busy}>
      <h1>{l('مرحباً بعودتك', 'Heureux de vous retrouver')}</h1>
      <p className="auth-intro">{l('ابدأ رحلة الشراء. اكتشف المنتجات وتواصل مع الموردين.', 'Retrouvez vos produits et échangez avec vos fournisseurs.')}</p>
      <Field label={l('البريد الإلكتروني', 'Adresse e-mail')} type="email" name="email" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={form.email} onChange={e => setForm({
          ...form,
          email: e.target.value
        })} />
      <div className="auth-password"><Field label={l('كلمة المرور', 'Mot de passe')} type={showPassword ? 'text' : 'password'} name="password" dir="ltr" autoComplete="current-password" autoCapitalize="none" spellCheck={false} required value={form.password} onChange={e => setForm({
          ...form,
          password: e.target.value
        })} /><button type="button" aria-pressed={showPassword} aria-label={showPassword ? l('إخفاء كلمة المرور', 'Masquer le mot de passe', 'Hide password') : l('إظهار كلمة المرور', 'Afficher le mot de passe', 'Show password')} onClick={() => setShowPassword(value => !value)}>{showPassword ? l('إخفاء', 'Masquer') : l('إظهار', 'Afficher')}</button></div>
      {onForgotPassword && <button type="button" onClick={onForgotPassword}>{l('نسيت كلمة المرور؟', 'Mot de passe oublié ?', 'Forgot password?')}</button>}
      <Notice error>{error}</Notice><button className="primary auth-submit" disabled={busy}>{busy ? l('جاري الدخول…', 'Connexion…') : l('دخول', 'Se connecter')}<MarketIcon name="arrow" /></button>
    </form>{onCreateAccount && <div className="auth-create"><span>{l('أول زيارة لك؟', 'Première visite ?')}</span><button type="button" onClick={onCreateAccount}>{l('إنشاء حساب', 'Créer un compte')}</button><small>{l('حساب مشتري مهني', 'Un compte acheteur professionnel')}</small></div>}
  </AuthScene>;
}
