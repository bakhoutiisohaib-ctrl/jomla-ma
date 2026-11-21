import { act, cleanup, render, screen } from '@testing-library/react';
import ProtectedImage, { MEDIA_REVALIDATE_MS, MEDIA_REFRESH_MS } from './ProtectedImage';
import { clearSession, getSessionToken, setSession } from '../../api/session';
import { apiRequest } from '../../api/config';

const reference = '/uploads/product-private.png';
const token = (id, expires = Math.floor(Date.now() / 1000) + 3600) =>
  'synthetic.' + btoa(JSON.stringify({ id, exp: expires })) + '.signature';
const success = () => ({ ok: true, status: 200, blob: async () => new Blob(['synthetic image'], { type: 'image/png' }) });
const denied = status => ({ ok: false, status, json: async () => ({}) });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  global.fetch = jest.fn().mockResolvedValue(denied(401));
  URL.createObjectURL = jest.fn(() => 'blob:synthetic-owned-image');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  cleanup();
  clearSession();
  jest.useRealTimers();
  delete global.fetch;
});

test('protected bytes use Bearer and no-store; the rendered URL contains only an object URL', async () => {
  const auth = token('owner-a');
  setSession(auth);
  fetch.mockResolvedValue(success());
  render(<ProtectedImage value={reference} alt="مسودة خاصة" />);
  await flush();
  expect(fetch).toHaveBeenCalledWith('/api/media/product-private.png', expect.objectContaining({
    headers: { Authorization: 'Bearer ' + auth }, cache: 'no-store', credentials: 'omit', redirect: 'error'
  }));
  expect(screen.getByRole('img', { name: 'مسودة خاصة' })).toHaveAttribute('src', 'blob:synthetic-owned-image');
  expect(fetch.mock.calls[0][0]).not.toContain(auth);
  expect(screen.getByRole('img').src).not.toContain(auth);
});

test('anonymous requests cannot render media denied by the server', async () => {
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  expect(fetch).toHaveBeenCalledWith('/api/media/product-private.png', expect.objectContaining({ headers: {}, cache: 'no-store', credentials: 'omit' }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test.each(['https://external.invalid/private.png', '//external.invalid/private.png', 'data:image/png;base64,AAAA', '/uploads/../private.png', '/uploads/private.png?token=secret', '/uploads/%2fprivate.png'])('unsafe source %s is never requested or rendered', async value => {
  setSession(token('owner-a'));
  render(<ProtectedImage value={value} alt="private" />);
  await flush();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('logout removes the image, revokes its object URL and aborts its request', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockResolvedValue(denied(401));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  expect(screen.getByRole('img')).toBeInTheDocument();
  const signal = fetch.mock.calls[0][1].signal;
  act(() => clearSession());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-owned-image');
  expect(signal.aborted).toBe(true);
  await flush();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(fetch.mock.calls[1][1].headers).toEqual({});
});

test('switching from A to B clears the already displayed private image before B responds', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockImplementationOnce(() => new Promise(() => {}));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  expect(screen.getByRole('img')).toBeInTheDocument();
  act(() => setSession(token('owner-b')));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-owned-image');
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer ' + getSessionToken());
});

test('a late A image response cannot render after the account has changed to B', async () => {
  let finishA;
  setSession(token('owner-a'));
  fetch.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; })).mockResolvedValueOnce(denied(404));
  render(<ProtectedImage value={reference} alt="private" />);
  act(() => setSession(token('owner-b')));
  await act(async () => finishA(success()));
  await flush();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('a late 401 for A cannot sign out the replacement account B', async () => {
  let finishA;
  setSession(token('owner-a'));
  fetch.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; })).mockResolvedValueOnce(denied(404));
  render(<ProtectedImage value={reference} alt="private" />);
  const b = token('owner-b');
  act(() => setSession(b));
  await act(async () => finishA(denied(401)));
  expect(getSessionToken()).toBe(b);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('JWT expiry clears the displayed image without another user action', async () => {
  setSession(token('owner-a', Math.floor(Date.now() / 1000) + 1));
  fetch.mockResolvedValueOnce(success()).mockResolvedValue(denied(401));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  expect(screen.getByRole('img')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(1001));
  expect(getSessionToken()).toBe('');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  await flush();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('revalidation discards the previous bytes when permission or publication is withdrawn', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(denied(404));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  expect(screen.getByRole('img')).toBeInTheDocument();
  await act(async () => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('backgrounding revokes the image and foregrounding authorizes a new fetch', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValue(success());
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  act(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  act(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('img')).toBeInTheDocument();
});

test('cross-tab storage changes clear prior-account media', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(denied(404));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  act(() => {
    localStorage.setItem('supplierToken', token('owner-b'));
    window.dispatchEvent(new StorageEvent('storage', { key: 'supplierToken' }));
  });
  await flush();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test('a current-session API 401 also clears all image resources', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(denied(401));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  await act(async () => { await expect(apiRequest('/suppliers/me/profile')).rejects.toMatchObject({ status: 401 }); });
  expect(getSessionToken()).toBe('');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test('unmount releases object URLs and cancels refresh timers', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValue(success());
  const { unmount } = render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  unmount();
  act(() => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS * 2));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-owned-image');
});

test('an early pending refresh keeps authorized pixels only until their original deadline', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockImplementation(() => new Promise(() => {}));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  await act(async () => jest.advanceTimersByTime(MEDIA_REFRESH_MS));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('img')).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS - MEDIA_REFRESH_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test('early authorization denial revokes pixels immediately, before the original deadline', async () => {
  setSession(token('owner-a'));
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(denied(404));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  await act(async () => jest.advanceTimersByTime(MEDIA_REFRESH_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test('successful early authorization replaces pixels and cancels only the obsolete expiry timer', async () => {
  setSession(token('owner-a'));
  URL.createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:refreshed');
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(success()).mockImplementation(() => new Promise(() => {}));
  render(<ProtectedImage value={reference} alt="private" />);
  await flush();
  await act(async () => jest.advanceTimersByTime(MEDIA_REFRESH_MS));
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:refreshed');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  act(() => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS - MEDIA_REFRESH_MS));
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:refreshed');
  await act(async () => jest.advanceTimersByTime(MEDIA_REFRESH_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:refreshed');
});
