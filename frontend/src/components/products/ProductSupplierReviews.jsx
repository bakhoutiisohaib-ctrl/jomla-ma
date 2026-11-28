import { localeFor } from '../../i18n/useLabels';
import { useEffect, useRef, useState } from 'react';
import {getSessionToken,useSessionToken} from '../../api/session';
import { apiRequest } from '../../api/config';
import { usePublicResource } from '../common/usePublicPage';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import { reviewBasisLabel, validReviewStars, validatedPublicReviews } from '../reviews/reviewPresentation';

export default function ProductSupplierReviews(props) {
  const token=useSessionToken();
  return <Reviews key={props.supplierId+':'+(props.user?._id||props.user?.id||'')+':'+token} {...props} token={token}/>;
}
function Reviews({ supplierId, user, token, compact=false }) {
  const l = useLabels(), { lang } = useTranslation();
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ stars: '', comment: '' }), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [submitError, setSubmitError] = useState('');
  const { data:raw, loading, error, refresh } = usePublicResource('/reviews/' + supplierId + '?limit=5&page=' + page + '&revision=' + revision);
  const [eligibility,setEligibility]=useState(null), [check,setCheck]=useState(0);
  const lock=useRef(false), mounted=useRef(true), request=useRef(null);
  const buyerId=user?._id||user?.id, buyer=user?.role==='buyer'&&Boolean(token&&buyerId);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort()};},[]);
  useEffect(()=>{
    if(!buyer)return;
    const c=new AbortController();setEligibility(null);
    apiRequest('/reviews/eligibility/'+supplierId,{token,signal:c.signal,cache:'no-store'}).then(d=>{
      if(c.signal.aborted||token!==getSessionToken())return;
      if(d.supplierId!==supplierId||d.buyerId!==buyerId||typeof d.eligible!=='boolean'||!['eligible','already_reviewed','no_confirmation'].includes(d.reason)||d.eligible!==(d.reason==='eligible'))throw Error('Unconfirmed eligibility');
      setEligibility(d.reason);
    }).catch(()=>{if(!c.signal.aborted&&token===getSessionToken())setEligibility('unavailable');});
    return()=>c.abort();
  },[buyer,buyerId,token,supplierId,check]);
  const data=validatedPublicReviews(raw,supplierId,page,5),stats=data?.stats;
  const unavailable=Boolean(error||(!loading&&!data));
  const reviews=data?.data||[];
  async function submit(event) {
    event.preventDefault();
    if(lock.current||eligibility!=='eligible'||token!==getSessionToken()||!form.stars||form.comment.trim().length<3)return;
    lock.current=true;setBusy(true); setMessage(''); setSubmitError('');
    const c=new AbortController();request.current=c;
    const body={ supplierId, stars:Number(form.stars), comment:form.comment.trim() };
    try {
      const result=await apiRequest('/reviews', { token,signal:c.signal,method:'POST',body });
      if(c.signal.aborted||!mounted.current||token!==getSessionToken())return;
      const r=result.review;
      if(!r?._id||r.supplierId!==supplierId||r.buyerId!==buyerId||r.basis!=='mutual_confirmation'||r.stars!==body.stars||r.comment!==body.comment)throw Error('Unconfirmed review');
      setEligibility('already_reviewed');
      setForm({ stars: '', comment: '' }); setPage(1); setRevision(value => value + 1);
      setMessage(l('تم نشر تقييمك للمورد.', 'Votre avis sur le fournisseur a été publié.'));
    } catch (failure) { if(!c.signal.aborted&&mounted.current&&token===getSessionToken()){setEligibility('unavailable');setSubmitError(l('لم يتم التحقق من نشر التقييم؛ حدّث الأهلية قبل المحاولة.','Publication non confirmée ; vérifiez votre éligibilité.','Publication not confirmed; check eligibility again.'));} }
    finally { lock.current=false;if(mounted.current&&token===getSessionToken())setBusy(false); }
  }
  return <section id={compact?'supplier-reviews':'product-reviews'} className={compact?'panel atlas-detail-reviews':'atlas-detail-section atlas-detail-reviews'} aria-label={l('تقييمات المورد وتعليقاته', 'Avis et commentaires sur le fournisseur')}>
    <div className="atlas-detail-section-heading"><h2>{l('تقييمات المورد وتعليقاته', 'Avis et commentaires sur le fournisseur')}</h2>
      {stats?.total>0 && <p className="atlas-detail-rating"><span aria-hidden="true">★</span> <strong>{stats.avg.toFixed(1)}/5</strong> · {stats.total} {l('تقييم محتسب','avis comptabilisés','counted reviews')}</p>}
    </div>
    <p className="atlas-detail-muted">{l('المعدل يحتسب فقط تقييمات التعاملات التي أقرها الطرفان وتتوفر أدلة كافية للتحقق من ارتباطها بالاتفاق؛ لا يمثل إثباتاً مستقلاً للدفع أو التسليم.','La moyenne inclut uniquement les avis liés à des accords vérifiables confirmés par les deux parties ; elle ne prouve ni paiement ni livraison.','The average counts only reviews linked to verifiable agreements confirmed by both parties; it is not proof of payment or delivery.')}</p>
    {loading && <p role="status">{l('جاري تحميل التقييمات…', 'Chargement des avis…')}</p>}
    {unavailable&&<><Notice error>{l('تعذر التحقق من التقييمات حالياً.','Impossible de vérifier les avis actuellement.','Reviews cannot currently be verified.')}</Notice><button type="button" onClick={refresh}>{l('إعادة تحميل التقييمات','Recharger les avis','Reload reviews')}</button></>}
    {data&&stats.total===0&&data.pagination.total>0&&<p className="atlas-detail-muted">{l('لا توجد تقييمات محتسبة في المعدل حتى الآن.','Aucun avis comptabilisé pour le moment.','No reviews count toward the average yet.')}</p>}
    {data&&data.legacyTotal>0&&<p className="atlas-detail-muted">{l('تقييمات غير محتسبة في المعدل','Avis exclus de la moyenne','Reviews excluded from the average')}: {data.legacyTotal}</p>}
    {data && !error && !reviews.length && <p className="atlas-reviews-empty">{l('لا توجد تعليقات منشورة في هذه الصفحة بعد.', 'Aucun commentaire publié sur cette page pour le moment.')}</p>}
    {reviews.map(review => {
      const date = new Date(review.date), validDate = Boolean(review.date) && !Number.isNaN(date.getTime());
      return <article key={review._id} className="atlas-detail-review">
        <header><strong>{review.userName || l('مستخدم المنصة', 'Utilisateur de la plateforme')}</strong>{validReviewStars(review.stars)&&<span aria-label={l('التقييم: ', 'Note : ','Rating: ') + review.stars + '/5'}>{'★'.repeat(review.stars)} <span>{review.stars}/5</span></span>}</header>
        <p className="muted">{reviewBasisLabel(l,review)}</p>
        {validDate && <time dateTime={date.toISOString()}>{date.toLocaleDateString(localeFor(lang))}</time>}
        {review.comment && <p>{review.comment}</p>}
        {review.reply?.text && <blockquote><strong>{l('رد المورد', 'Réponse du fournisseur')}</strong><p>{review.reply.text}</p></blockquote>}
      </article>;
    })}
    {(page > 1 || data?.pagination?.hasNextPage) && <nav className="pager" aria-label={l('صفحات التقييمات', 'Pages des avis')}>
      <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>{l('السابق', 'Précédent')}</button><span>{page}</span>
      <button type="button" disabled={!data?.pagination?.hasNextPage || loading} onClick={() => setPage(value => value + 1)}>{l('التالي', 'Suivant')}</button>
    </nav>}
    {buyer&&eligibility!=='eligible'&&<div><p>{eligibility==='already_reviewed'?l('لديك تقييم لهذا المورد بالفعل.','Vous avez déjà évalué ce fournisseur.','You already reviewed this supplier.'):eligibility==='no_confirmation'?l('يمكنك التقييم بعد إقرار إتمام التعامل من الطرفين في مساحة تأكيد التعاملات.','Un avis est possible après confirmation mutuelle de la transaction.','You can review after both parties confirm completion in your workspace.'):l('أهلية التقييم غير مؤكدة.','Éligibilité non confirmée.','Review eligibility not confirmed.')}</p><button type="button" disabled={busy} onClick={()=>setCheck(v=>v+1)}>{l('تحديث الأهلية','Actualiser l’éligibilité','Refresh eligibility')}</button></div>}
    {buyer && eligibility==='eligible' && <form className="atlas-detail-review-form" onSubmit={submit}>
      <h3>{l('شارك تجربتك مع المورد', 'Partagez votre expérience avec le fournisseur')}</h3>
      <Field label={l('تقييمك', 'Votre note')}><select required disabled={busy} value={form.stars} onChange={event => setForm({ ...form, stars: event.target.value })}><option value="">{l('اختر التقييم', 'Choisir une note')}</option>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value}/5</option>)}</select></Field>
      <Field label={l('تعليقك', 'Votre commentaire')}><textarea required minLength={3} maxLength={500} rows={3} disabled={busy} value={form.comment} onChange={event => setForm({ ...form, comment: event.target.value })} /></Field>
      <button className="primary" disabled={busy || !form.stars || form.comment.trim().length < 3}>{busy ? l('جاري النشر…', 'Publication…') : l('نشر التقييم', 'Publier mon avis')}</button>
    </form>}
    <Notice error>{submitError}</Notice><Notice>{message}</Notice>
  </section>;
}
