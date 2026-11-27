import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { navigate } from './navigation';

const pid = '111111111111111111111111', sid = '222222222222222222222222', storeId = '333333333333333333333333';
const otherId = '444444444444444444444444', recentId = '555555555555555555555555', buyerId = '666666666666666666666666';
const source = { _id: pid, name: 'منتج المعرض التجريبي', description: 'الوصف المنشور من المورد فقط', category: 'المنزل', price: 35, currency: 'MAD', moq: 10, unit: 'قطعة', city: 'الرباط', country: 'MA', availability: 'in_stock', supplierId: { _id: sid, name: 'مورد الاختبار', city: 'الرباط' }, storeId, imageUrl: '/uploads/main.png', images: ['/uploads/main.png', '/uploads/second.png', 'https://untrusted.example/image.png'], priceTiers: [{ minQty: 10, maxQty: 49, price: 35 }, { minQty: 50, price: 30 }] };
const response = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
let product, productStatus, reviewStatus, searchStatus, stats, reviews, posts;
beforeEach(() => {
  window.history.replaceState({}, '', '/products/' + pid); localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  product = { ...source }; productStatus = 200; reviewStatus = 200; searchStatus = 200; stats = { avg: 0, total: 0 }; reviews = []; posts = [];
  let serial = 0; URL.createObjectURL = jest.fn(() => 'blob:detail-' + ++serial); URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn((url, options = {}) => {
    const parsed = new URL(url, 'http://localhost'), path = parsed.pathname;
    if (path.includes('/media/')) return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['fixture'], { type: 'image/png' }) });
    if (path === '/api/products/' + pid) return response(productStatus === 200 ? { product, store: { _id: storeId, name: 'متجر الاختبار' } } : { message: 'Unavailable' }, productStatus);
    if (path === '/api/products/' + otherId) return response({ product: { ...source, _id: otherId, name: 'منتج مشابه', images: [] }, store: { _id: storeId, name: 'متجر الاختبار' } });
    if (path === '/api/products/search') return searchStatus !== 200 ? response({ message: 'Unavailable' }, searchStatus) : response({ data: parsed.searchParams.has('category') ? [product, { ...source, _id: otherId, name: 'منتج مشابه' }] : [product, { ...source, _id: otherId, name: 'منتج مشابه' }, { ...source, _id: recentId, name: 'منتج آخر', category: 'نسيج' }] });
    if (path === '/api/reviews/' + sid) return response({ data: reviews, stats, pagination: { hasNextPage: parsed.searchParams.get('page') === '1' && stats.total > 5, pages: Math.ceil(stats.total / 5) } }, reviewStatus);
    if (path === '/api/reviews' && options.method === 'POST') { posts.push(JSON.parse(options.body)); return response({ message: 'created' }, 201); }
    if (path === '/api/suppliers/me/profile') return response({ _id: buyerId, role: 'buyer', name: 'Test buyer', phone: '+212600000010' });
    return response({ data: [], unreadCount: 0 });
  });
});
afterEach(() => { jest.restoreAllMocks(); });
const open = async () => { render(<App />); await screen.findByRole('heading', { name: source.name, level: 1 }); };

