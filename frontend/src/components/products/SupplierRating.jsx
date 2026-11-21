import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useLabels } from '../../i18n/useLabels';

// Share only pending public requests, never persist a supplier's rating snapshot.
const pending = new Map();
function readRating(id) {
  if (!pending.has(id)) {
    const request = apiRequest('/reviews/' + id + '?limit=1', { token: '', cache: 'no-store' })
      .then(({ stats }) => Number.isInteger(stats?.total) && stats.total > 0 &&
        Number.isFinite(stats.avg) && stats.avg >= 1 && stats.avg <= 5 ? stats : null)
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, request);
  }
  return pending.get(id);
}

export default function SupplierRating({ supplierId }) {
  const l = useLabels(), [state, setState] = useState(null);
  useEffect(() => {
    if (!/^[a-f\d]{24}$/i.test(supplierId || '')) return;
    let active = true, generation = 0;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      const current = ++generation, stats = await readRating(supplierId);
      if (active && current === generation) setState({ id: supplierId, stats });
    }
    function changed() {
      if (document.visibilityState === 'hidden') { generation++; setState(null); }
      else load();
    }
    load();
    const timer = setInterval(load, 30000);
    document.addEventListener('visibilitychange', changed);
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', changed); };
  }, [supplierId]);
  const stats = state && state.id === supplierId ? state.stats : null;
  if (!stats) return null;
  return <p className="atlas-supplier-rating"><span aria-hidden="true">★</span> <strong>{stats.avg.toFixed(1)}/5</strong> <span>{l('تقييم المورد', 'Avis fournisseur')} ({stats.total})</span></p>;
}
