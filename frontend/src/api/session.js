import { useSyncExternalStore } from 'react';

const SESSION_EVENT = 'jomla:session-change';
function storedToken() {
  return localStorage.getItem('supplierToken') || localStorage.getItem('adminToken') || '';
}
function expiresAt(token) {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : Infinity;
  } catch {
    // The server remains authoritative for legacy/malformed tokens.
    return Infinity;
  }
}
export function getSessionToken() {
  const token = storedToken();
  return expiresAt(token) > Date.now() ? token : '';
}
export function setSession(token) {
  localStorage.setItem('supplierToken', token);
  localStorage.removeItem('adminToken');
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function clearSession(expectedToken) {
  // A late 401 from the old account must not sign out its replacement.
  if (expectedToken !== undefined && storedToken() !== expectedToken) return;
  localStorage.removeItem('supplierToken');
  localStorage.removeItem('adminToken');
  window.dispatchEvent(new Event(SESSION_EVENT));
}
export function subscribeSession(listener) {
  let timer;
  function changed(event) {
    if (event?.type === 'storage' && event.key && !['supplierToken', 'adminToken'].includes(event.key)) return;
    clearTimeout(timer);
    const token = storedToken();
    const remaining = expiresAt(token) - Date.now();
    if (token && Number.isFinite(remaining) && remaining > 0) {
      timer = setTimeout(changed, Math.min(remaining, 2147483647));
    }
    listener();
  }
  window.addEventListener(SESSION_EVENT, changed);
  window.addEventListener('storage', changed);
  changed();
  return () => {
    clearTimeout(timer);
    window.removeEventListener(SESSION_EVENT, changed);
    window.removeEventListener('storage', changed);
  };
}
export function useSessionToken() {
  return useSyncExternalStore(subscribeSession, getSessionToken, () => '');
}
