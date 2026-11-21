import { useEffect, useState } from 'react';
import { mediaUrl } from '../../api/media';
import { clearSession, getSessionToken, subscribeSession, useSessionToken } from '../../api/session';

export const MEDIA_REVALIDATE_MS = 15000;
export const MEDIA_REFRESH_MS = 12000;

function useProtectedMedia(value) {
  const token = useSessionToken();
  const endpoint = mediaUrl(value);
  const [resource, setResource] = useState(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    let controller;
    let generation = 0;
    let expiryTimer;
    function discard() {
      clearTimeout(expiryTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      if (active) setResource(null);
    }
    function cancel() {
      generation++;
      controller?.abort();
      discard();
    }
    async function load() {
      generation++;
      controller?.abort();
      if (!active || !endpoint || token !== getSessionToken() || document.visibilityState === 'hidden') { discard(); return; }
      // Refresh before the existing authorization expires. A slow response never
      // extends the old image's deadline; logout, hiding and denial still revoke it.
      const startedAt = Date.now();
      controller = new AbortController();
      const request = controller;
      const currentGeneration = generation;
      try {
        const response = await fetch(endpoint, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
          signal: request.signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error'
        });
        if (token && response.status === 401) clearSession(token);
        if (!active || request.signal.aborted || currentGeneration !== generation || token !== getSessionToken()) return;
        if (!response.ok) { discard(); return; }
        const blob = await response.blob();
        if (!active || request.signal.aborted || currentGeneration !== generation || token !== getSessionToken() || document.visibilityState === 'hidden') return;
        const remaining = MEDIA_REVALIDATE_MS - (Date.now() - startedAt);
        if (remaining <= 0 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type)) { discard(); return; }
        const previousUrl = objectUrl;
        objectUrl = URL.createObjectURL(blob);
        setResource({ token, endpoint, src: objectUrl });
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(discard, remaining);
      } catch {
        // No cached private image survives an unsuccessful authorization refresh.
        if (active && !request.signal.aborted && currentGeneration === generation) discard();
      }
    }
    // Revoke immediately when the session changes, including same-tab logout.
    const unsubscribe = subscribeSession(() => {
      if (token !== getSessionToken()) cancel();
    });
    function visibilityChanged() {
      if (document.visibilityState === 'hidden') cancel();
      else load();
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    const timer = endpoint ? setInterval(load, MEDIA_REFRESH_MS) : null;
    load();
    return () => {
      active = false;
      cancel();
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [token, endpoint]);
  // Gate during render too: effects run after render, so old state cannot flash.
  return resource?.token === token && resource.endpoint === endpoint ? resource.src : '';
}

export default function ProtectedImage({ value, alt = '', ...props }) {
  const src = useProtectedMedia(value);
  return src ? <img {...props} src={src} alt={alt} /> : null;
}

