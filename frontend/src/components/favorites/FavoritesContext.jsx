import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken } from '../../api/session';

const Context = createContext(null);
export const validFavoriteId = id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
const validList = data => Array.isArray(data?.productIds) && data.productIds.length <= 100 &&
  data.productIds.every(validFavoriteId) && new Set(data.productIds).size === data.productIds.length;
const blank = scope => ({ scope, ids: null, status: 'loading', busy: false, message: '' });

export function FavoritesProvider({ token, user, children }) {
  const mode = !token ? 'guest' : !user ? 'checking' : user.role === 'buyer' ? 'buyer' : 'other';
  const scope = token + ':' + mode;
  const [state, setState] = useState(() => blank(scope));
  const session = useRef(null);
  const active = useCallback(current => current && session.current === current && token === getSessionToken(), [token]);
  const publish = useCallback((current, changes) => {
    if (!active(current)) return;
    current.state = { ...current.state, ...changes };
    setState(current.state);
  }, [active]);

  const refresh = useCallback(async () => {
    const current = session.current;
    if (mode !== 'buyer' || current?.scope !== scope || !active(current) || current.running) return;
    current.running = true;
    publish(current, { ids: null, status: 'loading', busy: true });
    const request = new AbortController(); current.controller = request;
    try {
      const data = await apiRequest('/favorites', { token, cache: 'no-store', signal: request.signal });
      if (!validList(data)) throw new Error('Invalid favorites response');
      if (!request.signal.aborted) publish(current, { ids: data.productIds, status: 'ready', message: '' });
    } catch {
      if (!request.signal.aborted) publish(current, { status: 'error' });
    } finally {
      current.running = false;
      if (!request.signal.aborted) publish(current, { busy: false });
    }
  }, [active, mode, scope, token, publish]);

  useEffect(() => {
    const current = { scope, state: blank(scope), running: false, controller: null };
    session.current = current;
    setState(current.state);
    refresh();
    const onFocus = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      if (session.current === current) session.current = null;
      current.controller?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [scope, refresh]);

  async function toggle(id) {
    const current = session.current;
    if (mode !== 'buyer' || current?.scope !== scope || !active(current) || current.running || !current.state.ids || !validFavoriteId(id)) return;
    const saved = !current.state.ids.includes(id);
    current.running = true; publish(current, { busy: true, message: '' });
    const request = new AbortController(); current.controller = request;
    try {
      const data = await apiRequest('/favorites/' + id, { token, method: saved ? 'PUT' : 'DELETE', cache: 'no-store', signal: request.signal });
      if (data?.productId !== id || data.saved !== saved) throw new Error('Unconfirmed favorite');
      if (active(current) && !request.signal.aborted) {
        const next = saved ? [...current.state.ids, id] : current.state.ids.filter(item => item !== id);
        publish(current, { ids: next });
      }
    } catch (error) {
      if (!request.signal.aborted) publish(current, { ids: null, status: 'error', message: error.status === 409 ? 'limit' : 'uncertain' });
    } finally {
      current.running = false;
      if (!request.signal.aborted) publish(current, { busy: false });
    }
  }
  const visible = state.scope === scope ? state : blank(scope);
  // The provider stays mounted: changing the private scope must not remount
  // unrelated market/cart children. Scope-tagged state is hidden synchronously.
  return <Context.Provider value={{ mode, ids: mode === 'buyer' ? visible.ids : null, status: visible.status, busy: visible.busy,
    message: visible.message, refresh, toggle, dismiss: () => {
      if (session.current?.scope === scope) publish(session.current, { message: '' });
    } }}>{children}</Context.Provider>;
}
export const useFavorites = () => useContext(Context);
