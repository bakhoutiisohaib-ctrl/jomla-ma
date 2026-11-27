import { useState } from 'react';
import useAccountAttempt from '../auth/useAccountAttempt';
import { getSessionToken } from '../../api/session';
import { apiRequest } from '../../api/config';
import { useLabels, statusLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import ShareLink from '../common/ShareLink';
import { storePath } from '../../navigation';
export default function StoresPanel({
  stores,
  city = '',
  ready = true,
  onChanged
}) {
  const l = useLabels(),
    {
      lang
    } = useTranslation();
  const empty = {
    name: '',
    description: '',
    city,
    address: '',
    phone: '',
    categories: []
  };
  const [form, setForm] = useState(empty),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const attempt = useAccountAttempt();
  async function save(e) {
    e.preventDefault();
    if(!ready || !getSessionToken())return;
    const active=attempt.begin();if(!active)return;
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries(['name', 'description', 'city', 'address', 'phone', 'categories'].map(k => [k, form[k]]));
      const result=await apiRequest(editing ? '/stores/' + editing : '/stores', {
        token:active.token,signal:active.signal,
        method: editing ? 'PUT' : 'POST',
        body
      });
      if(!active.current())return;
      if(!result.store?._id || (editing && result.store._id!==editing))throw new Error(l('تعذر تأكيد حفظ المتجر','Enregistrement non confirmé','Store save not confirmed'));
      setForm(empty);
      setEditing(null);
      setMessage(l('تم حفظ المتجر. النشر متاح بعد اعتماد الإدارة.', 'Boutique enregistrée. La publication nécessite l’approbation de l’administration.'));
      onChanged();
    } catch (e) {
      if(active.current())setError(e.message);
    } finally {
      if(active.finish())setBusy(false);
    }
  }
  async function toggle(store) {
    if(!ready || !getSessionToken() || (!store.isActive && (store.reviewStatus!=='approved' || store.adminSuspended)))return;
    const active=attempt.begin();if(!active)return;
    setBusy(true);
    setError('');
    try {
      const result=await apiRequest('/stores/' + store._id, {
        token:active.token,signal:active.signal,
        method: 'PUT',
        body: {
          isActive: !store.isActive
        }
      });
      if(!active.current())return;
      if(result.store?._id!==store._id || result.store.isActive!==!store.isActive)throw new Error(l('تعذر تأكيد حالة المتجر','État non confirmé','Store status not confirmed'));
      onChanged();
    } catch (e) {
      if(active.current())setError(e.message);
    } finally {
      if(active.finish())setBusy(false);
    }
  }
  return <section className="panel"><h2>{l('متاجر الشركة', 'Boutiques de l’entreprise')}</h2><Notice error>{error}</Notice><Notice>{message}</Notice>
    <p className="supplier-help">{l('اعتماد المتجر من الإدارة يتيح نشر المنتجات. توثيق المورد التجاري اختياري، ولا يشترط لإنشاء متجر أو نشر منتج.', 'L’approbation administrative permet la publication. La vérification commerciale du fournisseur est facultative et n’est requise ni pour créer une boutique ni pour publier.')}</p>
    {!ready && <p role="status">{l('بيانات المتاجر غير مؤكدة. حدّث مساحة العمل قبل التعديل.','Boutiques non confirmées. Actualisez avant de modifier.','Store data is unconfirmed. Refresh the workspace before editing.')}</p>}
    {stores.map(s => <div className="panel" key={s._id}><div className="actions"><strong>{s.name}</strong><span className="badge">{statusLabel(s.reviewStatus, lang)}</span><span>{s.isActive ? l('نشط', 'Active') : l('معطل', 'Inactive')}</span>{s.adminSuspended && <span className="badge amber">{l('معلق من الإدارة', 'Suspendue par l’administration')}</span>}</div><p>{s.city} · {s.description}</p>{s.reviewReason && <p>{s.reviewReason}</p>}<div className="actions"><button disabled={busy || !ready} onClick={() => {
          setForm({
            ...empty,
            ...s
          });
          setEditing(s._id);
        }}>{l('تعديل', 'Modifier')}</button><button disabled={busy || !ready || (!s.isActive && (s.reviewStatus!=='approved' || s.adminSuspended))} onClick={() => toggle(s)}>{s.isActive ? l('تعطيل', 'Désactiver') : l('تفعيل', 'Activer')}</button></div>{s.reviewStatus === 'approved' && s.isActive && !s.adminSuspended && <ShareLink path={storePath(s._id)} />}</div>)}
    <h3>{editing ? l('تعديل المتجر', 'Modifier la boutique') : l('إنشاء متجر', 'Créer une boutique')}</h3><form onSubmit={save}><div className="form-grid">{[['name', l('اسم المتجر', 'Nom de boutique')], ['description', l('الوصف', 'Description')], ['city', l('المدينة', 'Ville')], ['address', l('العنوان', 'Adresse')], ['phone', l('الهاتف', 'Téléphone')]].map(([key, label]) => <Field key={key} label={label} disabled={busy || !ready} required={key === 'name' || key === 'city'} value={form[key] || ''} onChange={e => setForm({
          ...form,
          [key]: e.target.value
        })} />)}</div><div className="actions" style={{
        marginTop: 12
      }}><button className="primary" disabled={busy || !ready}>{l('حفظ المتجر', 'Enregistrer la boutique')}</button>{editing && <button type="button" disabled={busy || !ready} onClick={() => {
          setEditing(null);
          setForm(empty);
        }}>{l('إلغاء', 'Annuler')}</button>}</div></form>
  </section>;
}
