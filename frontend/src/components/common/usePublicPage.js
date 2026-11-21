import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/config';

export function usePublicResource(endpoint) {
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true, controller;
    async function load() {
      if (document.visibilityState === 'hidden') return;
      controller?.abort(); controller = new AbortController();
      const request = controller;
      try {
        const data = await apiRequest(endpoint, { signal: request.signal, cache: 'no-store', token: '' });
        if (active && !request.signal.aborted) setState({ endpoint, data });
      } catch (error) {
        if (active && !request.signal.aborted) setState({ endpoint, error });
      }
    }
    function changed() {
      if (document.visibilityState === 'hidden') { controller?.abort(); setState(null); }
      else load();
    }
    load();
    const timer = setInterval(load, 30000);
    document.addEventListener('visibilitychange', changed);
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', changed); };
  }, [endpoint, revision]);
  return { ...(state?.endpoint === endpoint ? state : { loading: true }), refresh };
}

const defaultDescription = 'Jomla.ma — سوق الجملة المغربي / Marché de gros au Maroc.';
export function usePublicMeta(title, description, path) {
  useEffect(() => {
    const set = (selector, attribute, value) => {
      const element = document.head.querySelector(selector);
      if (element) element.setAttribute(attribute, value);
    };
    document.title = title ? title + ' | Jomla.ma' : 'Jomla.ma';
    set('meta[name="description"]', 'content', description?.slice(0, 180) || defaultDescription);
    set('meta[property="og:title"]', 'content', document.title);
    set('meta[property="og:description"]', 'content', description?.slice(0, 180) || defaultDescription);
    let canonical;
    if (title && path) {
      canonical = document.createElement('link'); canonical.rel = 'canonical';
      canonical.href = new URL(path, window.location.origin).href; document.head.append(canonical);
    }
    return () => {
      canonical?.remove(); document.title = 'Jomla.ma';
      set('meta[name="description"]', 'content', defaultDescription);
      set('meta[property="og:title"]', 'content', 'Jomla.ma');
      set('meta[property="og:description"]', 'content', defaultDescription);
    };
  }, [title, description, path]);
}
