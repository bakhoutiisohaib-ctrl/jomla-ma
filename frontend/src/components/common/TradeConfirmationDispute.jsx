import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from './WorkspaceUI';

const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const statuses = ['pending','investigating','resolved','dismissed'];
function checkedReceipt(data, row, id, role, submit) {
  if (data?.actorId !== id || data.role !== role || data.kind !== row.kind ||
      data.sourceId !== row.sourceId || data.offerId !== row.offerId) throw Error('Unconfirmed dispute');
  const d = data.dispute;
  if (d === null && !submit) return null;
  if (!validId(d?._id) || !statuses.includes(d.status) || (submit && typeof data.replayed !== 'boolean')) throw Error('Unconfirmed dispute');
  return { _id:d._id, status:d.status };
}
export default function TradeConfirmationDispute({row, id, role, token, disabled}) {
  const l=useLabels();
  const [phase,setPhase]=useState('idle'), [record,setRecord]=useState(null), [details,setDetails]=useState('');
  const [attempt,setAttempt]=useState(null), [busy,setBusy]=useState(false);
  const lock=useRef(false), controller=useRef(null), mounted=useRef(true), knownId=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()};},[]);
  const valid=validId(row.sourceId)&&validId(row.offerId)&&['rfq','sourcing'].includes(row.kind);
  const path='/trade-confirmations/'+row.kind+'/'+row.sourceId+'/'+row.offerId+'/dispute';
  async function request(submit) {
    const text=attempt??details.trim();
    if(!valid||disabled||lock.current||token!==getSessionToken()||
      (submit&&(!['form','recover','uncertain'].includes(phase)||text.length<3||text.length>2000)))return;
    lock.current=true;setBusy(true);
    if(submit)setAttempt(text);
    const c=new AbortController();controller.current=c;
    const current=()=>mounted.current&&!c.signal.aborted&&token===getSessionToken();
    try {
      const data=await apiRequest(path,{token,signal:c.signal,cache:'no-store',...(submit?{method:'POST',body:{details:text}}:{})});
      if(!current())return;
      const d=checkedReceipt(data,row,id,role,submit);
      if(knownId.current&&d?._id!==knownId.current)throw Error('Changed dispute identity');
      if(d)knownId.current=d._id;
      setRecord(d);
      if(d){setPhase('saved');setDetails('');setAttempt(null);}
      else if(attempt!==null){setPhase('uncertain');}
      else setPhase(row.completed?'none':'form');
    } catch(e) {
      if(!current())return;
      setRecord(null);
      setPhase(submit||attempt!==null?'uncertain':e.status===503?'recover':'error');
    } finally {
      lock.current=false;if(current())setBusy(false);
    }
  }
  if(!valid||!row.ownConfirmed)return null;
  const statusText=record&&({
    pending:l('قيد المراجعة','En attente','Pending review'),
    investigating:l('قيد التحقيق','En cours d’examen','Under investigation'),
    resolved:l('تمت مراجعة الاعتراض','Réclamation traitée','Dispute reviewed'),
    dismissed:l('حُفظ دون إجراء','Classée sans suite','Dismissed without action')
  })[record.status];
  return <section aria-label={l('اعتراض تأكيد التعامل','Réclamation de confirmation','Confirmation dispute')}>
    <div className="actions"><button type="button" disabled={disabled||busy} onClick={()=>request(false)}>{l('التحقق من الاعتراض','Vérifier la réclamation','Check dispute')}</button></div>
    {busy&&<p role="status">{l('جاري التحقق…','Vérification…','Checking…')}</p>}
    {phase==='saved'&&<><Notice>{statusText}</Notice><p className="muted">{l('مرجع الاعتراض','Référence de la réclamation','Dispute reference')}: <bdi>{record._id}</bdi></p></>}
    {phase==='none'&&<p>{l('لا يوجد اعتراض مسجل.','Aucune réclamation enregistrée.','No dispute recorded.')}</p>}
    {phase==='error'&&<Notice error>{l('تعذر التحقق من حالة الاعتراض. أعد التحقق.','Impossible de vérifier la réclamation. Réessayez.','Dispute status unavailable. Check again.')}</Notice>}
    {phase==='recover'&&<Notice error>{l('تعذر تأكيد حفظ الاعتراض. إن سبق إرساله، أعد إدخال النص نفسه تماماً؛ وإلا راجع الإدارة.','Enregistrement non confirmé. Si déjà envoyée, ressaisissez exactement le même texte ; sinon contactez l’administration.','Dispute save unconfirmed. If previously submitted, re-enter the exact same text; otherwise contact administration.')}</Notice>}
    {phase==='uncertain'&&<Notice error>{l('نتيجة الإرسال غير مؤكدة. تحقق من الحالة أو أعد إرسال النص نفسه دون تغييره.','Envoi non confirmé. Vérifiez le statut ou renvoyez exactement le même texte.','Submission unconfirmed. Check status or resend the exact same text.')}</Notice>}
    {['form','recover','uncertain'].includes(phase)&&<form onSubmit={e=>{e.preventDefault();request(true);}}>
      <p className="muted">{l('الاعتراض خاص بالإدارة، ولا يمنح حق التقييم تلقائياً. لا تدرج بيانات دفع أو وثائق حساسة.','La réclamation est réservée à l’administration et ne donne pas automatiquement droit à un avis. Ne saisissez pas de données de paiement ni de documents sensibles.','The dispute is private to administration and does not automatically enable reviews. Do not include payment data or sensitive documents.')}</p>
      <Field label={l('تفاصيل الاعتراض','Détails de la réclamation','Dispute details')}><textarea rows={3} required minLength={3} maxLength={2000} value={attempt??details} disabled={disabled||busy||attempt!==null} onChange={e=>setDetails(e.target.value)}/></Field>
      <button type="submit" className="primary" disabled={disabled||busy||(attempt??details).trim().length<3}>{attempt!==null||phase==='recover'?l('إعادة إرسال النص نفسه','Renvoyer le même texte','Resend same text'):l('إرسال الاعتراض للإدارة','Envoyer la réclamation','Submit dispute to administration')}</button>
    </form>}
    {attempt!==null&&<p className="muted">{l('النص غير محفوظ على جهازك؛ إذا غادرت الصفحة فقد تحتاج إلى إدخاله مجدداً لاستكمال الطلب.','Le texte n’est pas conservé sur votre appareil ; si vous quittez la page, vous devrez peut-être le ressaisir.','The text is not stored on your device; leaving the page may require you to re-enter it for recovery.')}</p>}
    {phase!=='idle'&&<p className="muted">{l('مراجعة الاعتراض لا تعني إثبات الدفع أو التسليم، ولا تغير شروط التقييم.','Le traitement ne prouve ni paiement ni livraison et ne modifie pas les conditions d’avis.','Reviewing a dispute does not prove payment or delivery or change review eligibility.')}</p>}
  </section>;
}
