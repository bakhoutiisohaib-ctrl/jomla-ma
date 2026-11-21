import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { NotificationBell } from './MarketLayout';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { clearSession, setSession } from '../../api/session';
const account = { _id: 'buyer-a', role: 'buyer' };
const token = id => 'test.' + btoa(JSON.stringify({ id, exp: 9999999999 })) + '.signature';
const reply = count => ({ ok: true, status: 200, json: async () => ({ data: [], unreadCount: count }) });
const view = user => <LanguageProvider><NotificationBell user={user} onAccount={() => {}} /></LanguageProvider>;
beforeEach(() => { localStorage.clear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test.each([['buyer', 2], ['supplier', 0]])('the %s bell reads the existing unread count without modifying notifications', async (role, count) => {
  setSession(token(role)); global.fetch = jest.fn().mockResolvedValue(reply(count));
  render(view({ ...account, role }));
  const label = count ? 'الإشعارات: 2 غير مقروءة' : 'الإشعارات: لا توجد إشعارات جديدة';
  await waitFor(() => expect(screen.getByLabelText(label)).toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith('/api/notifications', expect.objectContaining({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer ' + token(role) } }));
  expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  if (count === 0) expect(document.querySelector('.atlas-unread')).toBeNull();
});

test('no bell or notification request is exposed to a visitor', () => {
  global.fetch = jest.fn(); render(view(null));
  expect(document.querySelector('.atlas-notifications')).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});

test('logout and an account switch cannot render a late unread count from the previous session', async () => {
  let finish; setSession(token('a'));
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(reply(0));
  const rendered = render(view(account));
  act(() => { clearSession(); setSession(token('b')); });
  rendered.rerender(view({ _id: 'buyer-b', role: 'buyer' }));
  await waitFor(() => expect(screen.getByLabelText('الإشعارات: لا توجد إشعارات جديدة')).toBeInTheDocument());
  await act(async () => finish(reply(9)));
  expect(document.querySelector('.atlas-unread')).toBeNull();
  act(() => clearSession()); rendered.rerender(view(null));
  expect(document.querySelector('.atlas-notifications')).toBeNull();
});

test('an unavailable count is not represented as an empty inbox and is localized in French', async () => {
  localStorage.setItem('jomla_lang', 'fr'); setSession(token('a')); global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(view(account));
  await waitFor(() => expect(screen.getByLabelText('Notifications: Nombre non confirmé actuellement')).toBeInTheDocument());
  expect(document.querySelector('.atlas-unread')).toBeNull();
});
