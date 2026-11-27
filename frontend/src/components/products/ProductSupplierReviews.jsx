import { localeFor } from '../../i18n/useLabels';
import { useEffect, useRef, useState } from 'react';
import {getSessionToken,useSessionToken} from '../../api/session';
import { apiRequest } from '../../api/config';
import { usePublicResource } from '../common/usePublicPage';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';

export default function ProductSupplierReviews(props) {
  const token=useSessionToken();
  return <Reviews key={props.supplierId+':'+(props.user?._id||props.user?.id||'')+':'+token} {...props} token={token}/>;
}
function Reviews({ supplierId, user, token, compact=false }) {
  const l = useLabels(), { lang } = useTranslation();
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ stars: '', comment: '' }), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [submitError, setSubmitError] = useState('');
  const { data, loading, error } = usePublicResource('/reviews/' + supplierId + '?limit=5&page=' + page + '&revision=' + revision);
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
  const stats = data?.stats;
  const validStats = Number.isInteger(stats?.total) && stats.total > 0 && Number.isFinite(stats.avg) && stats.avg >= 1 && stats.avg <= 5;
  const reviews = Array.isArray(data?.data) ? data.data.filter(review => Number.isInteger(review.stars) && review.stars >= 1 && review.stars <= 5) : [];
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
      {validStats && <p className="atlas-detail-rating"><span aria-hidden="true">★</span> <strong>{stats.avg.toFixed(1)}/5</strong> · {stats.total} {l('تقييم', 'avis')}</p>}
    </div>
    <p className="atlas-detail-muted">{l('المعدل يحتسب تقييمات التعاملات التي أقرها الطرفان فقط؛ لا يمثل إثباتاً مستقلاً للدفع أو التسليم.', 'La moyenne inclut uniquement les transactions confirmées par les deux parties, sans preuve indépendante de paiement ou de livraison.')}</p>
    {loading && <p role="status">{l('جاري تحميل التقييمات…', 'Chargement des avis…')}</p>}
    <Notice error>{error?.message}</Notice>
    {data && !error && !reviews.length && <p className="atlas-reviews-empty">{l('لا توجد تعليقات منشورة في هذه الصفحة بعد.', 'Aucun commentaire publié sur cette page pour le moment.')}</p>}
    {reviews.map(review => {
      const date = new Date(review.date), validDate = Boolean(review.date) && !Number.isNaN(date.getTime());
      return <article key={review._id} className="atlas-detail-review">
        <header><strong>{review.userName || l('مستخدم المنصة', 'Utilisateur de la plateforme')}</strong><span aria-label={l('التقييم: ', 'Note : ') + review.stars + '/5'}>{'★'.repeat(review.stars)} <span>{review.stars}/5</span></span></header>
        <p className="muted">{review.basis==='mutual_confirmation'?l('تعامل أقره الطرفان','Transaction confirmée mutuellement','Mutually confirmed transaction'):l('تقييم تاريخي غير محتسب في المعدل','Avis historique exclu de la moyenne','Legacy review excluded from rating')}</p>
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
