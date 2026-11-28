import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { setSession, clearSession } from './api/session';

jest.mock('./components/buyer/BuyerDashboard', () => function Buyer() { return <h1>Buyer workspace</h1>; });
jest.mock('./components/suppliers/SupplierDashboard', () => function Supplier() { return <h1>Supplier workspace</h1>; });
const a = '111111111111111111111111', b = '222222222222222222222222';
const p1 = '333333333333333333333333', p2 = '444444444444444444444444';
const s1 = '555555555555555555555555', s2 = '666666666666666666666666';
const jwt = (id, exp = 9999999999) => 'test.' + btoa(JSON.stringify({ id, exp })) + '.signature';
const key = id => 'jomla:quote-selection:v1:' + id;
const profiles = { [a]: { _id: a, role: 'buyer', name: 'Buyer A', phone: '+212600000011', city: 'الرباط' }, [b]: { _id: b, role: 'buyer', name: 'Buyer B', phone: '+212600000022', city: 'فاس' } };
const products = [
  { _id: p1, name: 'منتج المورد الأول', supplierId: { _id: s1, name: 'المورد الأول' }, moq: 10 },
  { _id: p2, name: 'منتج المورد الثاني', supplierId: { _id: s2, name: 'المورد الثاني' }, moq: 20 }
].map(p => ({ ...p, price: 30, currency: 'MAD', unit: 'قطعة', category: 'اختبار', availability: 'in_stock', description: 'وصف تجربة محلية' }));
const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
let withdrawn, pending;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/cart'); withdrawn = false; pending = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  global.fetch = jest.fn((url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path.endsWith('/suppliers/me/profile')) {
      const id = JSON.parse(atob(options.headers.Authorization.split('.')[1])).id;
      return reply(profiles[id]);
    }
    const product = products.find(p => path.endsWith('/products/' + p._id));
    if (product) return reply(withdrawn && product._id === p1 ? { message: 'Unavailable' } : { product }, withdrawn && product._id === p1 ? 404 : 200);
    if (path.endsWith('/rfq') && options.method === 'POST') return pending ? pending.promise : reply({ rfq: { _id: '777777777777777777777777', status: 'pending' } }, 201);
    if (path.endsWith('/favorites')) return reply({ productIds: [], limit: 100 });
    if (path.endsWith('/suppliers/logout')) return reply({ success: true });
    return reply({ data: products, pagination: { total: 2, pages: 1 }, unreadCount: 0 });
  });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
const choose = (id, ids) => sessionStorage.setItem(key(id), JSON.stringify(ids));
const ready = () => screen.findByRole('button', { name: 'خروج' });
const cartCount = count => screen.getByRole('link', { name: `سلة طلبات العروض (${count})` });

test('buyer A and B keep different selections through remount and cross-tab session events', async () => {
  choose(a, [p1]); choose(b, [p2]); setSession(jwt(a)); const view = render(<App />); await ready();
  expect(await screen.findByRole('heading', { name: products[0].name })).toBeInTheDocument();
  act(() => { localStorage.setItem('supplierToken', jwt(b)); window.dispatchEvent(new StorageEvent('storage', { key: 'supplierToken', newValue: jwt(b) })); });
  expect(await screen.findByRole('heading', { name: products[1].name })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: products[0].name })).not.toBeInTheDocument();
  view.unmount(); const second = render(<App />); await ready(); expect(cartCount(1)).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: products[1].name })).toBeInTheDocument();
  act(() => setSession(jwt(a)));
  expect(await screen.findByRole('heading', { name: products[0].name })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: products[1].name })).not.toBeInTheDocument(); second.unmount();
});

test('two guest products merge once with an existing selection and never migrate to buyer B', async () => {
  choose('guest', [p1, p2]); choose(a, [p1]); const view = render(<App />);
  expect(cartCount(2)).toBeInTheDocument(); act(() => setSession(jwt(a))); await ready();
  expect(cartCount(2)).toBeInTheDocument(); expect(JSON.parse(sessionStorage.getItem(key(a)))).toEqual([p1, p2]);
  expect(sessionStorage.getItem(key('guest'))).toBe('[]'); view.unmount(); render(<App />); await ready();
  expect(cartCount(2)).toBeInTheDocument(); act(() => { clearSession(); setSession(jwt(b)); }); await ready();
  expect(cartCount(0)).toBeInTheDocument();
});

test('two supplier groups open the matching product and MOQ, sending only the selected product', async () => {
  choose(a, [p1, p2]); setSession(jwt(a)); render(<App />); await ready();
  const buttons = await screen.findAllByRole('button', { name: 'مراجعة وإرسال الطلب' });
  expect(screen.getByRole('heading', { name: 'المورد الأول' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'المورد الثاني' })).toBeInTheDocument();
  fireEvent.click(buttons[1]); const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(products[1].name)).toBeInTheDocument();
  expect(within(dialog).getByLabelText('الكمية المطلوبة')).toHaveAttribute('min', '20');
  fireEvent.change(within(dialog).getByLabelText('الكمية المطلوبة'), { target: { value: '24' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'إرسال طلب عرض السعر' }));
  await screen.findByText(/تم إرسال طلب العرض بنجاح/);
  const sent = fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/rfq') && options.method === 'POST');
  expect(sent).toHaveLength(1); expect(JSON.parse(sent[0][1].body)).toMatchObject({ productId: p2, quantity: 24 });
  expect(JSON.parse(sessionStorage.getItem(key(a)))).toEqual([p1]);
});

test('withdrawal after cart load removes the send action when the page is revalidated', async () => {
  choose(a, [p1]); setSession(jwt(a)); render(<App />); await ready();
  await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' }); withdrawn = true;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByText('لم يعد متاحاً في الكتالوج.');
  expect(screen.queryByRole('button', { name: 'مراجعة وإرسال الطلب' })).not.toBeInTheDocument(); expect(cartCount(1)).toBeInTheDocument();
});

test('logout during submission discards the late response and all private form data', async () => {
  choose(a, [p1]); setSession(jwt(a)); render(<App />); await ready();
  fireEvent.click(await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' }));
  expect(await screen.findByLabelText('هاتف التواصل')).toHaveValue(profiles[a].phone);
  fireEvent.change(screen.getByLabelText('المواصفات والملاحظات'), { target: { value: 'PRIVATE_BUYER_A_NOTE' } });
  let resolve; pending = { promise: new Promise(done => { resolve = done; }) };
  fireEvent.click(screen.getByRole('button', { name: 'إرسال طلب عرض السعر' }));
  act(() => { clearSession(); setSession(jwt(b)); }); await ready();
  await act(async () => resolve({ ok: true, status: 201, json: async () => ({ rfq: { _id: '777777777777777777777777' } }) }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText(/تم إرسال طلب العرض بنجاح/)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('PRIVATE_BUYER_A_NOTE')).not.toBeInTheDocument(); expect(cartCount(0)).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem(key(a)))).toEqual([p1]);
});

test('session expiry closes the private cart form without storing its contact fields', async () => {
  jest.useFakeTimers(); choose(a, [p1]); setSession(jwt(a, Math.floor(Date.now() / 1000) + 5)); render(<App />); await ready();
  fireEvent.click(await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' }));
  await screen.findByLabelText('هاتف التواصل'); act(() => jest.advanceTimersByTime(6000));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(cartCount(0)).toBeInTheDocument(); expect(sessionStorage.getItem(key(a))).toBe(JSON.stringify([p1]));
});
