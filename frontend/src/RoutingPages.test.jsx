import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { navigate, productPath, storePath } from './navigation';
jest.mock('./components/buyer/BuyerDashboard', () => function BuyerTest() { return <h1>Buyer workspace test</h1>; });
jest.mock('./components/suppliers/SupplierDashboard', () => function SupplierTest() { return <h1>Supplier workspace test</h1>; });
const pid = 'abcdef0123456789abcdef01', sid = 'abcdef0123456789abcdef02', uid = 'abcdef0123456789abcdef03';
const jwt = 'synthetic.' + btoa(JSON.stringify({ id: uid, exp: 9999999999 })) + '.signature';
const buyer = { _id: uid, role: 'buyer', name: 'Synthetic buyer', phone: '+212600000010' };
const supplier = { _id: uid, name: 'Public supplier', city: 'الرباط', isVerified: false, verificationStatus: 'unverified' };
const product = { _id: pid, name: 'منتج C2 العام', description: 'وصف المنتج العام المثبت في بيانات الاختبار', category: 'اختبار',
  price: 120, currency: 'MAD', moq: 10, unit: 'زوج', country: 'MA', availability: 'in_stock',
  imageUrl: '/uploads/c2-main.png', images: ['/uploads/c2-secondary.png'], supplierId: supplier, storeId: sid,
  priceTiers: [{ minQty: 10, maxQty: 49, price: 110 }, { minQty: 50, price: 100 }] };
const store = { _id: sid, name: 'متجر C2 العام', description: 'وصف المتجر العام', city: 'الرباط', supplierId: supplier, logoUrl: '/uploads/c2-logo.png' };
const response = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const media = () => Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['synthetic pixels'], { type: 'image/png' }) });
let profile, productStatus;
function api(url, options = {}) {
  const path = new URL(url, 'http://localhost').pathname;
  if (path.includes('/media/')) return media();
  if (path === '/api/products/' + pid) return response(productStatus === 200 ? { product, store } : { message: 'المنتج غير متاح' }, productStatus);
  if (path === '/api/stores/' + sid) return response({ store, products: [product], pagination: { page: 1, pages: 2, total: 13, hasNextPage: true } });
  if (path.includes('/reviews/')) return response({ data: [], stats: { total: 0, avg: 0 } });
  if (path.includes('/me/profile')) return response(profile || {}, profile ? 200 : 401);
  if (path === '/api/suppliers/login') return response({ token: jwt, supplier: buyer });
  if (path === '/api/rfq' && options.method === 'POST') return response({ rfq: { _id: 'synthetic-rfq' } }, 201);
  return response({ data: [product], pagination: { total: 1, pages: 1 }, unreadCount: 0 });
}
beforeEach(() => {
  window.history.replaceState({}, '', '/'); localStorage.clear(); profile = null; productStatus = 200;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
  global.fetch = jest.fn(api);
  let serial = 0; URL.createObjectURL = jest.fn(() => 'blob:c2-' + ++serial); URL.revokeObjectURL = jest.fn();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });
const openProduct = () => { window.history.replaceState({}, '', productPath(pid)); return render(<App />); };

test('direct anonymous product route survives a remount and displays real public fields and both managed images', async () => {
  const view = openProduct();
  expect(await screen.findByRole('heading', { name: product.name, level: 1 })).toBeInTheDocument();
  expect(await screen.findByRole('img', { name: product.name + ' · الصورة 1' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'عرض الصورة 1' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'عرض الصورة 2' }));
  expect(await screen.findByRole('img', { name: product.name + ' · الصورة 2' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('110');
  expect(screen.getByText('MAD')).toBeInTheDocument();
  expect(screen.queryByText('راجعته إدارة المنصة')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Public supplier' })).toHaveAttribute('href', '/suppliers/' + uid);
  expect(document.title).toContain(product.name);
  view.unmount(); render(<App />);
  expect(await screen.findByRole('heading', { name: product.name, level: 1 })).toBeInTheDocument();
  expect(window.location.pathname).toBe(productPath(pid));
});

test('product → store → browser Back → Forward renders the route selected by browser history', async () => {
  openProduct(); await screen.findByRole('heading', { name: product.name, level: 1 });
  fireEvent.click(screen.getAllByRole('link', { name: store.name })[0]);
  await screen.findByRole('heading', { name: store.name, level: 1 }); expect(window.location.pathname).toBe(storePath(sid));
  act(() => window.history.back());
  await screen.findByRole('heading', { name: product.name, level: 1 }); expect(window.location.pathname).toBe(productPath(pid));
  act(() => window.history.forward());
  await screen.findByRole('heading', { name: store.name, level: 1 }); expect(window.location.pathname).toBe(storePath(sid));
});

test('store search and pagination persist in the URL and direct remount', async () => {
  window.history.replaceState({}, '', storePath(sid) + '?q=حذاء&page=2');
  const view = render(<App />); await screen.findByRole('heading', { name: store.name, level: 1 });
  expect(screen.getByLabelText('البحث داخل المتجر')).toHaveValue('حذاء');
  expect(fetch.mock.calls.some(([url]) => String(url).includes('page=2') && new URL(url, 'http://localhost').searchParams.get('q') === 'حذاء')).toBe(true);
  fireEvent.change(screen.getByLabelText('البحث داخل المتجر'), { target: { value: 'جملة' } });
  fireEvent.click(screen.getByRole('button', { name: 'بحث', exact: true }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('q')).toBe('جملة'));
  expect(new URLSearchParams(window.location.search).get('page')).toBe('1');
  view.unmount(); render(<App />); await screen.findByRole('heading', { name: store.name, level: 1 });
  expect(screen.getByLabelText('البحث داخل المتجر')).toHaveValue('جملة');
});

test('share links are canonical, copyable, open a native new tab and contain no session or RFQ query', async () => {
  localStorage.setItem('supplierToken', jwt); profile = buyer;
  openProduct(); await screen.findByRole('heading', { name: product.name, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'نسخ الرابط', exact: true }));
  await screen.findByText('تم نسخ الرابط.');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost' + productPath(pid));
  expect(screen.getByRole('link', { name: 'فتح في تبويب جديد' })).toHaveAttribute('target', '_blank');
  expect(screen.getByLabelText('رابط المشاركة')).toHaveValue('http://localhost' + productPath(pid));
  expect(window.location.pathname).toBe(productPath(pid));
});

test('guest RFQ login return survives remount; successful buyer authentication opens the existing form and submits once', async () => {
  const view = openProduct(); await screen.findByRole('heading', { name: product.name, level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'طلب عرض سعر', exact: true }));
  await screen.findByRole('heading', { name: 'مرحباً بعودتك' });
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(productPath(pid) + '?rfq=1');
  view.unmount(); render(<App />);
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'buyer@synthetic.test' } });
  fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'Synthetic-only123!' } });
  profile = buyer;
  fireEvent.click(screen.getByRole('button', { name: 'دخول', exact: true }));
  await screen.findByRole('dialog', { name: 'طلب عرض سعر بالجملة' });
  expect(window.location.pathname).toBe(productPath(pid)); expect(window.location.search).toBe('');
  expect(fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/rfq') && options.method === 'POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'إرسال طلب عرض السعر', exact: true }));
  await screen.findByRole('heading', { name: 'Buyer workspace test' });
  expect(fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/rfq') && options.method === 'POST')).toHaveLength(1);
});

