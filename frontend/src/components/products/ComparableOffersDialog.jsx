import {useEffect,useState} from 'react';
import AtlasDialog from '../common/AtlasDialog';
import ProtectedImage from '../common/ProtectedImage';
import {apiRequest} from '../../api/config';
import {Link,productPath} from '../../navigation';
import {useLabels,formatMoney} from '../../i18n/useLabels';
import {useTranslation} from '../../i18n/LanguageContext';
import {parseQuantity} from './detailPricing';
import '../../styles/atlas-comparison.css';

const LIMIT=12;
const positive=n=>Number.isSafeInteger(n)&&n>0;
const price=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const str=s=>typeof s==='string'&&s.trim().length>0;
const rank=q=>q.kind==='fixed'?(q.total===null?1:0):q.kind==='request'?2:q.kind==='unknown'?3:4;
export function confirmComparable(d,id,qty,page){
 const p=d?.pagination,rows=d?.offers;
 if(d?.version!=='v49-1'||d.anchorId!==id||d.quantity!==qty||d.identityVerified!==false||d.shippingIncluded!==false||
 !str(d.anchorName)||!str(d.category)||!str(d.unit)||!(/^[A-Z]{3}$/.test(d.currency||''))||typeof d.taxonomyPath!=='string'||
 typeof d.familyKnown!=='boolean'||!positive(d.total)||(!d.familyKnown&&d.total!==1)||
 !p||p.page!==page||p.limit!==LIMIT||p.total!==d.total||p.pages!==Math.ceil(p.total/LIMIT)||
 !Array.isArray(rows)||rows.length!==Math.min(LIMIT,Math.max(0,p.total-(page-1)*LIMIT))||
 new Set(rows.map(r=>r?._id)).size!==rows.length)throw Error('UNCONFIRMED_COMPARISON');
 for(let i=0;i<rows.length;i++){
  const r=rows[i],q=r?.quote;
  if(!r||!(/^[a-f0-9]{24}$/i.test(r._id||''))||!str(r.name)||r.category!==d.category||r.taxonomyPath!==d.taxonomyPath||r.currency!==d.currency||r.unit!==d.unit||
  !positive(r.moq)||!q||!['fixed','request','unknown','below_moq'].includes(q.kind)||
  (q.kind==='below_moq'&&qty>=r.moq)||(q.kind!=='below_moq'&&qty<r.moq)||
  (q.kind==='fixed'&&(!price(q.unitPrice)||(q.total!==null&&(!price(q.total)||q.total!==q.unitPrice*qty))))||
  (q.kind!=='fixed'&&(q.unitPrice!==undefined||q.total!==undefined))||(!d.familyKnown&&r._id!==id))throw Error('UNCONFIRMED_COMPARISON');
  if(i){const prev=rows[i-1].quote;if(rank(prev)>rank(q)||(rank(prev)===0&&rank(q)===0&&prev.unitPrice>q.unitPrice))throw Error('UNCONFIRMED_COMPARISON');}
 }
 return d;
}
export default function ComparableOffersDialog({productId,initialQuantity,onClose}){
 const l=useLabels(),{lang}=useTranslation(),initial=parseQuantity(initialQuantity);
 const [draft,setDraft]=useState(initial===null?'':String(initial)),[scope,setScope]=useState({quantity:initial,page:1}),[state,setState]=useState(null),[invalid,setInvalid]=useState(false);
 useEffect(()=>{
  if(scope.quantity===null)return;
  let active=true,controller;
  async function load(){
   if(document.visibilityState==='hidden')return;
   controller?.abort();controller=new AbortController();const signal=controller.signal;
   setState(null);
   try{
    const params=new URLSearchParams({quantity:String(scope.quantity),page:String(scope.page),limit:String(LIMIT)});
    const result=confirmComparable(await apiRequest('/products/'+productId+'/comparable?'+params,{signal,token:'',cache:'no-store'}),productId,scope.quantity,scope.page);
    if(active&&!signal.aborted)setState({scope,productId,result});
   }catch(error){if(active&&!signal.aborted)setState({scope,productId,error});}
  }
  function changed(){if(document.visibilityState==='hidden'){controller?.abort();setState(null);}else load();}
  load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',changed);
  return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',changed);};
 },[productId,scope]);
 const current=state?.scope===scope&&state.productId===productId?state:null;
 const data=current?.result,error=current?.error,editing=parseQuantity(draft)!==scope.quantity;
 function calculate(e){e.preventDefault();const quantity=parseQuantity(draft);if(quantity===null){setInvalid(true);return;}setInvalid(false);setScope({quantity,page:1});}
 const money=(n,c)=>formatMoney(n,c,lang);
 return <AtlasDialog title={l('مقارنة منتجات من النوع نفسه','Comparer le même type','Compare same product type')} subtitle="Jomla.ma" onClose={onClose}>
  <div className="atlas-comparison">
  <p className="muted">{l('منتجات من النوع نفسه حسب بيانات الكتالوج، وليست بالضرورة نفس الموديل. الأسعار تقديرية ولا تشمل التوصيل.','Même type selon le catalogue ; modèle non garanti. Prix indicatifs, hors livraison.','Same type based on catalog data; model not guaranteed. Estimated prices exclude shipping.')}</p>
  <form className="atlas-comparison-qty" onSubmit={calculate} noValidate><label>{l('الكمية المطلوبة','Quantité souhaitée','Requested quantity')} <input type="text" dir="ltr" inputMode="numeric" maxLength={16} value={draft} aria-invalid={invalid} onChange={e=>{setDraft(e.target.value);setInvalid(false);}}/></label><button type="submit" className="primary">{l('احسب','Calculer','Calculate')}</button></form>
  {invalid&&<p role="alert">{l('أدخل كمية صحيحة موجبة.','Saisissez une quantité entière positive.','Enter a positive whole quantity.')}</p>}
  {(editing||scope.quantity===null)&&!invalid&&<p role="status">{l('اضغط احسب لتحديث المقارنة.','Cliquez sur Calculer pour actualiser.','Select Calculate to update the comparison.')}</p>}
  {!editing&&!invalid&&scope.quantity!==null&&!current&&<p role="status">{l('جاري تحميل العروض…','Chargement des offres…','Loading offers…')}</p>}
  {!editing&&!invalid&&error&&<div role="alert"><p>{error.status===404?l('المنتج لم يعد متاحاً للمقارنة.','Ce produit n’est plus disponible pour comparaison.','This product is no longer available for comparison.'):l('تعذر تأكيد المقارنة. أعد المحاولة.','Comparaison non confirmée. Réessayez.','Comparison could not be confirmed. Retry.')}</p><button type="button" onClick={()=>setScope({...scope})}>{l('إعادة المحاولة','Réessayer','Retry')}</button></div>}
  {!editing&&!invalid&&data&&<><div className="atlas-comparison-context"><strong>{data.anchorName}</strong><small>{data.total} {l('عرض','offre(s)','offer(s)')} · {data.unit} · {data.currency} · <bdi dir="ltr">{data.quantity}</bdi></small></div>
  {data.total===1&&<p className="muted">{data.familyKnown?l('لا توجد عروض أخرى قابلة للمقارنة حالياً.','Aucune autre offre comparable.','No other comparable offers currently.'):l('نوع المنتج غير معروف بدقة؛ لم نقترح عروضاً غير مؤكدة.','Type non identifié ; aucune offre incertaine proposée.','Product type unrecognized; no unconfirmed alternatives suggested.')}</p>}
  {!data.offers.length&&<p>{l('لم تعد هذه الصفحة متاحة.','Cette page n’est plus disponible.','This page is no longer available.')}</p>}
  <div className="atlas-comparison-rows">{data.offers.map(r=><article className="atlas-comparison-row" key={r._id} data-quote-kind={r.quote.kind}>
  <ProtectedImage value={r.imageUrl} alt={r.name}/><div><strong>{r.name}</strong><small>{r.supplierId?.name||'—'} · {r.city||'—'} · MOQ <bdi dir="ltr">{r.moq}</bdi> {r.unit}</small>
  {r.quote.kind==='fixed'?<b><bdi>{money(r.quote.unitPrice,r.currency)}</bdi> / {r.unit} · {r.quote.total===null?l('الإجمالي غير متاح','Total indisponible','Total unavailable'):<bdi>{money(r.quote.total,r.currency)}</bdi>}</b>:<small>{r.quote.kind==='below_moq'?l('الكمية أقل من الحد الأدنى','Quantité sous MOQ','Quantity below MOQ'):r.quote.kind==='request'?l('السعر عند الطلب','Prix sur demande','Price on request'):l('السعر غير متاح','Prix indisponible','Price unavailable')}</small>}</div>
  <Link className="button-link" to={productPath(r._id)} onClick={onClose} aria-label={l('عرض ','Voir ','View ')+r.name}>{l('عرض','Voir','View')}</Link></article>)}</div>
  {(data.pagination.pages>1||scope.page>1)&&<nav className="pager" aria-label={l('صفحات المقارنة','Pages de comparaison','Comparison pages')}><button type="button" disabled={scope.page<=1} onClick={()=>setScope({...scope,page:scope.page-1})}>{l('السابق','Précédent','Previous')}</button><span>{scope.page} / {data.pagination.pages}</span><button type="button" disabled={scope.page>=data.pagination.pages} onClick={()=>setScope({...scope,page:scope.page+1})}>{l('التالي','Suivant','Next')}</button></nav>}
  </>}</div></AtlasDialog>;
}
