import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { Notice } from '../common/WorkspaceUI';

export default function JobsPanel({ onReview }) {
  const l = useLabels();
  const [jobs, setJobs] = useState([]), [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [revision, setRevision] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    apiRequest('/jobs/mine?page=' + page + '&limit=10', { signal: controller.signal }).then(data => {
      setJobs(data.data || []); setPages(data.pagination?.pages || 1); setError('');
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [page, revision]);
  useEffect(() => {
    const timer = setInterval(() => setRevision(n => n + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  const status = value => ({
    pending: l('في الانتظار', 'En attente'), running: l('قيد التنفيذ', 'En cours'),
    retry_wait: l('بانتظار إعادة المحاولة', 'Nouvelle tentative prévue'),
    succeeded: l('اكتملت', 'Terminée'), failed: l('فشلت', 'Échec')
  }[value] || value);
  return <section className="panel"><div className="actions"><h2>{l('مهام الصور', 'Tâches des images')}</h2><button onClick={() => setRevision(n => n + 1)}>{l('تحديث', 'Actualiser')}</button></div>
    <p className="muted">{l('النتائج محفوظة بعد إغلاق الصفحة. افتح المسودة لمراجعتها؛ لا تنشر المهام منتجات تلقائياً.', 'Les résultats restent enregistrés après fermeture. Ouvrez le brouillon pour le vérifier ; les tâches ne publient pas automatiquement.')}</p>
    <Notice error>{error}</Notice>
    {jobs.map(job => <article className={'panel ' + (job.status === 'failed' ? 'job-failed' : '')} key={job.id}>
      <h3>{job.type === 'ai_product_draft' ? l('وصف من الصورة', 'Description visuelle') : l('فهرسة الصورة', 'Indexation visuelle')}</h3>
      <p>{status(job.status)} · {l('المحاولات', 'Tentatives')}: {job.attempts}/{job.maxAttempts}</p>
      {job.status === 'failed' && <p>{l('تعذر إكمال المهمة. يمكنك إدخال البيانات يدوياً أو المحاولة مجدداً.', 'La tâche a échoué. Complétez les données manuellement ou réessayez.')}</p>}
      {job.status === 'succeeded' && job.result?.status === 'unindexed' && <p>{l('لم تُفهرس الصورة؛ استخدم صورة محلية مرفوعة وصالحة.', 'Image non indexée : utilisez une image locale importée et valide.')}</p>}
      {job.type === 'ai_product_draft' && job.status === 'succeeded' && job.result?.draft && <button onClick={() => onReview({
        jobId: job.id, imageUrl: job.result.imageUrl, name: job.result.draft.title,
        category: job.result.draft.category, description: job.result.draft.description
      })}>{l('فتح للمراجعة', 'Ouvrir pour vérifier')}</button>}
    </article>)}
    {!jobs.length && <p>{l('لا توجد مهام محفوظة بعد.', 'Aucune tâche enregistrée.')}</p>}
    <div className="pager"><button disabled={page <= 1} onClick={() => setPage(n => n - 1)}>{l('السابق', 'Précédent')}</button><span>{page}/{Math.max(pages, 1)}</span><button disabled={page >= pages} onClick={() => setPage(n => n + 1)}>{l('التالي', 'Suivant')}</button></div>
  </section>;
}
