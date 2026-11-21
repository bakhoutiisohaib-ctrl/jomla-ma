import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSessionToken } from '../../api/session';

const CartContext = createContext(null);
const EVENT = 'jomla:quote-cart';
export const CART_LIMIT = 24;
const prefix = 'jomla:quote-selection:v1:';
const validId = id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
function owner(token) {
  if (!token) return 'guest';
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return /^[a-z0-9_-]{1,80}$/i.test(payload.id) ? payload.id : 'unavailable';
  } catch { return 'unavailable'; }
}
function read(key) { try { return sessionStorage.getItem(key) || '[]'; } catch { return '[]'; } }
function parse(raw) { try { const value = JSON.parse(raw); return Array.isArray(value) ? [...new Set(value.filter(validId))].slice(0, CART_LIMIT) : []; } catch { return []; } }
function write(key, items) {
  try { sessionStorage.setItem(key, JSON.stringify(items)); window.dispatchEvent(new Event(EVENT)); return true; } catch { return false; }
}
function subscribe(listener) { window.addEventListener(EVENT, listener); window.addEventListener('storage', listener); return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); }; }

export function QuoteCartProvider({ children }) {
  const token = useSessionToken(), account = owner(token), key = prefix + account;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => '[]');
  const items = useMemo(() => parse(raw), [raw]);
  useEffect(() => {
    if (account === 'guest' || account === 'unavailable') return;
    const guestKey = prefix + 'guest', guestItems = parse(read(guestKey));
    if (!guestItems.length) return;
    const mine = parse(read(key));
    const accepted = [...new Set([...mine, ...guestItems])].slice(0, CART_LIMIT);
    if (write(key, accepted)) write(guestKey, guestItems.filter(id => !accepted.includes(id)));
  }, [account, key]);
  const cart = {
    items,
    add(id) {
      if (!validId(id)) return 'invalid';
      const current = parse(read(key));
      if (current.includes(id)) return 'exists';
      if (current.length >= CART_LIMIT) return 'full';
      return write(key, [...current, id]) ? 'added' : 'unavailable';
    },
    remove(id) { return write(key, parse(read(key)).filter(item => item !== id)); }
  };
  return <CartContext.Provider value={cart}>{children}</CartContext.Provider>;
}
export function useQuoteCart() { return useContext(CartContext); }
