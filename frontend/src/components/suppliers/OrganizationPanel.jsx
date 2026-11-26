import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels, statusLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import BusinessTypeEditor from './BusinessTypeEditor';
export default function OrganizationPanel({
  profile,
  onChanged
}) {
  const l = useLabels(),
    {
      lang
    } = useTranslation();
  const [organization, setOrganization] = useState({
    name: profile.organization || profile.name,
    city: profile.city || '',
    description: '',
    country: 'MA'
  });
  const [members, setMembers] = useState([]),
    [invitations, setInvitations] = useState([]),
    [token, setToken] = useState('');
  const [email, setEmail] = useState(''),
    [permissions, setPermissions] = useState([]),
    [tokens, setTokens] = useState({});
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const options = [['manage_products', l('إدارة المنتجات', 'Gérer les produits')], ['manage_store', l('إدارة المتجر', 'Gérer la boutique')], ['manage_rfq', l('عروض الأسعار والمراسلات', 'Devis et messagerie')]];
  const load = useCallback(async () => {
    try {
      const [org, inv] = await Promise.all([apiRequest('/suppliers/me/organization'), apiRequest('/suppliers/me/staff-invitations')]);
      if (org.organization) setOrganization(org.organization);
      setMembers(org.memberships || []);
      setInvitations(inv.data || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  async function action(callback) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await callback();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel"><h2>{l('الشركة وعضويات الفريق', 'Entreprise et collaborateurs')}</h2><Notice error>{error}</Notice><Notice>{message}</Notice>
    {profile.role === 'supplier' ? <>
      <form onSubmit={e => {
        e.preventDefault();
        action(async () => {
          const body = Object.fromEntries(['name', 'city', 'country', 'description'].map(k => [k, organization[k] || '']));
          await apiRequest('/suppliers/me/organization', {
            method: 'PUT',
            body
          });
          setMessage(l('تم حفظ ملف الشركة', 'Entreprise enregistrée'));
        });
      }}>
        <div className="form-grid">{[['name', l('اسم الشركة', 'Raison sociale')], ['city', l('المدينة', 'Ville')], ['country', l('رمز البلد', 'Pays (code)')], ['description', l('وصف الشركة', 'Présentation')]].map(([k, label]) => <Field key={k} label={label} value={organization[k] || ''} required={k === 'name'} onChange={e => setOrganization({
            ...organization,
            [k]: e.target.value
          })} />)}</div><button className="primary" disabled={busy} style={{
          marginTop: 12
        }}>{l('حفظ الشركة', 'Enregistrer l’entreprise')}</button>
      </form><BusinessTypeEditor onChanged={onChanged}/><hr /><h3>{l('دعوة موظف', 'Inviter un collaborateur')}</h3><form onSubmit={e => {
        e.preventDefault();
        action(async () => {
          const data = await apiRequest('/suppliers/me/staff-invitations', {
            method: 'POST',
            body: {
              email,
              permissions
            }
          });
          setToken(data.acceptanceToken);
          setMessage(l('أنشئت الدعوة. شارك الرمز مع الموظف عبر وسيلة موثوقة. لم يرسل بريد.', 'Invitation créée. Transmettez le code au collaborateur par un canal de confiance. Aucun e-mail envoyé.'));
        });
      }}>
        <Field label={l('بريد الموظف', 'E-mail du collaborateur')} type="email" value={email} required onChange={e => setEmail(e.target.value)} />
        {options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={permissions.includes(key)} onChange={e => setPermissions(p => e.target.checked ? [...p, key] : p.filter(v => v !== key))} />{label}</label>)}<button disabled={busy}>{l('إنشاء الدعوة', 'Créer l’invitation')}</button>
      </form>{token && <Notice><strong>{l('رمز قبول الدعوة (يظهر الآن فقط)', 'Code d’acceptation (affiché uniquement maintenant)')}</strong><code style={{
          display: 'block',
          overflowWrap: 'anywhere',
          direction: 'ltr'
        }}>{token}</code></Notice>}
      <h3 style={{
        marginTop: 20
      }}>{l('العضويات', 'Membres')}</h3>{members.map(m => <div className="panel" key={m._id}><strong>{m.userId?.name || m.invitedEmail}</strong><p>{statusLabel(m.status, lang)} · {m.permissions?.map(p => options.find(([key]) => key === p)?.[1] || p).join('، ')}</p>{m.role === 'staff' && m.status === 'active' && <div className="actions">{options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={m.permissions?.includes(key) || false} disabled={busy} onChange={e => action(() => apiRequest('/suppliers/me/memberships/' + m._id, {
              method: 'PATCH',
              body: {
                permissions: e.target.checked ? [...m.permissions, key] : m.permissions.filter(p => p !== key)
              }
            }))} />{label}</label>)}<button className="danger" disabled={busy} onClick={() => action(() => apiRequest('/suppliers/me/memberships/' + m._id, {
            method: 'PATCH',
            body: {
              status: 'revoked'
            }
          }))}>{l('سحب العضوية', 'Révoquer l’accès')}</button></div>}</div>)}
    </> : <><p>{organization.name}</p><p className="muted">{l('صلاحياتك يحددها مالك الشركة. لقبول دعوة، أدخل الرمز الذي شاركه معك.', 'Vos droits sont définis par le propriétaire. Saisissez le code reçu pour accepter une invitation.')}</p>{invitations.map(inv => <form className="panel" key={inv._id} onSubmit={e => {
        e.preventDefault();
        action(async () => {
          await apiRequest('/suppliers/me/staff-invitations/' + inv._id + '/accept', {
            method: 'POST',
            body: {
              token: tokens[inv._id] || ''
            }
          });
          setMessage(l('تم قبول الدعوة وتحديث الصلاحيات', 'Invitation acceptée, droits actualisés'));
        });
      }}><h3>{inv.organizationId?.name}</h3><Field label={l('رمز الدعوة', 'Code d’invitation')} required value={tokens[inv._id] || ''} onChange={e => setTokens({
          ...tokens,
          [inv._id]: e.target.value
        })} /><button disabled={busy}>{l('قبول العضوية', 'Accepter l’invitation')}</button></form>)}</>}
  </section>;
}