test('a malformed/unknown link is explicit and a withdrawn product never displays its previous details', async () => {
  window.history.replaceState({}, '', '/products/not-an-id'); render(<App />);
  expect(screen.getByRole('heading', { name: 'الرابط غير موجود' })).toBeInTheDocument();
  productStatus = 404;
  act(() => navigate(productPath(pid)));
  await screen.findByRole('heading', { name: 'المنتج غير متاح' });
  expect(screen.queryByText(product.description)).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('a late prior-product response cannot populate a different unavailable direct link', async () => {
  let finish;
  fetch.mockImplementation((url, options) => String(url).endsWith('/products/' + pid) ? new Promise(resolve => { finish = resolve; }) : api(url, options));
  openProduct();
  const next = 'abcdef0123456789abcdef09';
  fetch.mockImplementation((url, options) => String(url).endsWith('/products/' + next) ? response({ message: 'المنتج غير متاح' }, 404) : api(url, options));
  act(() => navigate(productPath(next)));
  await screen.findByRole('heading', { name: 'المنتج غير متاح' });
  await act(async () => finish({ ok: true, status: 200, json: async () => ({ product, store }) }));
  expect(screen.queryByText(product.description)).not.toBeInTheDocument();
  expect(document.title).not.toContain(product.name);
});

test('French direct pages use LTR and public store/product links without invented verification', async () => {
  localStorage.setItem('jomla_lang', 'fr');
  openProduct(); await screen.findByRole('heading', { name: product.name, level: 1 });
  expect(document.documentElement.dir).toBe('ltr');
  expect(screen.getByRole('button', { name: 'Demander un devis', exact: true })).toBeInTheDocument();
  expect(screen.queryByText('Vérifié par la plateforme')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument();
});

test('an unauthenticated workspace URL returns to the requested allowed workspace after login', async () => {
  window.history.replaceState({}, '', '/supplier'); render(<App />);
  await screen.findByRole('heading', { name: 'مرحباً بعودتك' });
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/supplier');
  fireEvent.click(screen.getByRole('button', { name: 'إنشاء حساب', exact: true }));
  await screen.findByRole('heading', { name: 'انضم إلى سوق الجملة' });
  expect(window.location.pathname).toBe('/register');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/supplier');
});

test('a supplier session stays on the public product but cannot use its buyer RFQ action', async () => {
  localStorage.setItem('supplierToken', jwt); profile = { ...buyer, role: 'supplier' };
  openProduct();
  await screen.findByText('إرسال طلب عرض السعر متاح لحساب المشتري.');
  expect(screen.getByRole('button', { name: 'طلب عرض سعر', exact: true })).toBeDisabled();
  expect(window.location.pathname).toBe(productPath(pid));
});

test('withdrawal revalidation clears previously loaded details, metadata and image blobs', async () => {
  jest.useFakeTimers();
  try {
    openProduct(); await screen.findByRole('heading', { name: product.name, level: 1 });
    await screen.findAllByRole('img');
    productStatus = 404;
    await act(async () => jest.advanceTimersByTime(30000));
    await screen.findByRole('heading', { name: 'المنتج غير متاح' });
    expect(screen.queryByText(product.description)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.title).not.toContain(product.name);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
