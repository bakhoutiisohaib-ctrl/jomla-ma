import { useEffect, useRef } from 'react';
import { getSessionToken } from '../../api/session';

// A response belongs to the mounted screen, its original route and session.
export default function useAccountAttempt() {
  const pending = useRef(null);
  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);
  return {
    begin() {
      if (pending.current) return null;
      const controller = new AbortController();
      const token = getSessionToken();
      const location = window.location.pathname + window.location.search;
      pending.current = controller;
      return {
        signal: controller.signal, token,
        current: () => pending.current === controller && !controller.signal.aborted &&
          getSessionToken() === token && window.location.pathname + window.location.search === location,
        finish: () => {
          if (pending.current !== controller) return false;
          pending.current = null;
          return true;
        }
      };
    }
  };
}