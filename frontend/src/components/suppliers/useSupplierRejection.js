import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';

// One terminal refusal per RFQ. Only an explicit click sends/retries it;
// polling reads progress and the server worker completes the durable intent.
export default function useSupplierRejection({ rfqId, progress, status, onUpdated }) {
  const token = useSessionToken(), callbacks = useRef(onUpdated); callbacks.current = onUpdated;
  const [phase, setPhase] = useState('idle'), [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), busy = useRef(false), controller = useRef(null), timer = useRef(null);
  useEffect(() => {
    generation.current += 1; busy.current = false; controller.current?.abort(); clearTimeout(timer.current);
    setPhase('idle'); setError(''); setLoading(false); setWaiting(false);
    return () => { generation.current += 1; controller.current?.abort(); clearTimeout(timer.current); };
  }, [rfqId, token]);
  useEffect(() => {
    if (progress?.phase === 'pending') setPhase('pending');
    if (progress?.phase === 'completed' && status === 'rejected') setPhase('completed');
  }, [rfqId, token, progress?.phase, status]);

  async function submit() {
    if (!rfqId || !token || busy.current || waiting || phase === 'completed') return;
    const stamp = generation.current, id = rfqId;
    const abort = new AbortController(); controller.current = abort; busy.current = true;
    const valid = () => stamp === generation.current && !abort.signal.aborted && token === getSessionToken();
    setLoading(true); setError('');
    try {
      const result = await apiRequest('/rfq/' + id + '/respond', { method: 'PUT', body: { status: 'rejected' }, token, signal: abort.signal });
      if (!valid()) return;
      const completed = !result.processing && result.rfq?.status === 'rejected' && result.rejection?.phase === 'completed';
      setPhase(completed ? 'completed' : result.processing ? 'pending' : 'uncertain');
      callbacks.current?.(result);
      if (!completed) pause();
    } catch (failure) {
      if (!valid()) return;
      setPhase('uncertain'); setError(failure.message); pause();
    } finally {
      if (valid()) { busy.current = false; setLoading(false); }
    }
    function pause() {
      setWaiting(true); clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (valid()) setWaiting(false); }, 5000);
    }
  }
  return { phase, loading, waiting, error, submit, blocked: loading || ['pending', 'uncertain'].includes(phase) };
}
