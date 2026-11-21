import { useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels, statusLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import ShareLink from '../common/ShareLink';
import { storePath } from '../../navigation';
export default function StoresPanel({
  stores,
  city = '',
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
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries(['name', 'description', 'city', 'address', 'phone', 'categories'].map(k => [k, form[k]]));
      await apiRequest(editing ? '/stores/' + editing : '/stores', {
        method: editing ? 'PUT' : 'POST',
        body
      });
      setForm(empty);
      setEditing(null);
      setMessage(l('تم حفظ المتجر. النشر متاح بعد اعتماد الإدارة.', 'Boutique enregistrée. La publication nécessite l’approbation de l’administration.'));
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(store) {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/stores/' + store._id, {
        method: 'PUT',
        body: {
          isActive: !store.isActive
        }
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel"><h2>{l('متاجر الشركة', 'Boutiques de l’entreprise')}</h2><Notice error>{error}</Notice><Notice>{message}</Notice>
    <p className="supplier-help">{l('اعتماد المتجر من الإدارة يتيح نشر المنتجات. توثيق المورد التجاري اختياري، ولا يشترط لإنشاء متجر أو نشر منتج.', 'L’approbation administrative permet la publication. La vérification commerciale du fournisseur est facultative et n’est requise ni pour créer une boutique ni pour publier.')}</p>
    {stores.map(s => <div className="panel" key={s._id}><div className="actions"><strong>{s.name}</strong><span className="badge">{statusLabel(s.reviewStatus, lang)}</span><span>{s.isActive ? l('نشط', 'Active') : l('معطل', 'Inactive')}</span>{s.adminSuspended && <span className="badge amber">{l('معلق من الإدارة', 'Suspendue par l’administration')}</span>}</div><p>{s.city} · {s.description}</p>{s.reviewReason && <p>{s.reviewReason}</p>}<div className="actions"><button onClick={() => {
          setForm({
            ...empty,
            ...s
          });
          setEditing(s._id);
        }}>{l('تعديل', 'Modifier')}</button><button disabled={busy} onClick={() => toggle(s)}>{s.isActive ? l('تعطيل', 'Désactiver') : l('تفعيل', 'Activer')}</button></div>{s.reviewStatus === 'approved' && s.isActive && !s.adminSuspended && <ShareLink path={storePath(s._id)} />}</div>)}
    <h3>{editing ? l('تعديل المتجر', 'Modifier la boutique') : l('إنشاء متجر', 'Créer une boutique')}</h3><form onSubmit={save}><div className="form-grid">{[['name', l('اسم المتجر', 'Nom de boutique')], ['description', l('الوصف', 'Description')], ['city', l('المدينة', 'Ville')], ['address', l('العنوان', 'Adresse')], ['phone', l('الهاتف', 'Téléphone')]].map(([key, label]) => <Field key={key} label={label} required={key === 'name' || key === 'city'} value={form[key] || ''} onChange={e => setForm({
          ...form,
          [key]: e.target.value
        })} />)}</div><div className="actions" style={{
        marginTop: 12
      }}><button className="primary" disabled={busy}>{l('حفظ المتجر', 'Enregistrer la boutique')}</button>{editing && <button type="button" onClick={() => {
          setEditing(null);
          setForm(empty);
        }}>{l('إلغاء', 'Annuler')}</button>}</div></form>
  </section>;
}