test('gallery deduplicates safe managed photos, switches images, zooms and restores keyboard focus', async () => {
  await open();
  expect(screen.queryByRole('button', { name: 'عرض الصورة 3' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'عرض الصورة 2' }));
  expect(await screen.findByRole('img', { name: source.name + ' · الصورة 2' })).toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'تكبير صورة المنتج' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'صور المنتج' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'تكبير ＋' }));
  expect(within(dialog).getByText('150%')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'الصورة التالية' }));
  expect(within(dialog).getByText('100%')).toBeInTheDocument();
  expect(await within(dialog).findByRole('img', { name: source.name + ' · الصورة 1' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
});

test('withdrawal closes the enlarged gallery and removes data and blob images', async () => {
  jest.useFakeTimers();
  try {
    await open(); fireEvent.click(screen.getByRole('button', { name: 'تكبير صورة المنتج' }));
    await within(screen.getByRole('dialog')).findByRole('img'); productStatus = 404;
    await act(async () => jest.advanceTimersByTime(30000));
    await screen.findByRole('heading', { name: 'المنتج غير متاح' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('no managed images produces an honest empty state without an enlargement control', async () => {
  product = { ...product, imageUrl: '', images: ['https://untrusted.example/x.png'] }; await open();
  expect(screen.getByText('لا توجد صورة متاحة.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'تكبير صورة المنتج' })).not.toBeInTheDocument();
});

test('on-request pricing never exposes stale fixed or tier prices in the product purchase section', async () => {
  product = { ...product, pricingMode: 'on_request' }; await open();
  expect(screen.getByText('السعر عند الطلب')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'شرائح السعر حسب الكمية' })).not.toBeInTheDocument();
});

test('empty reviews do not fabricate a rating, count or verified-purchase claim', async () => {
  await open(); const section = screen.getByRole('region', { name: 'تقييمات المورد وتعليقاته' });
  await within(section).findByText('لا توجد تعليقات منشورة في هذه الصفحة بعد.');
  expect(within(section).queryByText(/\/5/)).not.toBeInTheDocument();
  expect(within(section).queryByRole('button', { name: 'نشر التقييم' })).not.toBeInTheDocument();
});

test('public API reviews and supplier replies display with pagination and revalidate without stale comments', async () => {
  stats = { avg: 4.5, total: 6 }; reviews = [{ _id: 'review1', userName: 'قارئ تجريبي', stars: 4, comment: 'تعليق من الاستجابة الاختبارية', date: '2026-11-12', reply: { text: 'رد المورد الاختباري' } }];
  await open(); const section = screen.getByRole('region', { name: 'تقييمات المورد وتعليقاته' });
  await within(section).findByText(reviews[0].comment); expect(within(section).getByText('رد المورد الاختباري')).toBeInTheDocument();
  expect(within(section).getByText('4.5/5')).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: 'التالي' }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('/reviews/') && String(url).includes('page=2'))).toBe(true));
  reviewStatus = 404;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(within(section).queryByText(reviews[0].comment)).not.toBeInTheDocument();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); act(() => document.dispatchEvent(new Event('visibilitychange')));
  const refreshedSection = await screen.findByRole('region', { name: 'تقييمات المورد وتعليقاته' });
  await within(refreshedSection).findByRole('alert'); expect(within(refreshedSection).queryByText('4.5/5')).not.toBeInTheDocument();
});

test('buyer chooses a rating explicitly and submits only supplier, score and comment', async () => {
  localStorage.setItem('supplierToken', 'test.' + btoa(JSON.stringify({ id: buyerId, exp: 9999999999 })) + '.signature');
  await open(); const section = screen.getByRole('region', { name: 'تقييمات المورد وتعليقاته' });
  const score = await within(section).findByLabelText('تقييمك'); expect(score).toHaveValue('');
  expect(within(section).getByRole('button', { name: 'نشر التقييم' })).toBeDisabled();
  fireEvent.change(score, { target: { value: '4' } });
  fireEvent.change(within(section).getByLabelText('تعليقك'), { target: { value: ' تجربة اختبار واضحة ' } });
  fireEvent.click(within(section).getByRole('button', { name: 'نشر التقييم' }));
  await within(section).findByText('تم نشر تقييمك للمورد.');
  expect(posts).toEqual([{ supplierId: sid, stars: 4, comment: 'تجربة اختبار واضحة' }]);
});

test('recommendations exclude the current product, deduplicate sections and never navigate automatically', async () => {
  await open(); const related = await screen.findByRole('region', { name: 'منتجات مشابهة' });
  const discoveries = await screen.findByRole('region', { name: 'قد تهمك أيضاً' });
  expect(within(related).getByRole('heading', { name: 'منتج مشابه' })).toBeInTheDocument();
  expect(within(related).queryByRole('heading', { name: source.name })).not.toBeInTheDocument();
  expect(within(discoveries).queryByRole('heading', { name: 'منتج مشابه' })).not.toBeInTheDocument();
  expect(within(discoveries).getByRole('heading', { name: 'منتج آخر' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/products/' + pid);
  fireEvent.click(within(related).getByRole('heading', { name: 'منتج مشابه' }).querySelector('a'));
  await screen.findByRole('heading', { name: 'منتج مشابه', level: 1 });
  expect(window.location.pathname).toBe('/products/' + otherId);
});

test('French page exposes translated gallery, specifications, reviews and discovery labels', async () => {
  localStorage.setItem('jomla_lang', 'fr'); await open();
  expect(document.documentElement.dir).toBe('ltr');
  expect(screen.getByRole('button', { name: 'Agrandir l’image du produit' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Caractéristiques disponibles' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Avis et commentaires sur le fournisseur' })).toBeInTheDocument();
  expect(await screen.findByRole('region', { name: 'Produits similaires' })).toBeInTheDocument();
});

test('failed suggestions can be retried without keeping old cards or navigating away', async () => {
  await open();
  await screen.findByRole('region', { name: 'منتجات مشابهة' });
  searchStatus = 503;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('button', { name: 'إعادة تحميل الاقتراحات' });
  expect(screen.queryByRole('region', { name: 'منتجات مشابهة' })).not.toBeInTheDocument();
  searchStatus = 200;
  fireEvent.click(screen.getByRole('button', { name: 'إعادة تحميل الاقتراحات' }));
  const restored = await screen.findByRole('region', { name: 'منتجات مشابهة' });
  expect(within(restored).getByRole('heading', { name: 'منتج مشابه' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'إعادة تحميل الاقتراحات' })).not.toBeInTheDocument());
  expect(window.location.pathname).toBe('/products/' + pid);
});

test('an open RFQ cannot carry into a different product on navigation', async () => {
  localStorage.setItem('supplierToken', 'test.' + btoa(JSON.stringify({ id: buyerId, exp: 9999999999 })) + '.signature');
  await open();
  await waitFor(() => expect(document.querySelector('.atlas-detail-request button')).toBeEnabled());
  fireEvent.click(document.querySelector('.atlas-detail-request button'));
  await screen.findByRole('dialog', { name: 'طلب عرض سعر بالجملة' });
  act(() => navigate('/products/' + otherId));
  await screen.findByRole('heading', { name: 'منتج مشابه', level: 1 });
  expect(screen.queryByRole('dialog', { name: 'طلب عرض سعر بالجملة' })).not.toBeInTheDocument();
});

test('continuous overview, details and recommended destinations preserve page content and track the fragment', async () => {
  await open();
  const nav = screen.getByRole('navigation', { name: 'أقسام المنتج' });
  const overview = within(nav).getByRole('link', { name: 'نظرة عامة' });
  const details = within(nav).getByRole('link', { name: 'التفاصيل' });
  const recommended = within(nav).getByRole('link', { name: 'مقترحات' });
  expect(overview).toHaveAttribute('href', '#product-overview');
  expect(details).toHaveAttribute('href', '#product-details');
  expect(recommended).toHaveAttribute('href', '#product-discover');
  expect(overview).toHaveAttribute('aria-current', 'location');
  act(() => { window.history.pushState({}, '', '/products/' + pid + '#product-details'); window.dispatchEvent(new Event('hashchange')); });
  expect(details).toHaveAttribute('aria-current', 'location');
  expect(overview).not.toHaveAttribute('aria-current');
  expect(screen.getByRole('heading', { name: source.name, level: 1 })).toBeInTheDocument();
  expect(screen.getByText(source.description)).toBeInTheDocument();
  expect(await screen.findByRole('region', { name: 'منتجات مشابهة' })).toBeInTheDocument();
  act(() => { window.history.pushState({}, '', '/products/' + pid + '#product-discover'); window.dispatchEvent(new Event('hashchange')); });
  expect(recommended).toHaveAttribute('aria-current', 'location');
  act(() => navigate('/products/' + otherId));
  await screen.findByRole('heading', { name: 'منتج مشابه', level: 1 });
  expect(within(screen.getByRole('navigation', { name: 'أقسام المنتج' })).getByRole('link', { name: 'نظرة عامة' })).toHaveAttribute('aria-current', 'location');
});

test('a direct legacy review fragment resolves to details after asynchronous product load', async () => {
  window.history.replaceState({}, '', '/products/' + pid + '#product-reviews');
  await open();
  expect(within(screen.getByRole('navigation', { name: 'أقسام المنتج' })).getByRole('link', { name: 'التفاصيل' })).toHaveAttribute('aria-current', 'location');
  expect(screen.getByRole('region', { name: 'تقييمات المورد وتعليقاته' })).toBeInTheDocument();
});
