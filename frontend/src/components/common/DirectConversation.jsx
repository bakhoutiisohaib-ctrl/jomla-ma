import {useEffect,useRef,useState} from 'react';
import {apiRequest} from '../../api/config';
import {getSessionToken,useSessionToken} from '../../api/session';
import {useLabels} from '../../i18n/useLabels';
import {Field,Notice} from './WorkspaceUI';
import AtlasDialog from './AtlasDialog';
import {Link,productPath} from '../../navigation';

const base='/direct-conversations',idPattern=/^[a-f0-9]{24}$/,keyPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const invalid=()=>Error('UNCONFIRMED');
const validName=s=>typeof s==='string'&&s.trim()&&s.length<=160;
const date=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const validSummary=s=>s&&idPattern.test(s._id||'')&&idPattern.test(s.productId||'')&&validName(s.productName)&&validName(s.counterpartName)&&date(s.lastMessageAt);
const validMessage=m=>m&&keyPattern.test(m.clientId||'')&&['buyer','supplier'].includes(m.role)&&typeof m.content==='string'&&m.content.trim()&&m.content.length<=2000&&date(m.sentAt);
function identity(d,actor,role){if(d?.actorId!==actor||d.role!==role)throw invalid();}
function detail(d,actor,role,productId,threadId){
 identity(d,actor,role);
 if(typeof d.canSend!=='boolean'||!Array.isArray(d.messages)||d.messages.length>200||!d.messages.every(validMessage)||new Set(d.messages.map(m=>m.role+':'+m.clientId)).size!==d.messages.length)throw invalid();
 if(!d.conversation){if(threadId||d.productId!==productId||d.conversation!==null||d.messages.length||!d.canSend)throw invalid();}
 else if(!validSummary(d.conversation)||d.conversation.productId!==productId||(threadId&&d.conversation._id!==threadId)||!d.messages.length||(d.messages.length===200&&d.canSend))throw invalid();
 return d;
}
function uuid(){
 if(window.crypto?.randomUUID)return window.crypto.randomUUID();
 const b=window.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
 return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
const slotFor=(actor,role,productId,threadId)=>'jomla:direct-message:v1:'+actor+':'+role+':'+(role==='buyer'?productId:threadId);
function readAttempt(slot){
 const raw=sessionStorage.getItem(slot);if(raw===null)return null;
 const a=JSON.parse(raw);if(!a||!keyPattern.test(a.key||'')||!(a.thread===null||idPattern.test(a.thread||'')))throw invalid();return a;
}
function writeAttempt(slot,a){sessionStorage.setItem(slot,JSON.stringify(a));const b=readAttempt(slot);if(b?.key!==a.key||b.thread!==a.thread)throw invalid();}

function Chat({actor,role,token,productId,threadId,initialData}){
 const l=useLabels(),slot=slotFor(actor,role,productId,threadId);
 const [data,setData]=useState(initialData||null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[text,setText]=useState('');
 const [attempt,setAttempt]=useState(()=>{try{return {value:readAttempt(slot),bad:false}}catch{return {value:null,bad:true}}});
 const op=useRef(null),alive=useRef(true),frozen=useRef(null);
 const readPath=threadId?base+'/'+threadId:base+'/product/'+productId;
 const current=()=>alive.current&&getSessionToken()===token;
 const unconfirmed=()=>l('لم يتأكد حفظ الرسالة. تحقق أو أعد نفس المحاولة دون تغيير النص.','Envoi non confirmé. Vérifiez ou reprenez la même tentative sans modifier le texte.','Send unconfirmed. Check or retry the same attempt without changing the text.');
 const badStorage=()=>l('تعذر حفظ معرف المحاولة بأمان. الإرسال متوقف.','Impossible de conserver la tentative. Envoi bloqué.','Cannot safely store the attempt. Sending is blocked.');
 function begin(){if(op.current||!current())return null;const c=new AbortController();op.current=c;setBusy(true);setError('');setNotice('');return {c,opts:{token,signal:c.signal,cache:'no-store'},valid:()=>current()&&op.current===c&&!c.signal.aborted};}
 function end(o){if(op.current!==o.c)return;op.current=null;if(current())setBusy(false);}
 function settle(d,a){
  if(!a)return;
  if(a.thread&&d.conversation?._id!==a.thread)throw invalid();
  const m=d.messages.find(m=>m.role===role&&m.clientId===a.key);
  if(!m)return;
  const stored=readAttempt(slot);if(stored?.key!==a.key||stored.thread!==a.thread)throw invalid();
  sessionStorage.removeItem(slot);
  const different=frozen.current!==null&&frozen.current!==m.content;
  frozen.current=null;setAttempt({value:null,bad:false});setText('');
  setNotice(different?l('تأكدت رسالة سابقة بنص مختلف؛ راجع السجل.','Un message précédent différent est confirmé ; consultez l’historique.','A different earlier message is confirmed; check history.'):l('تأكد حفظ الرسالة.','Message enregistré et confirmé.','Message saved and confirmed.'));
 }
 async function read(){
  const o=begin();if(!o)return;setData(null);
  try{
   const d=detail(await apiRequest(readPath,o.opts),actor,role,productId,threadId);
   if(!o.valid())return;
   if(!attempt.bad)settle(d,readAttempt(slot));
   setData(d);
  }catch(e){if(o.valid())setError(e.message==='UNCONFIRMED'?unconfirmed():l('تعذر تحميل المحادثة. حدّثها للمحاولة.','Conversation indisponible. Actualisez.','Could not load conversation. Refresh to retry.'));}
  finally{end(o);}
 }
 useEffect(()=>{alive.current=true;if(initialData){try{if(!attempt.bad)settle(initialData,readAttempt(slot));setData(initialData);}catch{setError(unconfirmed());}}else read();return()=>{alive.current=false;op.current?.abort();op.current=null;}; // Initial load is scoped by the keyed parent.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function send(e){
  e.preventDefault();const content=(frozen.current??text).trim();
  if(!content||content.length>2000||!data?.canSend||attempt.bad)return;
  const o=begin();if(!o)return;
  try{
   let a=readAttempt(slot);
   if(a?.key!==attempt.value?.key)throw invalid();
   const target=data.conversation?._id||null;
   if(a?.thread&&a.thread!==target)throw invalid();
   if(!a){a={key:uuid(),thread:target};writeAttempt(slot,a);}
   frozen.current=content;setAttempt({value:a,bad:false});
   const d=await apiRequest(target?base+'/'+target+'/messages':base,{...o.opts,method:'POST',body:{clientId:a.key,content,...(!target?{productId}:{})}});
   if(!o.valid())return;
   identity(d,actor,role);
   if(!validSummary(d.conversation)||d.conversation.productId!==productId||(target&&d.conversation._id!==target)||!validMessage(d.message)||d.message.role!==role||d.message.clientId!==a.key||d.message.content!==content||typeof d.replayed!=='boolean')throw invalid();
   const checked=detail(await apiRequest(base+'/'+d.conversation._id,o.opts),actor,role,productId,d.conversation._id);
   if(!o.valid())return;
   if(!checked.messages.some(m=>m.role===role&&m.clientId===a.key&&m.content===content))throw invalid();
   setData(checked);settle(checked,a);
  }catch(e){if(o.valid()){setError(unconfirmed());}}
  finally{end(o);}
 }
 const locked=busy||Boolean(attempt.value&&frozen.current!==null);
 return <section className="panel direct-conversation">
  <p className="muted">{l('استفسار تجاري فقط، وليس طلب عرض سعر أو اتفاقاً. لا تشارك معلومات حساسة.','Échange commercial uniquement, sans devis ni accord. Ne partagez pas de données sensibles.','Commercial inquiry only, not a quote or agreement. Do not share sensitive data.')}</p>
  <div className="actions"><button type="button" disabled={busy} onClick={read}>{l('تحديث المحادثة','Actualiser la conversation','Refresh conversation')}</button></div>
  <Notice error>{error}</Notice><Notice>{notice}</Notice>{attempt.bad&&<Notice error>{badStorage()}</Notice>}
  {attempt.value&&<p role="status">{l('محاولة إرسال غير مؤكدة. حدّث المحادثة أو أعد نفس النص؛ لا ترسل رسالة جديدة قبل التحقق.','Tentative non confirmée. Actualisez ou ressaisissez le même texte avant tout nouvel envoi.','Unconfirmed attempt. Refresh or re-enter the same text before sending anything new.')}</p>}
  {busy&&!data&&<p role="status">{l('جاري التحميل…','Chargement…','Loading…')}</p>}
  {data&&<><h3>{data.conversation?.counterpartName||l('بدء محادثة','Commencer une conversation','Start a conversation')}</h3>
   <div className="direct-message-history" aria-label={l('سجل الرسائل','Historique des messages','Message history')}>
    {data.messages.map(m=><article className="panel" key={m.role+':'+m.clientId}><strong>{m.role===role?l('أنت','Vous','You'):data.conversation?.counterpartName}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.content}</p><small>{new Date(m.sentAt).toLocaleString()}</small></article>)}
   </div>
   {!data.canSend&&<Notice>{l('المحادثة للقراءة فقط حالياً.','Conversation en lecture seule.','Conversation is currently read-only.')}</Notice>}
   {data.canSend&&<form className="trade-compose" onSubmit={send}><Field label={l('رسالتك','Votre message','Your message')}><textarea value={text} onChange={e=>setText(e.target.value)} disabled={locked||attempt.bad} maxLength={2000} required/></Field><button type="submit" className="primary" disabled={busy||attempt.bad||!text.trim()}>{attempt.value?l('إعادة نفس المحاولة','Reprendre la même tentative','Retry same attempt'):l('إرسال الرسالة','Envoyer le message','Send message')}</button></form>}
  </>}
 </section>;
}
export function DirectProductDialog({user,productId,onClose}){
 const token=useSessionToken(),actor=user?._id||user?.id,l=useLabels();
 if(!token||!actor||user?.role!=='buyer')return null;
 return <AtlasDialog title={l('مراسلة المورد','Contacter le fournisseur','Contact supplier')} subtitle={l('محادثة مباشرة','Conversation directe','Direct conversation')} onClose={onClose}><Chat key={token+':'+actor+':'+productId} {...{token,actor,productId}} role="buyer"/></AtlasDialog>;
}
export const isDirectNotice=n=>n?.type==='direct_message'&&n.resourceType==='direct_conversation'&&idPattern.test(n._id||'')&&idPattern.test(n.resourceId||'');
export function DirectNoticeDialog({user,notice,onClose,onRead}){
 const token=useSessionToken(),actor=user?._id||user?.id,l=useLabels();
 const origin=useRef({token,actor,role:user?.role});
 if(!token||!actor||token!==origin.current.token||actor!==origin.current.actor||user?.role!==origin.current.role||!['buyer','supplier'].includes(user?.role)||!isDirectNotice(notice))return null;
 return <NoticeTarget key={token+':'+actor+':'+user.role+':'+notice._id} {...{token,actor,notice,onClose,onRead}} role={user.role} l={l}/>;
}
function NoticeTarget({token,actor,role,notice,onClose,onRead,l}){
 const [target,setTarget]=useState(null),[error,setError]=useState(''),[readError,setReadError]=useState(false),[revision,retry]=useState(0);
 const readCallback=useRef(onRead),labels=useRef(l);readCallback.current=onRead;labels.current=l;
 const id=notice.resourceId,noticeId=notice._id,alreadyRead=Boolean(notice.readAt);
 useEffect(()=>{
  const controller=new AbortController(),options={token,signal:controller.signal,cache:'no-store'};
  const valid=()=>!controller.signal.aborted&&getSessionToken()===token;
  const unavailable=()=>labels.current('تعذر تأكيد المحادثة المرتبطة بهذا الإشعار.','Impossible de confirmer la conversation liée à cette notification.','Could not confirm the conversation linked to this notification.');
  setError('');setReadError(false);
  (async()=>{
   try{
    const raw=await apiRequest(base+'/'+id,options);
    if(!valid())return;
    const verified=detail(raw,actor,role,raw?.conversation?.productId,id);
    if(!verified.messages.some(m=>m.role!==role))throw invalid();
    setTarget(verified);
    if(alreadyRead)return;
    try{
     const ack=await apiRequest('/notifications/'+noticeId+'/read',{...options,method:'PUT'});
     if(!valid())return;
     const n=ack?.notification;
     if(!isDirectNotice(n)||n._id!==noticeId||n.resourceId!==id||!date(n.readAt))throw invalid();
     readCallback.current?.(n);
    }catch{if(valid())setReadError(true);}
   }catch{if(valid()){setTarget(null);setError(unavailable());}}
  })();
  return()=>controller.abort();
 },[token,actor,role,id,noticeId,alreadyRead,revision]);
 return <AtlasDialog title={target?.conversation.productName||l('المحادثة المباشرة','Conversation directe','Direct conversation')} subtitle={l('محادثة مباشرة','Conversation directe','Direct conversation')} onClose={onClose}>
  {error&&<Notice error>{error}</Notice>}
  {!target&&!error&&<p role="status">{l('جاري التحميل…','Chargement…','Loading…')}</p>}
  {readError&&<Notice error>{l('تم فتح المحادثة، لكن لم يتأكد تعليم الإشعار كمقروء.','Conversation ouverte, mais lecture de la notification non confirmée.','Conversation opened, but notification read state is unconfirmed.')}</Notice>}
  {(error||readError)&&<button type="button" onClick={()=>retry(v=>v+1)}>{l('إعادة التحقق من الإشعار','Revérifier la notification','Recheck notification')}</button>}
  {target&&<Chat key={id} {...{token,actor,role}} productId={target.conversation.productId} threadId={id} initialData={target}/>}
 </AtlasDialog>;
}
export default function DirectConversationPanel({user}){
 const token=useSessionToken(),actor=user?._id||user?.id;
 return token&&actor&&['buyer','supplier'].includes(user?.role)?<Inbox key={token+':'+actor+':'+user.role} token={token} actor={actor} role={user.role}/>:null;
}
function Inbox({token,actor,role}){
 const l=useLabels(),[page,setPage]=useState(1),[revision,refresh]=useState(0),[result,setResult]=useState(null),[error,setError]=useState(false),[selected,setSelected]=useState(null);
 useEffect(()=>{
  const c=new AbortController();setResult(null);setError(false);
  apiRequest(base+'?page='+page,{token,signal:c.signal,cache:'no-store'}).then(d=>{
   if(c.signal.aborted||getSessionToken()!==token)return;
   identity(d,actor,role);
   if(d.page!==page||typeof d.hasNext!=='boolean'||!Array.isArray(d.data)||d.data.length>20||!d.data.every(validSummary)||new Set(d.data.map(s=>s._id)).size!==d.data.length)throw invalid();
   setResult(d);
  }).catch(()=>{if(!c.signal.aborted&&getSessionToken()===token)setError(true);});
  return()=>c.abort();
 },[token,actor,role,page,revision]);
 const rows=result?.page===page?result:null;
 return <section className="panel"><h2>{l('المحادثات المباشرة','Conversations directes','Direct conversations')}</h2>
  <button type="button" onClick={()=>refresh(v=>v+1)}>{l('تحديث المحادثات','Actualiser les conversations','Refresh conversations')}</button>
  {error&&<Notice error>{l('تعذر تحميل المحادثات.','Impossible de charger les conversations.','Could not load conversations.')}</Notice>}
  {!rows&&!error&&<p role="status">{l('جاري التحميل…','Chargement…','Loading…')}</p>}
  {rows?.data.length===0&&<p>{l('لا توجد محادثات مباشرة بعد.','Aucune conversation directe.','No direct conversations yet.')}</p>}
  {rows?.data.map(s=><article className="panel" key={s._id}><h3>{s.productName}</h3><p>{s.counterpartName}</p><button onClick={()=>setSelected(s)}>{l('فتح المحادثة','Ouvrir la conversation','Open conversation')}</button></article>)}
  {rows&&(page>1||rows.hasNext)&&<nav className="pager"><button disabled={page===1} onClick={()=>setPage(v=>v-1)}>{l('السابق','Précédent','Previous')}</button><span>{page}</span><button disabled={!rows.hasNext||page>=1000} onClick={()=>setPage(v=>v+1)}>{l('التالي','Suivant','Next')}</button></nav>}
  {selected&&<AtlasDialog title={selected.productName} subtitle={l('محادثة مباشرة','Conversation directe','Direct conversation')} onClose={()=>{setSelected(null);refresh(v=>v+1);}}><Link to={productPath(selected.productId)}>{l('صفحة المنتج','Page du produit','Product page')}</Link><Chat key={selected._id} {...{token,actor,role}} productId={selected.productId} threadId={selected._id}/></AtlasDialog>}
 </section>;
}
