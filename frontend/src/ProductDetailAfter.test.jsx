import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { navigate } from './navigation';

const pid = '111111111111111111111111', sid = '222222222222222222222222', storeId = '333333333333333333333333';
const otherId = '444444444444444444444444', recentId = '555555555555555555555555', buyerId = '666666666666666666666666';
const source = { _id: pid, name: 'منتج المعرض التجريبي', description: 'الوصف المنشور من المورد فقط', category: 'المنزل', price: 35, currency: 'MAD', moq: 10, unit: 'قطعة', city: 'الرباط', country: 'MA', availability: 'in_stock', supplierId: { _id: sid, name: 'مورد الاختبار', city: 'الرباط' }, storeId, imageUrl: '/uploads/main.png', images: ['/uploads/main.png', '/uploads/second.png', 'https://untrusted.example/image.png'], priceTiers: [{ minQty: 10, maxQty: 49, price: 35 }, { minQty: 50, price: 30 }] };
const response = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
let product, productStatus, reviewStatus, searchStatus, stats, reviews, posts, eligibilityReason, reviewAcknowledged;
beforeEach(() => {
  window.history.replaceState({}, '', '/products/' + pid); localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  product = { ...source }; productStatus = 200; reviewStatus = 200; searchStatus = 200; stats = { avg: 0, total: 0 }; reviews = []; posts = []; eligibilityReason='eligible';reviewAcknowledged=true;
  let serial = 0; URL.createObjectURL = jest.fn(() => 'blob:detail-' + ++serial); URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn((url, options = {}) => {
    const parsed = new URL(url, 'http://localhost'), path = parsed.pathname;
    if (path.includes('/media/')) return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['fixture'], { type: 'image/png' }) });
    if (path === '/api/products/' + pid) return response(productStatus === 200 ? { product, store: { _id: storeId, name: 'متجر الاختبار' } } : { message: 'Unavailable' }, productStatus);
    if (path === '/api/products/' + otherId) return response({ product: { ...source, _id: otherId, name: 'منتج مشابه', images: [] }, store: { _id: storeId, name: 'متجر الاختبار' } });
    if (path === '/api/products/search') return searchStatus !== 200 ? response({ message: 'Unavailable' }, searchStatus) : response({ data: parsed.searchParams.has('category') ? [product, { ...source, _id: otherId, name: 'منتج مشابه' }] : [product, { ...source, _id: otherId, name: 'منتج مشابه' }, { ...source, _id: recentId, name: 'منتج آخر', category: 'نسيج' }] });
    if (path === '/api/reviews/' + sid) return response({ data: reviews, stats, pagination: { hasNextPage: parsed.searchParams.get('page') === '1' && stats.total > 5, pages: Math.ceil(stats.total / 5) } }, reviewStatus);
    if (path === '/api/reviews/eligibility/' + sid) return response({supplierId:sid,buyerId,eligible:eligibilityReason==='eligible',reason:eligibilityReason});
    if (path === '/api/reviews' && options.method === 'POST') { const body=JSON.parse(options.body);posts.push(body); return response(reviewAcknowledged?{ review:{...body,_id:'777777777777777777777777',buyerId,basis:'mutual_confirmation'} }:{message:'unconfirmed'}, 201); }
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

test('RTL gallery counter, swipe, keyboard and click suppression preserve the real image sequence', async () => {
  await open();
  const gallery = screen.getByRole('region', { name: 'صور المنتج' });
  const trigger = within(gallery).getByRole('button', { name: 'تكبير صورة المنتج' });
  const counter = within(gallery).getByText('1 / 2');
  expect(counter).toHaveAttribute('dir', 'ltr');
  fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 40, clientY: 100 }] });
  fireEvent.touchEnd(trigger, { touches: [], changedTouches: [{ identifier: 1, clientX: 150, clientY: 103 }] });
  expect(counter).toHaveTextContent('2 / 2');
  fireEvent.click(trigger, { detail: 1 });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  expect(counter).toHaveTextContent('1 / 2');
  fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 40, clientY: 100 }] });
  fireEvent.touchEnd(trigger, { touches: [], changedTouches: [{ identifier: 1, clientX: 45, clientY: 210 }] });
  expect(counter).toHaveTextContent('1 / 2');
  fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 40, clientY: 100 }] });
  fireEvent.touchMove(trigger, { touches: [{ identifier: 1 }, { identifier: 2 }] });
  fireEvent.touchEnd(trigger, { touches: [], changedTouches: [{ identifier: 1, clientX: 150, clientY: 100 }] });
  expect(counter).toHaveTextContent('1 / 2');
  fireEvent.click(trigger, { detail: 0 });
  expect(screen.getByRole('dialog', { name: 'صور المنتج' })).toBeInTheDocument();
});

