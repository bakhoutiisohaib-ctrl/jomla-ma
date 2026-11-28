import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../api/config';
import {getSessionToken,useSessionToken} from '../../api/session';
import {useLabels} from '../../i18n/useLabels';
import {Notice} from './WorkspaceUI';

const active=['reserved','applied','cancelled'];
const terminal=['completed','failed'];
const validRevision=n=>Number.isSafeInteger(n)&&n>=0;
function confirm(data,id,role){
 const op=data?.operation,revision=data?.verificationRevision,status=data?.verificationStatus;
 if(data?.supplierId!==id||!validRevision(revision)||!['unverified','pending','verified','rejected'].includes(status)||data.isVerified!==(status==='verified'))throw Error('UNCONFIRMED_RECOVERY');
 if(op===null)return data;
 if(!op||typeof op.id!=='string'||!(/^[a-f0-9]{24}$/i.test(op.id))||!['submit','approve','reject'].includes(op.kind)||![...active,...terminal].includes(op.phase)||!validRevision(op.baseRevision)||!validRevision(op.attempts)||typeof op.canResume!=='boolean')throw Error('UNCONFIRMED_RECOVERY');
 const applied=['applied','completed'].includes(op.phase);
 const nextStatus=op.kind==='submit'?'pending':op.kind==='approve'?'verified':'rejected';
 if(revision!==op.baseRevision+(applied&&op.kind==='submit'?1:0)||
 (applied&&status!==nextStatus)||(!applied&&op.kind!=='submit'&&status!=='pending')||
 (!applied&&op.kind==='submit'&&status==='pending')||
 op.canResume!==(active.includes(op.phase)&&(role==='admin'||op.kind==='submit')))throw Error('UNCONFIRMED_RECOVERY');
 return data;
}
export default function VerificationRecovery({supplierId,role,revision,status,disabled,onSettled}){
 const token=useSessionToken();
 return <RecoverySession key={token+':'+supplierId+':'+role+':'+revision+':'+status} {...{supplierId,role,revision,status,disabled,onSettled,token}}/>;
}
function RecoverySession({supplierId,role,revision,status,disabled,onSettled,token}){
 const l=useLabels(),[receipt,setReceipt]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const current=useRef(null),mounted=useRef(true),settled=useRef(onSettled);
 settled.current=onSettled;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;current.current?.abort();current.current=null;}},[]);
 const path=role==='admin'?'/admin/suppliers/'+supplierId:'/suppliers/me';
 const unconfirmed=()=>l('لم يتأكد الاسترجاع. تحقق من الحالة قبل أي محاولة أخرى.','Reprise non confirmée. Vérifiez l’état avant toute nouvelle tentative.','Recovery unconfirmed. Check the state before another attempt.');
 async function run(resume=false){
  if(current.current||disabled||!token||getSessionToken()!==token||(resume&&!receipt?.operation?.canResume))return;
  const controller=new AbortController();current.current=controller;
  const valid=()=>mounted.current&&!controller.signal.aborted&&getSessionToken()===token&&current.current===controller;
  const previous=receipt?.operation;
  setReceipt(null);setBusy(true);setError('');setMessage('');
  try{
   const data=confirm(await apiRequest(path+(resume?'/verification-recover':'/verification-state'),{token,signal:controller.signal,cache:'no-store',...(resume?{method:'POST',body:{operationId:previous.id}}:{})}),supplierId,role);
   if(!valid())return;
   if(resume){
    const op=data.operation;
    if(!op||op.id!==previous.id||op.kind!==previous.kind||op.baseRevision!==previous.baseRevision||!terminal.includes(op.phase))throw Error('UNCONFIRMED_RECOVERY');
    settled.current?.(op.phase);return;
   }
   if(!data.operation||terminal.includes(data.operation.phase)||data.verificationRevision!==revision||data.verificationStatus!==status){
    setMessage(l('تغيرت الحالة المحفوظة. حدّث الملف أو القائمة قبل الاسترجاع.','L’état enregistré a changé. Actualisez le dossier ou la liste avant la reprise.','The saved state changed. Refresh the dossier or list before recovery.'));return;
   }
   setReceipt(data);
   if(!data.operation.canResume)setMessage(l('هذه العملية محفوظة لدى الإدارة؛ لا يمكنك استكمالها من حساب المورد.','Cette opération relève de l’administration ; le fournisseur ne peut pas la reprendre.','This operation belongs to administration; the supplier cannot resume it.'));
  }catch(e){if(valid())setError(e.message==='UNCONFIRMED_RECOVERY'?unconfirmed():e.message);}
  finally{if(valid()){current.current=null;setBusy(false);}}
 }
 return <div className="supplier-help">
  <div className="actions">
   <button type="button" disabled={busy||disabled} onClick={()=>run()}>{l('التحقق من العملية المحفوظة','Vérifier l’opération enregistrée','Check saved operation')}</button>
   {receipt?.operation?.canResume&&<button type="button" disabled={busy||disabled} onClick={()=>run(true)}>{l('استكمال العملية نفسها','Reprendre la même opération','Resume the same operation')}</button>}
  </div>
  {receipt?.operation?.canResume&&<p>{l('سيُستكمل الطلب أو القرار المحفوظ فقط، دون إنشاء قرار جديد.','Seule l’opération enregistrée sera reprise, sans nouvelle décision.','Only the saved operation will be resumed, without a new decision.')}</p>}
  <Notice error>{error}</Notice><Notice>{message}</Notice>
 </div>;
}
