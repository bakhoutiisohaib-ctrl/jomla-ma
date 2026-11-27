import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import useAccountAttempt from './useAccountAttempt';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
import AtlasDialog from '../common/AtlasDialog';

export function BuyerContactForm({ user, token, onDone }) {
  const l = useLabels();
  const [form, setForm] = useState({ name: user.profilePending ? '' : user.name || '', city: user.city || '', phone: user.phone || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useAccountAttempt();
  async function save(event) {
    event.preventDefault(); if (!token || getSessionToken() !== token) return;
    const active = attempt.begin(); if (!active) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest('/suppliers/' + (user._id || user.id), { method: 'PUT', token, body: form, signal: active.signal });
      if (!active.current()) return;
      if (result.supplier?.role !== 'buyer' || (result.supplier._id || result.supplier.id) !== (user._id || user.id) || result.supplier.profilePending !== false) {
        setError(l('لم يكتمل حفظ معلومات التواصل. تحقق منها وأعد المحاولة.', 'Les coordonnées ne sont pas complètes. Vérifiez-les et réessayez.', 'Contact details are incomplete. Check them and try again.'));
        return;
      }
      onDone(result.supplier);
    } catch (e) { if (active.current() && e.name !== 'AbortError') setError(e.message); } finally { if (active.finish()) setBusy(false); }
  }
  return <form onSubmit={save} aria-busy={busy}>
    <p>{l('نحتاج هذه المعلومات للتواصل بخصوص طلبك. الجنس واسم الشركة غير مطلوبين.', 'Ces informations permettent de vous contacter pour votre demande. Le genre et l’entreprise ne sont pas obligatoires.', 'These details let suppliers contact you about your request. Gender and company are not required.')}</p>
    {[['name', l('الاسم', 'Nom', 'Name'), 'text', 'name'], ['city', l('المدينة', 'Ville', 'City'), 'text', 'address-level2'], ['phone', l('هاتف التواصل', 'Téléphone', 'Contact phone'), 'tel', 'tel']].map(([key, label, type, autoComplete]) => <Field key={key} label={label} type={type} disabled={busy} required minLength={key === 'name' ? 2 : undefined} maxLength={key === 'phone' ? 20 : 200} pattern={key === 'phone' ? '[+0-9 ()-]{8,20}' : undefined} autoComplete={autoComplete} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}
    <Notice error>{error}</Notice><button className="primary auth-submit" disabled={busy}>{busy ? l('جارٍ الحفظ…', 'Enregistrement…', 'Saving…') : l('حفظ ومتابعة', 'Enregistrer et continuer', 'Save and continue')}</button>
  </form>;
}

export default function BuyerContactGate({ user, token, children, onClose }) {
  const l = useLabels(), [loaded, setLoaded] = useState(null), [failure, setFailure] = useState(null), [retry, setRetry] = useState(0);
  const liveToken = useSessionToken();
  const needed = user?.role === 'buyer' && user.profilePending === true;
  const id = user?._id || user?.id;
  const scope = token + ':' + (id || '');
  const account = token && token === liveToken && loaded?.scope === scope ? loaded.account : null;
  const error = failure?.scope === scope ? failure.message : '';
  useEffect(() => {
    if (!needed || !token || token !== liveToken) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && getSessionToken() === token;
    setFailure(null);
    apiRequest('/suppliers/me/profile', { token, signal: controller.signal }).then(data => {
      if (!current()) return;
      if (data?.role !== 'buyer' || (data._id || data.id) !== id || typeof data.profilePending !== 'boolean') {
        setFailure({ scope, message: 'PROFILE_MISMATCH' }); return;
      }
      setLoaded({ scope, account: data });
    }).catch(e => { if (current()) setFailure({ scope, message: e.message || 'PROFILE_MISMATCH' }); });
    return () => controller.abort();
  }, [needed, token, liveToken, id, scope, retry]);
  if (!needed) return children(user);
  if (account?.profilePending === false) return children(account);
  return <AtlasDialog title={l('أكمل معلومات التواصل', 'Complétez vos coordonnées', 'Complete your contact details')} onClose={onClose}>
    {token !== liveToken || !token ? <p role="status">{l('تغيرت الجلسة. أغلق النافذة وأعد فتح الطلب.', 'La session a changé. Fermez puis rouvrez la demande.', 'Session changed. Close and reopen the request.')}</p>
      : error ? <><Notice error>{error === 'PROFILE_MISMATCH' ? l('تعذر التحقق من الحساب الحالي.', 'Impossible de vérifier le compte actuel.', 'Unable to verify the current account.') : error}</Notice><button type="button" onClick={() => setRetry(value => value + 1)}>{l('إعادة تحميل الحساب', 'Recharger le compte', 'Reload account')}</button></>
      : account ? <BuyerContactForm key={scope} user={account} token={token} onDone={value => setLoaded({ scope, account: value })} /> : <p role="status">{l('جارٍ تحميل حسابك…', 'Chargement du compte…', 'Loading your account…')}</p>}
  </AtlasDialog>;
}
