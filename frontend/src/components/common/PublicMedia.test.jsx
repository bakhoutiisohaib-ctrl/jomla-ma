import { act, cleanup, render, screen } from '@testing-library/react';
import ProtectedImage, { MEDIA_REVALIDATE_MS } from './ProtectedImage';
import { clearSession, getSessionToken, setSession } from '../../api/session';

const ref = '/uploads/product-c1.png';
const success = () => ({ ok: true, status: 200, blob: async () => new Blob(['synthetic pixels'], { type: 'image/png' }) });
const denied = status => ({ ok: false, status });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const token = 'synthetic.' + btoa(JSON.stringify({ id: 'owner', exp: 9999999999 })) + '.signature';

beforeEach(() => {
  jest.useFakeTimers(); localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  global.fetch = jest.fn().mockResolvedValue(denied(401));
  let serial = 0;
  URL.createObjectURL = jest.fn(() => 'blob:public-c1-' + ++serial);
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => { cleanup(); clearSession(); jest.useRealTimers(); delete global.fetch; });

test('a visitor displays authorized public bytes without JWT, cookies or an uploads src', async () => {
  fetch.mockResolvedValue(success());
  render(<ProtectedImage value={ref} alt="Produit public" />);
  await flush();
  expect(fetch).toHaveBeenCalledWith('/api/media/product-c1.png', expect.objectContaining({
    headers: {}, cache: 'no-store', credentials: 'omit', redirect: 'error'
  }));
  expect(screen.getByRole('img', { name: 'Produit public' })).toHaveAttribute('src', 'blob:public-c1-1');
  expect(getSessionToken()).toBe('');
});

test.each([401, 404])('visitor refresh discards a previously public blob after access is withdrawn (%s)', async status => {
  fetch.mockResolvedValueOnce(success()).mockResolvedValueOnce(denied(status));
  render(<ProtectedImage value={ref} alt="public" />); await flush();
  await act(async () => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:public-c1-1');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('logout revokes prior-account bytes before loading a newly authorized public blob', async () => {
  setSession(token); fetch.mockResolvedValue(success());
  render(<ProtectedImage value={ref} alt="public" />); await flush();
  act(() => clearSession());
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await flush();
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + token);
  expect(fetch.mock.calls[1][1].headers).toEqual({});
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:public-c1-1');
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:public-c1-2');
});

test('a late private response cannot appear after logout into a denied visitor session', async () => {
  let finish;
  setSession(token);
  fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(denied(401));
  render(<ProtectedImage value={ref} alt="private" />);
  act(() => clearSession());
  await act(async () => finish(success())); await flush();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('changing a public source to a denied private source removes old bytes immediately', async () => {
  fetch.mockResolvedValueOnce(success()).mockResolvedValue(denied(401));
  const { rerender } = render(<ProtectedImage value={ref} alt="image" />); await flush();
  rerender(<ProtectedImage value="/uploads/private-c1.png" alt="image" />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await flush();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:public-c1-1');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('network failure on anonymous revalidation never leaves the prior blob visible', async () => {
  fetch.mockResolvedValueOnce(success()).mockRejectedValueOnce(new Error('Synthetic connection failure'));
  render(<ProtectedImage value={ref} alt="public" />); await flush();
  await act(async () => jest.advanceTimersByTime(MEDIA_REVALIDATE_MS));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:public-c1-1');
});

test('visitor backgrounding revokes the blob; returning rechecks live public authorization', async () => {
  fetch.mockResolvedValueOnce(success()).mockResolvedValue(denied(401));
  render(<ProtectedImage value={ref} alt="public" />); await flush();
  act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