test('LTR swipe and arrow navigation use the opposite reading direction and single tap opens zoom', async () => {
  localStorage.setItem('jomla_lang', 'en');
  await open();
  const trigger = document.querySelector('.atlas-gallery-main');
  const counter = document.querySelector('.atlas-gallery-counter');
  fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 160, clientY: 100 }] });
  fireEvent.touchEnd(trigger, { touches: [], changedTouches: [{ identifier: 1, clientX: 45, clientY: 102 }] });
  expect(counter).toHaveTextContent('2 / 2');
  fireEvent.keyDown(trigger, { key: 'ArrowLeft' });
  expect(counter).toHaveTextContent('1 / 2');
  fireEvent.touchStart(trigger, { touches: [{ identifier: 1, clientX: 100, clientY: 100 }] });
  fireEvent.touchEnd(trigger, { touches: [], changedTouches: [{ identifier: 1, clientX: 102, clientY: 102 }] });
  fireEvent.click(trigger, { detail: 1 });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('gallery favorite uses existing guest login returnTo and never nests a button', async () => {
  await open();
  const gallery = screen.getByRole('region', { name: 'صور المنتج' });
  const heart = gallery.querySelector('.atlas-favorite-heart');
  expect(heart).toBeEnabled();
  expect(heart.closest('.atlas-gallery-frame')).toBeTruthy();
  expect(heart.parentElement.querySelector('.atlas-gallery-main').contains(heart)).toBe(false);
  fireEvent.click(heart);
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/products/' + pid);
});

test('invalid images collection and untrusted video fields never create media playback or network requests', async () => {
  product = { ...product, images: '/uploads/second.png', videoUrl: 'https://untrusted.example/demo.mp4' };
  await open();
  expect(document.querySelector('video')).toBeNull();
  expect(document.querySelector('.atlas-gallery-counter')).toHaveTextContent('1 / 1');
  expect(fetch.mock.calls.some(([url]) => String(url).includes('untrusted.example') || String(url).includes('second.png'))).toBe(false);
});

test('quantity pricing selects a declared tier, estimates the total and blocks below-MOQ input', async () => {
  await open();
  const quantity = screen.getByLabelText('اختر الكمية');
  expect(quantity).toHaveValue('10');
  expect(screen.getByRole('button', { name: '10–49 قطعة' }).querySelector('bdi')).toHaveAttribute('dir', 'ltr');
  expect(document.querySelector('.atlas-detail-price')).toHaveTextContent('35');
  fireEvent.click(screen.getByRole('button', { name: 'ابتداءً من 50 قطعة' }));
  expect(quantity).toHaveValue('50');
  expect(document.querySelector('.atlas-detail-price')).toHaveTextContent('30');
  expect(document.querySelector('.atlas-quantity-total strong').textContent).toBe(new Intl.NumberFormat('ar-MA', { style: 'currency', currency: 'MAD' }).format(1500));
  expect(screen.getByRole('button', { name: 'ابتداءً من 50 قطعة' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(quantity, { target: { value: '9' } });
  expect(quantity).toHaveAttribute('aria-invalid', 'true');
  expect(document.querySelector('.atlas-detail-request button')).toBeDisabled();
  expect(document.querySelector('.atlas-quantity-total')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'زيادة الكمية' }));
  expect(quantity).toHaveValue('10');
  expect(document.querySelector('.atlas-detail-request button')).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'زيادة الكمية' }));
  expect(quantity).toHaveValue('11');
  fireEvent.click(screen.getByRole('button', { name: 'تقليل الكمية' }));
  expect(quantity).toHaveValue('10');
});

test('quote-only product permits valid quantity but never displays a stale total or tier', async () => {
  product = { ...product, pricingMode: 'on_request' };
  await open();
  fireEvent.change(screen.getByLabelText('اختر الكمية'), { target: { value: '50' } });
  expect(document.querySelector('.atlas-detail-price')).toHaveTextContent('السعر عند الطلب');
  expect(document.querySelector('.atlas-quantity-total')).toBeNull();
  expect(screen.queryByRole('table', { name: 'شرائح السعر حسب الكمية' })).not.toBeInTheDocument();
  expect(document.querySelector('.atlas-detail-request button')).toBeEnabled();
});

