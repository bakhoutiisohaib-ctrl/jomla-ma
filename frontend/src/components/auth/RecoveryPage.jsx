import { useEffect, useState } from 'react';
import { apiRequest, clearSession } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import AuthScene from './AuthScene';

export default function RecoveryPage({ reset = false, onBack, onLogin, onRequest }) {
  const l = useLabels(), { lang } = useTranslation();
  const [token] = useState(() => reset ? new URLSearchParams(window.location.hash.slice(1)).get('token') || '' : '');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    // Fragments are not sent to servers; remove the bearer secret from browser history too.
    if (reset && window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, [reset]);
  const badLink = reset && !/^[a-f0-9]{64}$/.test(token);
  const messages = {
    RECOVERY_LINK_INVALID: l('رابط الاسترجاع غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.', 'Lien invalide ou expiré. Demandez un nouveau lien.', 'This link is invalid or expired. Request a new link.'),
    RECOVERY_UNAVAILABLE: l('استرجاع الحساب غير متاح حالياً. أعد المحاولة لاحقاً.', 'La récupération est indisponible pour le moment. Réessayez plus tard.', 'Account recovery is currently unavailable. Try again later.'),
    RECOVERY_RATE_LIMITED: l('طلبات كثيرة. انتظر قليلاً قبل المحاولة.', 'Trop de demandes. Patientez avant de réessayer.', 'Too many requests. Please wait before trying again.'),
    RECOVERY_PASSWORD_INVALID: l('استعمل 8 أحرف على الأقل، وبحد أقصى 72 بايت.', 'Utilisez au moins 8 caractères et au maximum 72 octets.', 'Use at least 8 characters and at most 72 bytes.')
  };
  async function submit(event) {
    event.preventDefault(); setError('');
    if (reset && password !== confirmation) { setError(l('كلمتا المرور غير متطابقتين.', 'Les mots de passe ne correspondent pas.', 'The passwords do not match.')); return; }
    setBusy(true);
    try {
      await apiRequest('/account-recovery/' + (reset ? 'reset' : 'request'), { method: 'POST', token: '',
        body: reset ? { token, password, language: lang } : { email, language: lang } });
      if (reset) clearSession();
      setPassword(''); setConfirmation(''); setDone(true);
    } catch (e) { setError(messages[e.data?.code] || (e.status === 429 ? messages.RECOVERY_RATE_LIMITED : e.message)); }
    finally { setBusy(false); }
  }
  return <AuthScene onBack={onBack}>
    <h1>{reset ? l('كلمة مرور جديدة', 'Nouveau mot de passe', 'New password') : l('استرجاع حسابك', 'Récupérer votre compte', 'Recover your account')}</h1>
    {done ? <Notice>{reset
      ? l('تم تغيير كلمة المرور وإلغاء الجلسات السابقة. سجّل الدخول من جديد.', 'Mot de passe modifié et anciennes sessions révoquées. Reconnectez-vous.', 'Your password was changed and previous sessions were revoked. Sign in again.')
      : l('إذا كان الحساب مؤهلاً، ستصلك تعليمات الاسترجاع. تحقق من بريدك والرسائل غير المرغوب فيها.', 'Si le compte est éligible, vous recevrez les instructions. Vérifiez votre boîte mail et les indésirables.', 'If the account is eligible, recovery instructions will be sent. Check your inbox and spam folder.')}</Notice>
      : badLink ? <Notice error>{messages.RECOVERY_LINK_INVALID}</Notice> : <form onSubmit={submit} aria-busy={busy}>
        <p className="auth-intro">{reset ? l('اختر كلمة مرور جديدة لحسابك.', 'Choisissez un nouveau mot de passe.', 'Choose a new password for your account.') : l('أدخل البريد المرتبط بحسابك.', 'Saisissez l’adresse liée à votre compte.', 'Enter the email address linked to your account.')}</p>
        {reset ? <>
          <Field label={l('كلمة المرور الجديدة', 'Nouveau mot de passe', 'New password')} type="password" name="newPassword" autoComplete="new-password" dir="ltr" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
          <Field label={l('تأكيد كلمة المرور', 'Confirmer le mot de passe', 'Confirm password')} type="password" name="confirmPassword" autoComplete="new-password" dir="ltr" required minLength={8} value={confirmation} onChange={e => setConfirmation(e.target.value)} />
        </> : <Field label={l('البريد الإلكتروني', 'Adresse e-mail', 'Email address')} type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} dir="ltr" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} />}
        <Notice error>{error}</Notice>
        <button className="primary auth-submit" disabled={busy}>{busy ? l('جاري المعالجة…', 'Traitement…', 'Working…') : reset ? l('حفظ كلمة المرور', 'Enregistrer le mot de passe', 'Save password') : l('طلب رابط الاسترجاع', 'Demander un lien', 'Request recovery link')}</button>
      </form>}
    {reset && !done && <button type="button" onClick={onRequest}>{l('طلب رابط جديد', 'Demander un nouveau lien', 'Request a new link')}</button>}
    <div className="auth-create"><button type="button" onClick={onLogin}>{l('العودة للدخول', 'Retour à la connexion', 'Back to sign in')}</button></div>
  </AuthScene>;
}
