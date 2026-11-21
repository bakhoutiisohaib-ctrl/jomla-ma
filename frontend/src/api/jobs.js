import { apiRequest } from './config';

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function waitForJob(job, { signal, timeoutMs = 100000, intervalMs = 1200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (job.status === 'succeeded') return job.result;
    if (job.status === 'failed') {
      const french = localStorage.getItem('jomla_lang') === 'fr';
      throw Object.assign(new Error(french ? 'L’analyse a échoué. Vous pouvez compléter le produit manuellement.' : 'تعذر تحليل الصورة. يمكنك إكمال بيانات المنتج يدوياً.'), { code: job.error?.code });
    }
    if (Date.now() >= deadline) {
      const french = localStorage.getItem('jomla_lang') === 'fr';
      throw new Error(french ? 'La tâche reste enregistrée. Consultez les tâches de votre espace ou continuez manuellement.' : 'المهمة ما زالت محفوظة. تابعها من مهام لوحة المورد أو أكمل البيانات يدوياً.');
    }
    await pause(intervalMs, signal);
    ({ job } = await apiRequest('/jobs/' + job.id, { signal }));
  }
}
