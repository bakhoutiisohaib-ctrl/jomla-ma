import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { BusinessTypeChoices, canonicalTypes, validTypes } from '../common/BusinessTypes';
import { Notice } from '../common/WorkspaceUI';

export default function BusinessTypeEditor({ onChanged }) {
  const l = useLabels(), token = useSessionToken();
  const [data, setData] = useState(null), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const current = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    setData(null); setBusy(true); setError(''); setSaved(false);
    apiRequest('/suppliers/me/profile', { token, signal: controller.signal, cache: 'no-store' }).then(profile => {
      if (controller.signal.aborted || token !== getSessionToken()) return;
      if (profile.role !== 'supplier' || !validTypes(profile.businessTypes ?? [])) throw new Error('Invalid profile');
      setData({ token, values: canonicalTypes(profile.businessTypes) });
    }).catch(() => {
      if (!controller.signal.aborted && token === getSessionToken()) setError('load');
    }).finally(() => { if (!controller.signal.aborted && token === getSessionToken()) setBusy(false); });
    return () => controller.abort();
  }, [token, revision]);
  async function submit(e) {
    e.preventDefault();
    if (busy || !data || data.token !== token || token !== getSessionToken()) return;
    const controller = current.current;
    setBusy(true); setError(''); setSaved(false);
    try {
      const response = await apiRequest('/suppliers/me/business-types', { token, signal: controller.signal, method: 'PUT', body: { businessTypes: data.values } });
      if (controller.signal.aborted || token !== getSessionToken()) return;
      if (!validTypes(response.businessTypes) || JSON.stringify(canonicalTypes(response.businessTypes)) !== JSON.stringify(data.values)) throw new Error('Unconfirmed declaration');
      setSaved(true); onChanged?.();
    } catch {
      if (!controller.signal.aborted && token === getSessionToken()) { setData(null); setError('save'); }
    } finally {
      if (!controller.signal.aborted && token === getSessionToken()) setBusy(false);
    }
  }
  return <form className="atlas-business-editor" onSubmit={submit} aria-busy={busy}>
    {data?.token === token && <><BusinessTypeChoices values={data.values} disabled={busy} onChange={values => { setSaved(false); setData({ token, values }); }}/><button type="submit" disabled={busy}>{l('حفظ النشاط التجاري', 'Enregistrer l’activité', 'Save business activity')}</button></>}
    {busy && <Notice>{l('جاري التحقق…', 'Vérification…', 'Checking…')}</Notice>}
    {saved && data?.token === token && <Notice>{l('تم حفظ النشاط التجاري', 'Activité enregistrée', 'Business activity saved')}</Notice>}
    {error && <><Notice error>{error === 'save' ? l('تعذر تأكيد الحفظ. أعد تحميل التصريح للتحقق.', 'Enregistrement non confirmé. Rechargez la déclaration.', 'Save not confirmed. Reload the declaration.') : l('تعذر تحميل النشاط التجاري.', 'Impossible de charger l’activité.', 'Unable to load business activity.')}</Notice><button type="button" onClick={() => setRevision(n => n + 1)}>{l('إعادة تحميل النشاط', 'Recharger l’activité', 'Reload activity')}</button></>}
  </form>;
}
