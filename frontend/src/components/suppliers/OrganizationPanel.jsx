import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionToken, useSessionToken } from '../../api/session';
import useAccountAttempt from '../auth/useAccountAttempt';
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
  const [declareCountry,setDeclareCountry]=useState(false);
  const profileOwner=profile.ownerId||profile._id;
  const fallback=useRef(null);fallback.current={name:profile.organization||profile.name,city:profile.city||'',description:'',country:'MA'};
  const countryCode=typeof organization.country==='string'?organization.country.toUpperCase():'';
  const validCountry=/^[A-Z]{2}$/.test(countryCode);
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
  const session = useSessionToken(), attempt = useAccountAttempt();
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  const load = useCallback(async (auth, signal, current) => {
    const [org, inv] = await Promise.all([
      apiRequest('/suppliers/me/organization',{token:auth,signal,cache:'no-store'}),
      apiRequest('/suppliers/me/staff-invitations',{token:auth,signal,cache:'no-store'})
    ]);
    if (!current()) return false;
    if (!Array.isArray(org.memberships) || !Array.isArray(inv.data)) throw new Error('Invalid company data');
    if (org.organization) {
      if(typeof org.organization._id!=='string'||(profile.role==='supplier'&&org.organization.ownerSupplierId!==profileOwner))throw Error('Invalid company identity');
      setOrganization(org.organization);
      setDeclareCountry(typeof org.organization.country==='string'&&/^[A-Z]{2}$/.test(org.organization.country)&&org.organization.declaredCountry===org.organization.country);
    } else {setOrganization(fallback.current);setDeclareCountry(false);}
    setMembers(org.memberships);
    setInvitations(inv.data);
    setReady(true);
    return org;
  }, [profile.role,profileOwner]);
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && session === getSessionToken();
    setReady(false);setDeclareCountry(false);setMembers([]);setInvitations([]);setToken('');setTokens({});setError('');setMessage('');
    if (session) load(session,controller.signal,current).catch(e=>{if(current())setError(e.message);});
    return () => controller.abort();
  }, [load,session,retry]);
  async function action(callback) {
    if (!ready || !session || session !== getSessionToken()) return;
    const active = attempt.begin(); if (!active) return;
    setBusy(true);setError('');setMessage('');setToken('');
    const request = (path,options) => apiRequest(path,{...options,token:active.token,signal:active.signal});
    try {
      const result = await callback(request);
      if (!active.current()) return;
      if(result?.verifyCompany){
        setReady(false);const fresh=await load(active.token,active.signal,active.current);
        if(!active.current())return;
        if(!fresh||!result.verifyCompany(fresh.organization))throw Error(result.unconfirmed);
        setMessage(result.message);onChanged?.();return;
      }
      if (result?.acceptanceToken) setToken(result.acceptanceToken);
      if (result?.message) setMessage(result.message);
      onChanged?.();
      setReady(false);
      await load(active.token,active.signal,active.current);
    } catch (e) {
      if (active.current()) {setReady(false);setError(e.message);}
    } finally {
      if (active.finish()) setBusy(false);
    }
  }
  return <section className="panel"><h2>{l('الشركة وعضويات الفريق', 'Entreprise et collaborateurs')}</h2><Notice error>{error}</Notice><Notice>{message}</Notice>
    {!ready && <p role="status">{l('بيانات الشركة غير مؤكدة. أعد تحميلها قبل التعديل.','Données non confirmées. Rechargez avant de modifier.','Company data is unconfirmed. Reload before editing.')}</p>}{!ready && <button type="button" disabled={busy} onClick={()=>setRetry(n=>n+1)}>{l('إعادة تحميل الشركة','Recharger l’entreprise','Reload company')}</button>}
    {profile.role === 'supplier' ? <>
      <form onSubmit={e => {
        e.preventDefault();
        action(async request => {
          const body = Object.fromEntries(['name', 'city', 'country', 'description'].map(k => [k, organization[k] || '']));
          body.country=countryCode;body.declareCountry=declareCountry;
          if(declareCountry&&!validCountry)throw Error(l('رمز البلد غير صالح','Code pays invalide','Invalid country code'));
          const saved=await request('/suppliers/me/organization', {method:'PUT',body});
          const o=saved?.organization;
          const unconfirmed=l('تعذر تأكيد حفظ تصريح البلد. أعد تحميل الشركة.','Déclaration non confirmée. Rechargez l’entreprise.','Country declaration not confirmed. Reload company.');
          const matches=c=>c&&typeof c._id==='string'&&(!organization._id||c._id===organization._id)&&c.ownerSupplierId===profileOwner&&c.country===body.country&&(declareCountry?c.declaredCountry===body.country:c.declaredCountry==null);
          if(!matches(o))throw Error(unconfirmed);
          return {message:l('تم حفظ ملف الشركة', 'Entreprise enregistrée','Company saved'),verifyCompany:c=>matches(c)&&c._id===o._id,unconfirmed};
        });
      }}>
        <div className="form-grid">{[['name', l('اسم الشركة', 'Raison sociale')], ['city', l('المدينة', 'Ville')], ['country', l('رمز البلد', 'Pays (code)')], ['description', l('وصف الشركة', 'Présentation')]].map(([k, label]) => <Field key={k} label={label} disabled={busy || !ready} value={organization[k] || ''} required={k === 'name'} onChange={e => {if(k==='country'&&e.target.value.toUpperCase()!==countryCode)setDeclareCountry(false);setOrganization({...organization,[k]:e.target.value});}} />)}</div><label className="check"><input type="checkbox" checked={declareCountry} disabled={busy||!ready||!validCountry} onChange={e=>setDeclareCountry(e.target.checked)}/>{l('أصرح بأن هذا هو بلد مقر شركتي','Je déclare le pays de mon entreprise','I declare this as my company’s country')}</label><p className="muted">{l('اختياري. يتيح ظهور شركتك في فلتر البلد بناءً على تصريحك، وليس توثيقاً للموقع. يمكنك إلغاء التصريح ثم الحفظ.','Facultatif. Ce filtre repose sur votre déclaration, sans vérification de localisation. Décochez puis enregistrez pour retirer la déclaration.','Optional. The country filter uses your declaration, not verified location. Uncheck and save to withdraw.')}</p><button className="primary" disabled={busy || !ready || (countryCode!==''&&!validCountry) || (declareCountry&&!validCountry)} style={{
          marginTop: 12
        }}>{l('حفظ الشركة', 'Enregistrer l’entreprise')}</button>
      </form><BusinessTypeEditor onChanged={onChanged}/><hr /><h3>{l('دعوة موظف', 'Inviter un collaborateur')}</h3><form onSubmit={e => {
        e.preventDefault();
        action(async request => {
          const data = await request('/suppliers/me/staff-invitations', {
            method: 'POST',
            body: {
              email,
              permissions
            }
          });
          if (!/^[a-f0-9]{64}$/.test(data.acceptanceToken || '')) throw new Error(l('تعذر تأكيد رمز الدعوة','Code d’invitation non confirmé','Invitation code not confirmed'));
          return {acceptanceToken:data.acceptanceToken,message:l('أنشئت الدعوة. شارك الرمز مع الموظف عبر وسيلة موثوقة. لم يرسل بريد.', 'Invitation créée. Transmettez le code au collaborateur par un canal de confiance. Aucun e-mail envoyé.')};
        });
      }}>
        <Field label={l('بريد الموظف', 'E-mail du collaborateur')} type="email" disabled={busy || !ready} value={email} required onChange={e => setEmail(e.target.value)} />
        {options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" disabled={busy || !ready} checked={permissions.includes(key)} onChange={e => setPermissions(p => e.target.checked ? [...p, key] : p.filter(v => v !== key))} />{label}</label>)}<button disabled={busy || !ready}>{l('إنشاء الدعوة', 'Créer l’invitation')}</button>
      </form>{token && session === getSessionToken() && <Notice><strong>{l('رمز قبول الدعوة (يظهر الآن فقط)', 'Code d’acceptation (affiché uniquement maintenant)')}</strong><code style={{
          display: 'block',
          overflowWrap: 'anywhere',
          direction: 'ltr'
        }}>{token}</code></Notice>}
      <h3 style={{
        marginTop: 20
      }}>{l('العضويات', 'Membres')}</h3>{members.map(m => <div className="panel" key={m._id}><strong>{m.userId?.name || m.invitedEmail}</strong><p>{statusLabel(m.status, lang)} · {m.permissions?.map(p => options.find(([key]) => key === p)?.[1] || p).join('، ')}</p>{m.role === 'staff' && m.status === 'active' && <div className="actions">{options.map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={m.permissions?.includes(key) || false} disabled={busy || !ready} onChange={e => action(request => request('/suppliers/me/memberships/' + m._id, {
              method: 'PATCH',
              body: {
                permissions: e.target.checked ? [...m.permissions, key] : m.permissions.filter(p => p !== key)
              }
            }))} />{label}</label>)}<button className="danger" disabled={busy || !ready} onClick={() => action(request => request('/suppliers/me/memberships/' + m._id, {
            method: 'PATCH',
            body: {
              status: 'revoked'
            }
          }))}>{l('سحب العضوية', 'Révoquer l’accès')}</button></div>}</div>)}
    </> : <><p>{organization.name}</p><p className="muted">{l('صلاحياتك يحددها مالك الشركة. لقبول دعوة، أدخل الرمز الذي شاركه معك.', 'Vos droits sont définis par le propriétaire. Saisissez le code reçu pour accepter une invitation.')}</p>{invitations.map(inv => <form className="panel" key={inv._id} onSubmit={e => {
        e.preventDefault();
        action(async request => {
          await request('/suppliers/me/staff-invitations/' + inv._id + '/accept', {
            method: 'POST',
            body: {
              token: tokens[inv._id] || ''
            }
          });
          return {message:l('تم قبول الدعوة وتحديث الصلاحيات', 'Invitation acceptée, droits actualisés')};
        });
      }}><h3>{inv.organizationId?.name}</h3><Field label={l('رمز الدعوة', 'Code d’invitation')} required disabled={busy || !ready} value={tokens[inv._id] || ''} onChange={e => setTokens({
          ...tokens,
          [inv._id]: e.target.value
        })} /><button disabled={busy || !ready}>{l('قبول العضوية', 'Accepter l’invitation')}</button></form>)}</>}
  </section>;
}
