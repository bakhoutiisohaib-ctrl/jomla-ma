import { localeFor } from '../../i18n/useLabels';
import { useState } from 'react';
import { apiRequest } from '../../api/config';
import { usePublicResource } from '../common/usePublicPage';
import { useLabels } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';

export default function ProductSupplierReviews({ supplierId, user }) {
  const l = useLabels(), { lang } = useTranslation();
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [form, setForm] = useState({ stars: '', comment: '' }), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [submitError, setSubmitError] = useState('');
  const { data, loading, error } = usePublicResource('/reviews/' + supplierId + '?limit=5&page=' + page + '&revision=' + revision);
  const stats = data?.stats;
  const validStats = Number.isInteger(stats?.total) && stats.total > 0 && Number.isFinite(stats.avg) && stats.avg >= 1 && stats.avg <= 5;
  const reviews = Array.isArray(data?.data) ? data.data.filter(review => Number.isInteger(review.stars) && review.stars >= 1 && review.stars <= 5) : [];
  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage(''); setSubmitError('');
    try {
      await apiRequest('/reviews', { method: 'POST', body: { supplierId, stars: Number(form.stars), comment: form.comment.trim() } });
      setForm({ stars: '', comment: '' }); setPage(1); setRevision(value => value + 1);
      setMessage(l('تم نشر تقييمك للمورد.', 'Votre avis sur le fournisseur a été publié.'));
    } catch (failure) { setSubmitError(failure.message); }
    finally { setBusy(false); }
  }
  return <section id="product-reviews" className="atlas-detail-section atlas-detail-reviews" aria-label={l('تقييمات المورد وتعليقاته', 'Avis et commentaires sur le fournisseur')}>
    <div className="atlas-detail-section-heading"><h2>{l('تقييمات المورد وتعليقاته', 'Avis et commentaires sur le fournisseur')}</h2>
      {validStats && <p className="atlas-detail-rating"><span aria-hidden="true">★</span> <strong>{stats.avg.toFixed(1)}/5</strong> · {stats.total} {l('تقييم', 'avis')}</p>}
    </div>
    <p className="atlas-detail-muted">{l('هذه التقييمات تخص المورد، ولا تثبت وجود عملية شراء موثقة.', 'Ces avis concernent le fournisseur et ne prouvent pas un achat vérifié.')}</p>
    {loading && <p role="status">{l('جاري تحميل التقييمات…', 'Chargement des avis…')}</p>}
    <Notice error>{error?.message}</Notice>
    {data && !error && !reviews.length && <p className="atlas-reviews-empty">{l('لا توجد تعليقات منشورة في هذه الصفحة بعد.', 'Aucun commentaire publié sur cette page pour le moment.')}</p>}
    {reviews.map(review => {
      const date = new Date(review.date), validDate = Boolean(review.date) && !Number.isNaN(date.getTime());
      return <article key={review._id} className="atlas-detail-review">
        <header><strong>{review.userName || l('مستخدم المنصة', 'Utilisateur de la plateforme')}</strong><span aria-label={l('التقييم: ', 'Note : ') + review.stars + '/5'}>{'★'.repeat(review.stars)} <span>{review.stars}/5</span></span></header>
        {validDate && <time dateTime={date.toISOString()}>{date.toLocaleDateString(localeFor(lang))}</time>}
        {review.comment && <p>{review.comment}</p>}
        {review.reply?.text && <blockquote><strong>{l('رد المورد', 'Réponse du fournisseur')}</strong><p>{review.reply.text}</p></blockquote>}
      </article>;
    })}
    {(page > 1 || data?.pagination?.hasNextPage) && <nav className="pager" aria-label={l('صفحات التقييمات', 'Pages des avis')}>
      <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>{l('السابق', 'Précédent')}</button><span>{page}</span>
      <button type="button" disabled={!data?.pagination?.hasNextPage || loading} onClick={() => setPage(value => value + 1)}>{l('التالي', 'Suivant')}</button>
    </nav>}
    {user?.role === 'buyer' && <form className="atlas-detail-review-form" onSubmit={submit}>
      <h3>{l('شارك تجربتك مع المورد', 'Partagez votre expérience avec le fournisseur')}</h3>
      <Field label={l('تقييمك', 'Votre note')}><select required disabled={busy} value={form.stars} onChange={event => setForm({ ...form, stars: event.target.value })}><option value="">{l('اختر التقييم', 'Choisir une note')}</option>{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value}/5</option>)}</select></Field>
      <Field label={l('تعليقك', 'Votre commentaire')}><textarea required minLength={3} maxLength={500} rows={3} disabled={busy} value={form.comment} onChange={event => setForm({ ...form, comment: event.target.value })} /></Field>
      <button className="primary" disabled={busy || !form.stars || form.comment.trim().length < 3}>{busy ? l('جاري النشر…', 'Publication…') : l('نشر التقييم', 'Publier mon avis')}</button>
    </form>}
    <Notice error>{submitError}</Notice><Notice>{message}</Notice>
  </section>;
}
