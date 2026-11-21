import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';
import { Field, Notice } from '../common/WorkspaceUI';
export default function ReviewSection({
  supplierId
}) {
  const l = useLabels(),
    [reviews, setReviews] = useState([]),
    [stats, setStats] = useState({}),
    [revision, setRevision] = useState(0),
    [form, setForm] = useState({
      stars: 5,
      comment: ''
    }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    apiRequest('/reviews/' + supplierId, {
      signal: c.signal
    }).then(d => {
      setReviews(d.data || []);
      setStats(d.stats || {});
    }).catch(e => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => c.abort();
  }, [supplierId, revision]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest('/reviews', {
        method: 'POST',
        body: {
          supplierId,
          stars: Number(form.stars),
          comment: form.comment
        }
      });
      setForm({
        stars: 5,
        comment: ''
      });
      setRevision(r => r + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="panel" style={{
    marginTop: 20
  }}><h2>{l('تقييمات المشترين', 'Avis des acheteurs')} ({stats.total || 0})</h2><p>{stats.avg || '—'} / 5</p>{reviews.map(r => <article key={r._id} className="message"><strong>{r.userName}</strong><p>{'★'.repeat(r.stars || 0)} {r.comment}</p>{r.reply?.text && <p className="notice">{r.reply.text}</p>}</article>)}<Notice error>{error}</Notice>{localStorage.getItem('supplierToken') && <form onSubmit={submit}><Field label={l('تقييمك', 'Votre note')}><select value={form.stars} onChange={e => setForm({
          ...form,
          stars: e.target.value
        })}>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}/5</option>)}</select></Field><Field label={l('تعليقك', 'Votre commentaire')}><textarea required minLength={3} maxLength={500} rows={3} value={form.comment} onChange={e => setForm({
          ...form,
          comment: e.target.value
        })} /></Field><button disabled={busy}>{l('إرسال التقييم', 'Publier mon avis')}</button></form>}</section>;
}
