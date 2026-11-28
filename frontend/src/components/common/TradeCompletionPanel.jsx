import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { useLabels } from '../../i18n/useLabels';
import { Notice } from './WorkspaceUI';
import TradeConfirmationDispute from './TradeConfirmationDispute';

export default function TradeCompletionPanel({user}) {
  const token=useSessionToken(), id=user?._id || user?.id;
  return token && id && ['buyer','supplier'].includes(user?.role) ? <Completion key={token+':'+id+':'+user.role} token={token} id={id} role={user.role}/> : null;
}
function Completion({token,id,role}) {
  const l=useLabels(), [kind,setKind]=useState('rfq'), [page,setPage]=useState(1), [revision,refresh]=useState(0);
  const [result,setResult]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false), [selected,setSelected]=useState(null);
  const lock=useRef(false), controller=useRef(null), mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort()};},[]);
  useEffect(()=>{
    const c=new AbortController();
    setResult(null);setError('');setSelected(null);
    apiRequest('/trade-confirmations?kind='+kind+'&page='+page,{token,signal:c.signal,cache:'no-store'}).then(d=>{
      if(c.signal.aborted || token!==getSessionToken())return;
      if(d.actorId!==id || d.role!==role || d.kind!==kind || d.page!==page || !Array.isArray(d.data))throw Error('Unconfirmed response');
      setResult(d);
    }).catch(e=>{if(!c.signal.aborted && token===getSessionToken())setError(e.message);});
    return()=>c.abort();
  },[token,id,role,kind,page,revision]);
  const current=result?.kind===kind&&result?.page===page?result:null;
  async function confirm(row){
    if(lock.current || token!==getSessionToken() || selected!==row.sourceId)return;
    lock.current=true;setBusy(true);setError('');
    const c=new AbortController();controller.current=c;
    try{
      const d=await apiRequest('/trade-confirmations/'+kind+'/'+row.sourceId+'/'+row.offerId,{token,signal:c.signal,method:'POST',body:{confirmed:true}});
      if(c.signal.aborted||!mounted.current||token!==getSessionToken())return;
      const t=d.trade;
      if(d.actorId!==id||d.role!==role||t?.kind!==kind||t.sourceId!==row.sourceId||t.offerId!==row.offerId||t.ownConfirmed!==true)throw Error('Unconfirmed response');
      refresh(v=>v+1);
    }catch(e){if(!c.signal.aborted&&mounted.current&&token===getSessionToken()){setResult(null);setSelected(null);setError(l('تعذر التحقق من الحفظ؛ حدّث القائمة قبل المحاولة مجدداً.','Enregistrement non confirmé ; actualisez la liste.','Save not confirmed; refresh the list before retrying.'));}}
    finally{lock.current=false;if(mounted.current&&token===getSessionToken())setBusy(false);}
  }
  return <section className="panel">
    <h2>{l('تأكيد التعاملات','Confirmation des transactions','Confirm transactions')}</h2>
    <p>{l('لا تؤكد إلا بعد إتمام التعامل فعلاً. إقرار الطرفين يتيح التقييم، ولا يمثل إثباتاً مستقلاً للدفع أو التسليم.','Confirmez uniquement après la réalisation effective de la transaction. La confirmation mutuelle permet un avis, sans prouver indépendamment le paiement ou la livraison.','Confirm only after the transaction actually takes place. Mutual confirmation enables a review; it is not independent payment or delivery proof.')}</p>
    <div className="actions">{[['rfq',l('طلبات الأسعار','Devis','Quotes')],['sourcing',l('طلبات التوريد','Approvisionnement','Sourcing')]].map(([k,label])=><button key={k} disabled={busy} aria-pressed={kind===k} onClick={()=>{setKind(k);setPage(1);}}>{label}</button>)}<button disabled={busy} onClick={()=>refresh(v=>v+1)}>{l('تحديث','Actualiser','Refresh')}</button></div>
    <Notice error>{error}</Notice>
    {!current&&!error&&<p role="status">{l('جاري التحميل…','Chargement…','Loading…')}</p>}
    {current?.unavailable>0&&<Notice error>{l('بعض الاتفاقات غير متاحة للتأكيد.','Certains accords ne peuvent pas être confirmés.','Some agreements cannot be confirmed.')}</Notice>}
    {current?.data.length===0&&<p>{l('لا توجد اتفاقات متاحة للتأكيد في هذه الصفحة.','Aucun accord à confirmer sur cette page.','No agreements to confirm on this page.')}</p>}
    {current?.data.map(row=><article key={row.sourceId+':'+row.offerId} className="panel">
      <h3>{row.title}</h3><p>{l('المشتري','Acheteur','Buyer')}: {row.buyerConfirmed?l('أكد','Confirmé','Confirmed'):l('لم يؤكد','Non confirmé','Not confirmed')} · {l('المورد','Fournisseur','Supplier')}: {row.supplierConfirmed?l('أكد','Confirmé','Confirmed'):l('لم يؤكد','Non confirmé','Not confirmed')}</p>
      {row.completed?<p className="notice">{l('تم إقرار التعامل من الطرفين.','Transaction confirmée par les deux parties.','Both parties confirmed the transaction.')}</p>:row.ownConfirmed?<p>{l('بانتظار الطرف الآخر.','En attente de l’autre partie.','Waiting for the other party.')}</p>:selected===row.sourceId?<div><p>{l('أقرّ بأن التعامل تم فعلاً. لا يمكن التراجع عن هذا الإقرار من الواجهة.','Je déclare que la transaction a effectivement eu lieu. Cette confirmation est définitive dans cette interface.','I attest that the transaction actually took place. This confirmation cannot be undone here.')}</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>confirm(row)}>{l('أؤكد إتمام التعامل','Je confirme la transaction','I confirm completion')}</button><button disabled={busy} onClick={()=>setSelected(null)}>{l('إلغاء','Annuler','Cancel')}</button></div></div>:<button disabled={busy} onClick={()=>setSelected(row.sourceId)}>{l('مراجعة الإقرار','Vérifier la déclaration','Review confirmation')}</button>}
      {row.ownConfirmed&&row.kind===kind&&<TradeConfirmationDispute row={row} id={id} role={role} token={token} disabled={busy}/>}
    </article>)}
    {current&&(page>1||current.hasNext)&&<nav className="pager"><button disabled={busy||page===1} onClick={()=>setPage(p=>p-1)}>{l('السابق','Précédent','Previous')}</button><span>{page}</span><button disabled={busy||!current.hasNext} onClick={()=>setPage(p=>p+1)}>{l('التالي','Suivant','Next')}</button></nav>}
  </section>;
}
