import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../api/config';
import {getSessionToken,useSessionToken} from '../../api/session';
import {useLabels} from '../../i18n/useLabels';
import {Notice} from '../common/WorkspaceUI';

export default function SupplierReviewReply({review,owner,onSaved,onRefresh}) {
  const token=useSessionToken();
  return <Reply key={token+':'+owner+':'+review._id} {...{review,owner,onSaved,onRefresh,token}}/>;
}
function Reply({review,owner,onSaved,onRefresh,token}) {
  const l=useLabels(),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
  const lock=useRef(false),controller=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()};},[]);
  async function submit(e){
    e.preventDefault();if(lock.current||uncertain||!token||token!==getSessionToken()||!text.trim()||text.length>2000)return;
    lock.current=true;setBusy(true);setError('');
    const c=new AbortController();controller.current=c;const value=text.trim();
    try {
      const d=await apiRequest('/suppliers/me/reviews/'+review._id+'/reply',{token,signal:c.signal,method:'POST',body:{text:value}});
      if(c.signal.aborted||!mounted.current||token!==getSessionToken())return;
      const r=d.review;if(r?._id!==review._id||r.supplierId!==owner||r.reply?.text!==value||r.stars!==review.stars||r.comment!==review.comment)throw Error('Unconfirmed reply');
      setText('');onSaved(r);
    } catch(e){if(!c.signal.aborted&&mounted.current&&token===getSessionToken()){setUncertain(true);setError(l('تعذر تأكيد حفظ الرد؛ حدّث التقييمات قبل إعادة المحاولة.','Réponse non confirmée ; actualisez les avis avant de réessayer.','Reply not confirmed; refresh reviews before retrying.'));}}
    finally{lock.current=false;if(mounted.current&&token===getSessionToken())setBusy(false);}
  }
  return <><form className="actions" onSubmit={submit}><input aria-label={l('رد على التقييم','Réponse à l’avis','Reply to review')} required maxLength={2000} disabled={busy||uncertain} value={text} onChange={e=>setText(e.target.value)}/><button disabled={busy||uncertain||!text.trim()}>{l('رد','Répondre','Reply')}</button></form><Notice error>{error}</Notice>{uncertain&&<button onClick={onRefresh}>{l('تحديث التقييمات','Actualiser les avis','Refresh reviews')}</button>}</>;
}
