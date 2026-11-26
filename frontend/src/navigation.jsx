import { useSyncExternalStore } from 'react';

const EVENT = 'jomla:navigate';
const pages = { '/': 'home', '/stores': 'stores', '/login': 'login', '/register': 'register',
  '/forgot-password': 'forgotPassword', '/reset-password': 'resetPassword',
  '/opportunities': 'opportunities', '/cart': 'cart', '/favorites': 'favorites',
  '/buyer': 'buyer', '/supplier': 'supplier', '/admin': 'admin' };
export const productPath = id => '/products/' + encodeURIComponent(id);
export const storePath = id => '/stores/' + encodeURIComponent(id);
export const supplierPath = id => '/suppliers/' + encodeURIComponent(id);
export const opportunityPath = id => '/opportunities/' + encodeURIComponent(id);
export const pagePath = page => Object.keys(pages).find(path => pages[path] === page) || '/';

export function parseRoute(value) {
  const url = new URL(value, window.location.origin);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (pages[path]) return { page: pages[path], search: url.search, path };
  const match = /^\/(products|stores|suppliers|opportunities)\/([a-f0-9]{24})$/i.exec(path);
  if (match) return { page: { products: 'product', stores: 'store', suppliers: 'supplierPublic', opportunities: 'opportunity' }[match[1].toLowerCase()],
    id: match[2].toLowerCase(), search: url.search, path };
  return { page: 'notFound', search: '', path };
}
export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('Navigation must stay within this application');
  const destination = url.pathname + url.search + url.hash;
  if (destination !== currentLocation()) window.history[replace ? 'replaceState' : 'pushState']({}, '', destination);
  window.dispatchEvent(new Event(EVENT));
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}
const currentLocation = () => window.location.pathname + window.location.search + window.location.hash;
function subscribe(listener) {
  window.addEventListener('popstate', listener); window.addEventListener('hashchange', listener); window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener('hashchange', listener); window.removeEventListener(EVENT, listener); };
}
export function useRoute() {
  const href = useSyncExternalStore(subscribe, currentLocation, () => '/');
  return { ...parseRoute(href), href };
}
export const dashboardPath = role => role === 'buyer' ? '/buyer' : role === 'admin' ? '/admin' : '/supplier';
export function safeReturnTo(search, role) {
  const raw = new URLSearchParams(search).get('returnTo');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '';
  let url;
  try { url = new URL(raw, window.location.origin); } catch { return ''; }
  if (url.origin !== window.location.origin) return '';
  const route = parseRoute(url.href);
  if (route.page === 'product') return productPath(route.id) + (url.searchParams.get('rfq') === '1' ? '?rfq=1' : '');
  if (route.page === 'opportunity') return opportunityPath(route.id) + (url.searchParams.get('rfq') === '1' ? '?rfq=1' : '');
  if (['home', 'stores', 'store', 'supplierPublic', 'opportunities', 'cart'].includes(route.page)) return route.path + url.search;
  if (route.page === 'favorites' && role === 'buyer') return '/favorites';
  if (route.path === dashboardPath(role)) return route.path;
  return '';
}
export function loginPath(returnTo) {
  return '/login' + (typeof returnTo === 'string' ? '?returnTo=' + encodeURIComponent(returnTo) : '');
}
export function Link({ to, onClick, target, children, ...props }) {
  return <a {...props} href={to} target={target} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (target && target !== '_self')) return;
    event.preventDefault(); navigate(to);
  }}>{children}</a>;
}
