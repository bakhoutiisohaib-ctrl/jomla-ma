import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels, statusLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import VerificationRecovery from '../common/VerificationRecovery';

const fields = ['iceNumber', 'tradeRegistry', 'verificationDoc'];
const inputs = row => Object.fromEntries(fields.map(key => [key, row?.[key] || '']));
const valid = (row, owner) => row && String(row._id || row.id) === String(owner) && row.role === 'supplier' &&
  Number.isSafeInteger(row.verificationRevision) && row.verificationRevision >= 0 &&
  ['unverified','pending','verified','rejected'].includes(row.verificationStatus) &&
  row.isVerified === (row.verificationStatus === 'verified') &&
  fields.every(key => typeof row[key] === 'string') && ['idle','pending','paused','unknown'].includes(row.verificationSync);

export default function SupplierVerificationPanel({ owner, onConfirmed }) {
  const token = useSessionToken();
  return <OwnedPanel key={token + ':' + owner} token={token} owner={owner} onConfirmed={onConfirmed}/>;
}
function OwnedPanel({token, owner, onConfirmed}) {
  const l=useLabels(), {lang}=useTranslation();
  const [row,setRow]=useState(null), [form,setForm]=useState(inputs()), [busy,setBusy]=useState(false);
  const [error,setError]=useState(''), [message,setMessage]=useState(''), [uncertain,setUncertain]=useState(false), [readEpoch,setReadEpoch]=useState(0);
  const mounted=useRef(true), request=useRef(null), locked=useRef(false), labels=useRef(l), confirmed=useRef(onConfirmed);
  labels.current=l;confirmed.current=onConfirmed;
  async function execute(write=false,recovered='') {
    if(locked.current || !token) return;
    locked.current=true;const controller=new AbortController();request.current=controller;
    const current=()=>mounted.current && !controller.signal.aborted && getSessionToken()===token;
    setReadEpoch(x=>x+1);setBusy(true);setError('');setMessage('');
    try {
      const result=await apiRequest(write?'/suppliers/me/verify':'/suppliers/me/profile',{
        token,signal:controller.signal,cache:'no-store',...(write?{method:'POST',body:{...form,verificationRevision:row.verificationRevision}}:{})});
      if(!current())return;
      const saved=write?result?.supplier:result;
      if(!valid(saved,owner) || (row && saved.verificationRevision<row.verificationRevision) || (write && (!fields.every(k=>saved[k]===form[k].trim()) ||
          !['pending','verified'].includes(saved.verificationStatus) || saved.verificationRevision<row.verificationRevision || saved.verificationSync!=='idle')))
        throw new Error(labels.current('لم تتأكد حالة ملف التوثيق. حدّث الحالة المحفوظة.','État du dossier non confirmé. Actualisez la version enregistrée.','Verification state unconfirmed. Refresh the saved record.'));
      setRow(saved);setForm(inputs(saved));setUncertain(false);confirmed.current?.(saved);
      if(recovered)setMessage(recovered==='completed'?labels.current('تم استكمال العملية المحفوظة. تم تحديث حالة الملف.','Opération enregistrée reprise. Dossier actualisé.','Saved operation completed. Dossier refreshed.'):labels.current('ألغيت العملية المحفوظة دون تنفيذها؛ راجع الحالة الحالية.','Opération enregistrée annulée sans application ; vérifiez l’état actuel.','Saved operation cancelled without applying it; review current state.'));
      if(write)setMessage(saved.verificationStatus==='pending'?labels.current('أرسل ملفك للمراجعة','Dossier envoyé pour examen'):labels.current('ملف التوثيق معتمد بالفعل','Dossier déjà vérifié','Verification already approved'));
    }catch(e){if(current()){setError(e.message);setUncertain(true);}}
    finally{if(request.current===controller){request.current=null;locked.current=false;if(current())setBusy(false);}}
  }
  useEffect(()=>{mounted.current=true;execute();return()=>{mounted.current=false;request.current?.abort();request.current=null;locked.current=false;};
    // The keyed owner/token boundary remounts this panel; labels and callback are refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const blocked=!row || busy || uncertain || row.verificationStatus==='pending' || row.verificationSync!=='idle';
  return <form className="panel" onSubmit={e=>{e.preventDefault();if(!blocked)execute(true);}}>
    <h2>{l('طلب مراجعة وتوثيق المورد','Demande de vérification')}</h2>
    <p>{row?statusLabel(row.verificationStatus,lang):l('حالة التوثيق غير مؤكدة','État de vérification non confirmé','Verification state unconfirmed')}</p>
    <p className="supplier-help">{l('هذا التوثيق التجاري اختياري، وهو منفصل عن اعتماد المتجر الإداري. لا يشترط لفتح متجر أو نشر منتج ولا يمثل ضماناً تجارياً.','Cette vérification commerciale est facultative et distincte de l’approbation administrative de la boutique. Elle n’est requise ni pour ouvrir une boutique ni pour publier, et ne constitue pas une garantie commerciale.')}</p>
    {row&&row.verificationSync!=='idle'&&<Notice error>{row.verificationSync==='paused'?l('توقف الاستكمال التلقائي. تواصل مع الإدارة؛ لا ترسل ملفاً جديداً.','La reprise automatique est suspendue. Contactez l’administration ; ne soumettez pas de nouveau dossier.','Automatic recovery is paused. Contact administration; do not submit a new dossier.'):l('لم يكتمل سجل عملية التوثيق بعد. حدّث الحالة قبل أي تعديل جديد.','La trace de vérification n’est pas encore finalisée. Actualisez l’état avant toute modification.','The verification operation record is not finalized. Refresh before making another change.')}</Notice>}
    {row&&!uncertain&&['pending','paused'].includes(row.verificationSync)&&<VerificationRecovery key={row.verificationSync+':'+readEpoch} supplierId={String(owner)} role="supplier" revision={row.verificationRevision} status={row.verificationStatus} disabled={busy} onSettled={phase=>execute(false,phase)}/>}
    {row?.rejectionReason && <Notice error>{row.rejectionReason}</Notice>}
    {row?.verificationStatus==='pending' && <p>{l('الملف قيد المراجعة؛ لا يمكن تعديله قبل القرار.','Dossier en cours d’examen ; modification bloquée jusqu’à la décision.','Dossier under review; editing is locked until the decision.')}</p>}
    {row?.verificationStatus==='verified' && <p>{l('تغيير الملف المعتمد يعيد طلب التوثيق للمراجعة ويزيل الشارة مؤقتاً.','Modifier le dossier approuvé relance la vérification et retire temporairement le badge.','Changing an approved dossier starts a new review and temporarily removes the badge.')}</p>}
    <fieldset disabled={blocked}><div className="form-grid">{[['iceNumber','ICE'],['tradeRegistry',l('السجل التجاري','Registre de commerce')],['verificationDoc',l('رابط وثيقة التوثيق (HTTPS)','Lien du justificatif (HTTPS)')]].map(([key,label])=><Field key={key} label={label} maxLength={key==='verificationDoc'?2048:100} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>)}</div>
      <button className="primary" style={{marginTop:12}} disabled={!form.iceNumber.trim()&&!form.tradeRegistry.trim()}>{l('إرسال للمراجعة','Envoyer pour examen')}</button>
    </fieldset>
    <button type="button" disabled={busy} onClick={()=>execute()}>{l('تحديث حالة التوثيق','Actualiser la vérification','Refresh verification status')}</button>
    <Notice error>{error&&<>{error}{row&&uncertain&&<span className="supplier-help"> {l('الحالة المعروضة آخر نسخة مؤكدة فقط. الحفظ متوقف حتى ينجح تحديث الحالة.','Les données affichées sont la dernière version confirmée. Enregistrement bloqué jusqu’à une actualisation réussie.','The displayed record is only the last confirmed version. Saving is blocked until a successful refresh.')}</span>}</>}</Notice><Notice>{message}</Notice>
  </form>;
}
