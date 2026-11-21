import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';

// Read server revisions and immutable decisions; never infer a completed trade.
export function latestRecord(previous, incoming) {
  if (!previous) return incoming;
  if (Number.isInteger(previous.revision) && Number.isInteger(incoming.revision) && incoming.revision < previous.revision) return previous;
  if (previous.decision && !incoming.decision) return previous;
  if (previous.decision?.phase === 'completed' && incoming.decision?.phase === 'pending') return previous;
  return incoming;
}

export default function useBuyerWorkspace(c) {
  const token = useSessionToken(), labels = useRef(c); labels.current = c;
  const alive = useRef(true), controllers = useRef({}), generation = useRef(0), busyRef = useRef(false), openingRef = useRef(false);
  const rows = useRef([]), selectedRef = useRef(null), threadRevision = useRef(0);
  const [rfqs, setRfqs] = useState([]), [sourcing, setSourcing] = useState([]), [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [opening, setOpening] = useState(false);
  const [selectedId, setSelectedId] = useState(null), [thread, setThread] = useState(null), [offers, setOffers] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false), [threadError, setThreadError] = useState('');
  const [error, setError] = useState(''), [loadErrors, setLoadErrors] = useState({}), [feedback, setFeedback] = useState(''), [uncertainId, setUncertainId] = useState(null);
  const dispose = useCallback(() => { alive.current = false; generation.current++; threadRevision.current++; Object.values(controllers.current).forEach(x => x.abort()); }, []);
  const cancelThread = useCallback(() => { controllers.current.thread?.abort();threadRevision.current++; }, []);
  useEffect(() => { alive.current = true; return dispose; }, [dispose]);
  const valid = useCallback(controller => alive.current && !controller.signal.aborted && token === getSessionToken(), [token]);
  const commitRows = useCallback(list => { rows.current = list; setRfqs(list); }, []);
  const mergeRecord = useCallback(record => {
    const old = rows.current.find(r => r._id === record._id);
    const value = latestRecord(old, old ? { ...old, status: record.status, decision: record.decision, currentOfferId: record.currentOfferId,
      revision: record.revision, offer: record.offer ?? old.offer } : record);
    commitRows(old ? rows.current.map(r => r._id === record._id ? value : r) : [value, ...rows.current]);
  }, [commitRows]);
  const refresh = useCallback(async () => {
    controllers.current.refresh?.abort(); const controller = new AbortController(); controllers.current.refresh = controller;
    const revision = ++generation.current;
    const paths = ['/rfq/buyer','/sourcing/buyer','/notifications'];
    const result = await Promise.allSettled(paths.map(path => apiRequest(path,{token,signal:controller.signal,cache:'no-store'})));
    if (!valid(controller) || revision !== generation.current) return;
    const failures = {};
    result.forEach((r,i) => { if (r.status==='rejected') failures[paths[i]] = r.reason.message; });
    if (result[0].status==='fulfilled') {
      commitRows((result[0].value.data || []).map(r => latestRecord(rows.current.find(old => old._id===r._id),r)));
      setUncertainId(null);
    }
    if (result[1].status==='fulfilled') setSourcing(result[1].value.data || []);
    if (result[2].status==='fulfilled') {
      setNotifications(result[2].value.data || []);
      const n = result[2].value.unreadCount; setUnread(Number.isSafeInteger(n) && n>=0 ? n : null);
    } else setUnread(null);
    setLoadErrors(failures); setLoading(false);
  }, [commitRows, token, valid]);
  const loadThread = useCallback(async id => {
    if (!id || id !== selectedRef.current) return;
    controllers.current.thread?.abort(); const controller = new AbortController(); controllers.current.thread = controller;
    const revision = ++threadRevision.current; setThreadLoading(true);
    try {
      const result = await apiRequest('/rfq/'+id+'/thread',{token,signal:controller.signal,cache:'no-store'});
      if (!valid(controller) || id!==selectedRef.current || revision!==threadRevision.current) return;
      setThread(result.thread); setOffers(result.offers || []); setThreadError('');
      if (result.rfq) mergeRecord(result.rfq);
    } catch (e) { if (valid(controller) && revision===threadRevision.current) setThreadError(e.message); }
    finally { if (valid(controller) && revision===threadRevision.current) setThreadLoading(false); }
  }, [mergeRecord, token, valid]);
  useEffect(() => {
    const pending=controllers.current;
    const update = () => { if (!busyRef.current && document.visibilityState!=='hidden') { refresh(); if (selectedRef.current) loadThread(selectedRef.current); } };
    update(); const timer=setInterval(update,30000);
    window.addEventListener('focus',update); document.addEventListener('visibilitychange',update);
    return () => { clearInterval(timer); window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);pending.refresh?.abort(); };
  }, [refresh,loadThread]);
  useEffect(() => { if (selectedId) loadThread(selectedId); return cancelThread; }, [selectedId,loadThread,cancelThread]);
  function chooseRequest(id) {
    selectedRef.current=id;threadRevision.current++;controllers.current.thread?.abort();
    setThread(null);setOffers([]);setThreadError('');setThreadLoading(Boolean(id));setSelectedId(id);setError('');setFeedback('');
  }
  async function run(action, { target, decision = false } = {}) {
    if (busyRef.current) return false;
    busyRef.current=true;setBusy(true);setError('');setFeedback('');
    controllers.current.refresh?.abort();generation.current++;
    controllers.current.thread?.abort();threadRevision.current++;
    const controller=new AbortController();controllers.current.action=controller;
    try {
      const result=await action({token,signal:controller.signal});
      if (!valid(controller)) return false;
      if (result?.rfq) mergeRecord(result.rfq);
      if (decision && result?.processing && !result.rfq) setUncertainId(target);
      await refresh(); if (!valid(controller)) return false;
      if (selectedRef.current) await loadThread(selectedRef.current);
      if (valid(controller) && (!target || target===selectedRef.current)) {
        const current=rows.current.find(r=>r._id===target);
        setFeedback(result?.processing && current?.status!=='accepted' && current?.status!=='rejected' ? labels.current.processing : labels.current.saved);
      }
      return true;
    } catch (e) {
      if (valid(controller)) { setError(e.message || labels.current.error); if (decision) setUncertainId(target); }
      return false;
    } finally { busyRef.current=false;if (valid(controller)) {setBusy(false);setThreadLoading(false);} }
  }
  async function verifiedNotificationTarget(n) {
    if (openingRef.current || busyRef.current) return null;
    openingRef.current=true;setOpening(true);setError('');
    const controller=new AbortController();controllers.current.open?.abort();controllers.current.open=controller;
    try {
      if (!['rfq','sourcing'].includes(n.resourceType) || !n.resourceId) return null;
      if (n.resourceType==='rfq') {
        const record=await apiRequest('/rfq/'+n.resourceId,{token,signal:controller.signal,cache:'no-store'});
        if (!valid(controller)) return null;
        mergeRecord(record);chooseRequest(record._id);
      } else {
        // The authenticated buyer list is the allowed set; no guessed public URL.
        const result=await apiRequest('/sourcing/buyer',{token,signal:controller.signal,cache:'no-store'});
        if (!valid(controller)) return null;
        if (!(result.data || []).some(r=>r._id===n.resourceId)) {setError(labels.current.unavailable);return null;}
        setSourcing(result.data || []);
      }
      return n.resourceType;
    } catch (e) {if (valid(controller)) setError(e.message);return null;}
    finally {openingRef.current=false;if (valid(controller))setOpening(false);}
  }
  return {rfqs,sourcing,notifications,unread,loading,busy,opening,selectedId,selected:rfqs.find(r=>r._id===selectedId),thread,offers,threadLoading,threadError,
    error,loadErrors,feedback,uncertainId,refresh,loadThread,run,chooseRequest,verifiedNotificationTarget,setError,valid};
}
