import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
import AtlasDialog from '../common/AtlasDialog';

export function BuyerContactForm({ user, token, onDone }) {
  const l = useLabels();
  const [form, setForm] = useState({ name: user.profilePending ? '' : user.name || '', city: user.city || '', phone: user.phone || '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const result = await apiRequest('/suppliers/' + (user._id || user.id), { method: 'PUT', token, body: form });
      if (getSessionToken() === token) onDone(result.supplier);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <form onSubmit={save} aria-busy={busy}>
    <p>{l('نحتاج هذه المعلومات للتواصل بخصوص طلبك. الجنس واسم الشركة غير مطلوبين.', 'Ces informations permettent de vous contacter pour votre demande. Le genre et l’entreprise ne sont pas obligatoires.', 'These details let suppliers contact you about your request. Gender and company are not required.')}</p>
    {[['name', l('الاسم', 'Nom', 'Name'), 'text', 'name'], ['city', l('المدينة', 'Ville', 'City'), 'text', 'address-level2'], ['phone', l('هاتف التواصل', 'Téléphone', 'Contact phone'), 'tel', 'tel']].map(([key, label, type, autoComplete]) => <Field key={key} label={label} type={type} required minLength={key === 'name' ? 2 : undefined} maxLength={key === 'phone' ? 20 : 200} pattern={key === 'phone' ? '[+0-9 ()-]{8,20}' : undefined} autoComplete={autoComplete} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />)}
    <Notice error>{error}</Notice><button className="primary auth-submit" disabled={busy}>{busy ? l('جارٍ الحفظ…', 'Enregistrement…', 'Saving…') : l('حفظ ومتابعة', 'Enregistrer et continuer', 'Save and continue')}</button>
  </form>;
}

export default function BuyerContactGate({ user, token, children, onClose }) {
  const l = useLabels(), [account, setAccount] = useState(null), [error, setError] = useState('');
  const needed = user?.role === 'buyer' && user.profilePending === true;
  useEffect(() => {
    if (!needed || !token) return;
    const controller = new AbortController();
    apiRequest('/suppliers/me/profile', { token, signal: controller.signal }).then(data => { if (!controller.signal.aborted) setAccount(data); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [needed, token]);
  if (!needed || account?.profilePending === false) return children(account || user);
  return <AtlasDialog title={l('أكمل معلومات التواصل', 'Complétez vos coordonnées', 'Complete your contact details')} onClose={onClose}>
    <Notice error>{error}</Notice>
    {account ? <BuyerContactForm user={account} token={token} onDone={setAccount} /> : <p>{l('جارٍ تحميل حسابك…', 'Chargement du compte…', 'Loading your account…')}</p>}
  </AtlasDialog>;
}
