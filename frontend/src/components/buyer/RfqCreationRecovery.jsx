import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';

// Reconcile an already authorized durable request, never create a new one.
export default function RfqCreationRecovery({ id, onRefresh }) {
  const token=useSessionToken(), l=useLabels(), alive=useRef(true), active=useRef(null), busyRef=useRef(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;active.current?.abort();};},[]);
  async function resume(){
    if(busyRef.current || !token)return;
    busyRef.current=true;setBusy(true);setError('');
    const controller=new AbortController();active.current=controller;
    const valid=()=>alive.current && !controller.signal.aborted && token===getSessionToken();
    try{
      const result=await apiRequest('/rfq/'+id+'/creation/retry',{method:'POST',token,signal:controller.signal});
      if(!valid())return;
      setMessage(result.processing?l('المحادثة والإشعار قيد الاستكمال. لم يكتمل الإرسال بعد.','Conversation et notification en cours. L’envoi n’est pas terminé.'):l('اكتمل إرسال الطلب.','La demande a été envoyée.'));
      onRefresh?.();
    }catch(e){if(valid())setError(e.message);}
    finally{busyRef.current=false;if(valid())setBusy(false);}
  }
  return <div><p className="trade-help">{l('حُفظ الطلب؛ لا يمكن التفاوض قبل استكمال المحادثة والإشعار.','Demande enregistrée ; la conversation et la notification doivent être finalisées avant la négociation.')}</p>
    <button className="primary" disabled={busy} onClick={resume}>{busy?l('جارٍ الاستكمال…','Reprise…'):l('استكمال إنشاء الطلب','Finaliser la création')}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
