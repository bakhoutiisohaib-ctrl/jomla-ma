import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../api/config';
import {getSessionToken} from '../../api/session';
import {useLabels} from '../../i18n/useLabels';
import {Field,Notice} from './WorkspaceUI';

const keyPattern=/^[a-f0-9]{48}$/;
const idPattern=/^[a-f0-9]{24}$/i;
export const messageAttemptStorageKey=(actorId,rfqId)=>'jomla:rfq-message:v1:'+encodeURIComponent(actorId)+':'+encodeURIComponent(rfqId);
function readKey(slot){const key=sessionStorage.getItem(slot);if(key!==null&&!keyPattern.test(key))throw Error('INVALID_ATTEMPT');return key;}
function newKey(){return Array.from(window.crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');}
function savedMessage(thread,rfqId,actorId,role,id,text){
 if(thread?.rfqId!==rfqId||!Array.isArray(thread.messages)||!idPattern.test(id||''))throw Error('UNCONFIRMED_MESSAGE');
 const rows=thread.messages.filter(m=>m?._id===id);
 const m=rows[0];
 if(rows.length!==1||m.senderId!==actorId||m.senderRole!==role||typeof m.content!=='string'||!m.content.trim()||m.content.length>5000||(text!==undefined&&m.content!==text))throw Error('UNCONFIRMED_MESSAGE');
 return m;
}
function receipt(data,rfqId,actorId){
 const s=data?.submission;
 if(data?.rfqId!==rfqId||data.actorId!==actorId||s?.version!==1||!['absent','pending','completed'].includes(s.phase)||
   (s.phase==='absent'?s.messageId!==undefined:!idPattern.test(s.messageId||'')))throw Error('UNCONFIRMED_MESSAGE');
 return s;
}

// Only an opaque attempt key is persisted, in this tab and account/request
// namespace. Never persist text, credentials, or auto-send on mount.
export default function RfqMessageComposer({actorId,rfqId,role,token,open,blocked=false,externalBusy=false,label,sendLabel,maxLength=5000,onBusy,onUncertain,onConfirmed}){
 const l=useLabels(),slot=messageAttemptStorageKey(actorId,rfqId);
 const [attempt,setAttempt]=useState(()=>{try{return {key:readKey(slot),phase:'unconfirmed'}}catch{return {key:null,phase:'storage'}}});
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState('');
 const frozen=useRef(undefined),running=useRef(null),alive=useRef(true),callbacks=useRef({onBusy,onUncertain,onConfirmed});
 callbacks.current={onBusy,onUncertain,onConfirmed};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(running.current){running.current.abort();running.current=null;callbacks.current.onBusy?.(false);}}},[]);
 const unconfirmed=()=>l('لم يتأكد إرسال الرسالة. تحقق من نفس المحاولة.','Envoi non confirmé. Vérifiez la même tentative.','Message unconfirmed. Check the same attempt.');
 const storageError=()=>l('تعذر حفظ معرف المحاولة بأمان. لم نبدأ إرسالاً جديداً.','Impossible de conserver la tentative. Aucun nouvel envoi lancé.','Could not store the attempt safely. No new send started.');
 const headers=key=>({'Idempotency-Key':key});
 function start(){
  if(running.current||externalBusy||!actorId||!rfqId||!token||getSessionToken()!==token)return null;
  const controller=new AbortController();running.current=controller;setBusy(true);setError('');setConfirmed('');callbacks.current.onBusy?.(true);
  return {controller,options:{token,signal:controller.signal,cache:'no-store'},valid:()=>alive.current&&running.current===controller&&!controller.signal.aborted&&getSessionToken()===token};
 }
 function finish(op){if(running.current!==op.controller)return;running.current=null;if(alive.current&&getSessionToken()===token){setBusy(false);callbacks.current.onBusy?.(false);}}
 function complete(key,different=false){
  if(readKey(slot)!==key)throw Error('UNCONFIRMED_MESSAGE');
  sessionStorage.removeItem(slot);
  frozen.current=undefined;setText('');setAttempt({key:null,phase:'unconfirmed'});setConfirmed(different?'different':'same');
  callbacks.current.onConfirmed?.();
 }
 async function check(){
  const op=start();if(!op)return;
  try{
   const key=readKey(slot);if(!key||key!==attempt.key)throw Error('UNCONFIRMED_MESSAGE');
   const data=await apiRequest('/rfq/'+rfqId+'/messages/attempt',{...op.options,headers:headers(key)});
   if(!op.valid())return;
   const s=receipt(data,rfqId,actorId);
   if(s.phase==='absent'){
    if(attempt.messageId)throw Error('UNCONFIRMED_MESSAGE');
    setAttempt({key,phase:'absent'});return;
   }
   const history=await apiRequest('/rfq/'+rfqId+'/thread',op.options);
   if(!op.valid())return;
   if(attempt.messageId&&s.messageId!==attempt.messageId)throw Error('UNCONFIRMED_MESSAGE');
   const m=savedMessage(history?.thread,rfqId,actorId,role,s.messageId);
   const different=frozen.current!==undefined&&frozen.current!==m.content;
   if(s.phase==='completed'){complete(key,different);return;}
   if(different)setError(l('النص المحفوظ يختلف عن النص المعاد إدخاله. راجع الرسالة المحفوظة قبل استكمالها.','Le texte enregistré diffère du texte ressaisi. Vérifiez le message enregistré avant de reprendre.','The saved text differs from the re-entered text. Review the saved message before resuming.'));
   frozen.current=m.content;setText(m.content);setAttempt({key,phase:'pending',messageId:s.messageId});
  }catch(e){if(op.valid()){setError(e.message==='UNCONFIRMED_MESSAGE'?unconfirmed():e.message);callbacks.current.onUncertain?.();}}
  finally{finish(op);}
 }
 async function send(e){
  e.preventDefault();
  const content=(frozen.current??text).trim();
  const recovery=attempt.phase==='pending'&&Boolean(attempt.messageId);
  if(!content||content.length>(recovery?5000:maxLength)||(!recovery&&(!open||blocked))||attempt.phase==='storage'||(attempt.key&&!['absent','pending'].includes(attempt.phase)))return;
  const op=start();if(!op)return;
  let key,issued=false;
  try{
   const stored=readKey(slot);
   if(stored!==attempt.key)throw Error('INVALID_ATTEMPT');
   key=stored||newKey();sessionStorage.setItem(slot,key);
   if(readKey(slot)!==key)throw Error('INVALID_ATTEMPT');
   frozen.current=content;setAttempt({key,phase:'unconfirmed',messageId:attempt.messageId});
   issued=true;
   const data=await apiRequest('/rfq/'+rfqId+'/messages',{...op.options,method:'POST',body:{content},headers:headers(key)});
   if(!op.valid())return;
   const s=data?.submission;
   if(s?.version!==1||s.phase!=='completed'||typeof s.replayed!=='boolean'||(attempt.messageId&&s.messageId!==attempt.messageId))throw Error('UNCONFIRMED_MESSAGE');
   savedMessage(data.thread,rfqId,actorId,role,s.messageId,content);
   const checked=receipt(await apiRequest('/rfq/'+rfqId+'/messages/attempt',{...op.options,headers:headers(key)}),rfqId,actorId);
   if(!op.valid())return;
   if(checked.phase!=='completed'||checked.messageId!==s.messageId)throw Error('UNCONFIRMED_MESSAGE');
   complete(key);
  }catch(e){if(op.valid()){
    if(issued||attempt.key){setAttempt({key:attempt.key||key,phase:'unconfirmed',messageId:attempt.messageId});setError(e.message==='UNCONFIRMED_MESSAGE'?unconfirmed():e.message);callbacks.current.onUncertain?.();}
    else{setAttempt({key:null,phase:'storage'});setError(storageError());}
  }}finally{finish(op);}
 }
 if(!open&&!attempt.key&&attempt.phase!=='storage'&&!confirmed)return null;
 const locked=busy||Boolean(attempt.key&&frozen.current!==undefined)||Boolean(attempt.key&&attempt.phase!=='absent');
 const retry=Boolean(attempt.key&&['absent','pending'].includes(attempt.phase));
 return <>
  {error&&<Notice error>{error}</Notice>}
  {confirmed&&<Notice>{confirmed==='different'?l('تأكد الإرسال السابق بنص مختلف عن النص المعاد إدخاله. راجع المحادثة؛ لم نؤكد إرسال النص الجديد.','L’envoi précédent est confirmé avec un texte différent. Vérifiez la conversation ; le nouveau texte n’est pas confirmé.','The earlier send is confirmed with different text. Review the conversation; the new text is not confirmed.'):l('تأكد إرسال الرسالة وحفظ إشعارها.','Envoi et notification confirmés.','Message and notification confirmed.')}</Notice>}
  {attempt.phase==='storage'&&!error&&<Notice error>{storageError()}</Notice>}
  {attempt.key&&<div className="trade-uncertain"><p role="status">{attempt.phase==='pending'?l('الرسالة محفوظة؛ الإشعار قيد الاستكمال.','Message enregistré ; notification en cours.','Message saved; notification pending.'):attempt.phase==='absent'?l('لم تظهر المحاولة في الخادم بعد. أعد نفس نص الرسالة دون تغييره.','Tentative non trouvée pour le moment. Ressaisissez exactement le même message.','Attempt not found yet. Re-enter the exact same message.'):l('هناك محاولة إرسال غير مؤكدة. تحقق من حالتها قبل إرسال رسالة جديدة.','Une tentative reste non confirmée. Vérifiez son état avant un nouvel envoi.','An attempt is unconfirmed. Check its status before a new message.')}</p>
   <button type="button" disabled={busy||externalBusy} onClick={check}>{l('التحقق من محاولة الإرسال','Vérifier la tentative','Check send attempt')}</button></div>}
  {(open||(attempt.key&&attempt.phase==='pending'))&&<form className="trade-compose" onSubmit={send}>
   {role==='buyer'?<><label htmlFor="buyer-message">{label}</label><textarea id="buyer-message" rows="3" required maxLength={maxLength} value={text} disabled={locked} onChange={e=>setText(e.target.value)}/></>:<Field label={label} value={text} disabled={locked} required maxLength={maxLength} onChange={e=>setText(e.target.value)}/>}
   <button className={role==='buyer'?'primary':undefined} disabled={!actorId||!token||busy||externalBusy||(!open&&attempt.phase!=='pending')||(blocked&&attempt.phase!=='pending')||!text.trim()||attempt.phase==='storage'||Boolean(attempt.key&&!retry)}>{retry?l('استكمال نفس الإرسال','Reprendre le même envoi','Resume same send'):sendLabel}</button>
  </form>}
 </>;
}