test('quantity no longer meeting current MOQ on login return requires correction rather than opening a different request', async () => {
  localStorage.setItem('supplierToken', 'test.' + btoa(JSON.stringify({ id: buyerId, exp: 9999999999 })) + '.signature');
  window.history.replaceState({}, '', '/products/' + pid + '?rfq=1&qty=20');
  product = { ...product, moq: 30, priceTiers: [] };
  await open();
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(screen.getByLabelText('اختر الكمية')).toHaveValue('20');
  expect(document.querySelector('.atlas-detail-request button')).toBeDisabled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('recommendations expand from real bounded results without duplicate cards or losing the current product', async () => {
  const original = fetch.getMockImplementation();
  const rows = Array.from({length: 12}, (_, index) => ({...source, _id: (index + 100).toString(16).padStart(24, '0'), name: 'Synthetic item ' + index, taxonomyPath: index < 6 ? 'home/decor' : 'home/kitchen'}));
  product = {...product, taxonomyPath:'home/decor'};
  fetch.mockImplementation((url, options) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/products/search') {
      return response({data: parsed.searchParams.has('taxonomyPath') ? [product, rows[0], ...rows.filter(item => item.taxonomyPath === 'home/decor'), null, {_id:'invalid'}] : [product, ...rows]});
    }
    return original(url, options);
  });
  await open();
  const related = await screen.findByRole('region', {name:'منتجات مشابهة'});
  const discoveries = await screen.findByRole('region', {name:'قد تهمك أيضاً'});
  expect(within(related).getAllByRole('article')).toHaveLength(4);
  expect(within(discoveries).getAllByRole('article')).toHaveLength(4);
  expect(related.querySelector('.atlas-dense-product-grid')).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('taxonomyPath=home%2Fdecor') && String(url).includes('limit=24'))).toBe(true);
  fireEvent.click(screen.getByRole('button', {name:'عرض المزيد من المنتجات'}));
  expect(within(related).getAllByRole('article')).toHaveLength(6);
  expect(within(discoveries).getAllByRole('article')).toHaveLength(6);
  const links = [...document.querySelectorAll('#product-discover article h3 a')].map(a => a.getAttribute('href'));
  expect(new Set(links).size).toBe(12);
  expect(links).not.toContain('/products/' + pid);
  expect(screen.queryByRole('button', {name:'عرض المزيد من المنتجات'})).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name:'تابع التصفح في السوق'})).toHaveAttribute('href','/');
  expect(window.location.pathname).toBe('/products/' + pid);
  // Hide clears all resource data, but a later load retains only the display budget.
  rows.splice(0, 1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(document.querySelectorAll('#product-discover article')).toHaveLength(0);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(document.querySelectorAll('#product-discover article')).toHaveLength(11));
  expect(screen.queryByRole('heading', {name:'Synthetic item 0'})).not.toBeInTheDocument();
});

test('unilateral or absent confirmation hides publishing until eligibility refresh succeeds',async()=>{
  eligibilityReason='no_confirmation';
  localStorage.setItem('supplierToken','test.'+btoa(JSON.stringify({id:buyerId,exp:9999999999}))+'.signature');
  await open();const section=screen.getByRole('region',{name:'تقييمات المورد وتعليقاته'});
  await within(section).findByText(/يمكنك التقييم بعد إقرار/);
  expect(within(section).queryByLabelText('تقييمك')).not.toBeInTheDocument();
  eligibilityReason='eligible';fireEvent.click(within(section).getByRole('button',{name:'تحديث الأهلية'}));
  await within(section).findByLabelText('تقييمك');expect(posts).toEqual([]);
});
test('unconfirmed review response never displays success or enables a blind second submission',async()=>{
  reviewAcknowledged=false;
  localStorage.setItem('supplierToken','test.'+btoa(JSON.stringify({id:buyerId,exp:9999999999}))+'.signature');
  await open();const section=screen.getByRole('region',{name:'تقييمات المورد وتعليقاته'});
  fireEvent.change(await within(section).findByLabelText('تقييمك'),{target:{value:'4'}});
  fireEvent.change(within(section).getByLabelText('تعليقك'),{target:{value:'تجربة واضحة'}});
  fireEvent.click(within(section).getByRole('button',{name:'نشر التقييم'}));
  await within(section).findByText(/لم يتم التحقق من نشر التقييم/);
  expect(within(section).queryByText('تم نشر تقييمك للمورد.')).not.toBeInTheDocument();
  expect(within(section).queryByRole('button',{name:'نشر التقييم'})).not.toBeInTheDocument();
  expect(posts).toHaveLength(1);
});
