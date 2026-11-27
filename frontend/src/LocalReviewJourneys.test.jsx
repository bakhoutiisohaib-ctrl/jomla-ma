import {comparisonFixture} from './comparisonFixture';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { setSession, clearSession } from './api/session';
import { QuoteCartProvider, useQuoteCart } from './components/cart/QuoteCartContext';

jest.mock('./components/buyer/BuyerDashboard', () => function Buyer() { return <h1>Buyer workspace</h1>; });
jest.mock('./components/suppliers/SupplierDashboard', () => function Supplier() { return <h1>Supplier workspace</h1>; });
const pid = '111111111111111111111111', sid = '222222222222222222222222', uid = '333333333333333333333333';
const jwt = id => 'test.' + btoa(JSON.stringify({ id, exp: 9999999999 })) + '.signature';
const product = { _id: pid, name: 'منتج تجربة السلة', category: 'اختبار', description: 'وصف حقيقي من API', price: 25, currency: 'MAD', unit: 'قطعة', moq: 10, availability: 'in_stock', supplierId: { _id: sid, name: 'مورد الاختبار' }, storeId: sid };
const buyer = { _id: uid, role: 'buyer', name: 'Test buyer', phone: '+212600000010', city: 'الرباط' };
const reply = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
let productStatus, rfqAttempts;
beforeEach(() => {
  window.history.replaceState({}, '', '/'); localStorage.clear(); sessionStorage.clear(); productStatus = 200; rfqAttempts = 0;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  global.fetch = jest.fn((url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (path.endsWith('/suppliers/login')) return reply({ token: jwt(uid), supplier: buyer });
    if (path.endsWith('/me/profile')) return reply(buyer);
    if(path.endsWith('/comparable'))return reply(comparisonFixture(product,Number(new URL(url,'http://localhost').searchParams.get('quantity'))));
    if (path.endsWith('/products/' + pid)) return reply(productStatus === 200 ? { product, store: { _id: sid, name: 'متجر الاختبار' } } : { message: 'Unavailable' }, productStatus);
    if (path.endsWith('/rfq') && options.method === 'POST') { rfqAttempts++; return rfqAttempts === 1 ? Promise.reject(new Error('offline after submission')) : reply({ rfq: { _id: '444444444444444444444444', status: 'pending' } }, 201); }
    return reply({ data: [product], pagination: { total: 1, pages: 1 }, unreadCount: 0 });
  });
});
afterEach(() => jest.restoreAllMocks());

test.each([['إنشاء حساب', 'buyer'], ['ابدأ البيع', 'supplier']])('login action %s selects the intended registration role and preserves returnTo', async (button, role) => {
  window.history.replaceState({}, '', '/login?returnTo=%2Fcart'); render(<App />);
  fireEvent.click(screen.getByRole('button', { name: button, exact: true }));
  expect(screen.getByLabelText('نوع الحساب')).toHaveValue(role);
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/cart');
  fireEvent.change(screen.getByLabelText('لغة الواجهة'), { target: { value: 'fr' } });
  expect(document.documentElement.dir).toBe('ltr');
  expect(screen.getByLabelText('Type de compte')).toHaveValue(role);
});

test('invalid registration role defaults to buyer and does not offer an admin role', () => {
  window.history.replaceState({}, '', '/register?role=admin'); render(<App />);
  expect(screen.getByLabelText('نوع الحساب')).toHaveValue('buyer');
  expect(screen.queryByRole('option', { name: /admin|مشرف/i })).not.toBeInTheDocument();
});

test('preview loads public details and closes with Escape without navigating the product link', async () => {
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'معاينة سريعة: ' + product.name });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'معاينة سريعة' });
  expect(await within(dialog).findByText(product.description)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
});

test('a withdrawn preview never falls back to stale card metadata', async () => {
  render(<App />); const trigger = await screen.findByRole('button', { name: 'معاينة سريعة: ' + product.name }); productStatus = 404;
  fireEvent.click(trigger); const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('لم يعد متاحاً');
  expect(within(dialog).queryByText(product.description)).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('link', { name: 'التفاصيل وطلب عرض سعر' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'مقارنة' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'أضف لسلة العروض' })).not.toBeInTheDocument();
});

test('compact cards keep detail links and move comparison and reporting into the live preview', async () => {
  render(<App />);
  const trigger = await screen.findByRole('button', { name: 'معاينة سريعة: ' + product.name });
  const card = trigger.closest('article');
  expect(within(card).getByRole('link', { name: product.name })).toHaveAttribute('href', '/products/' + pid);
  expect(within(card).queryByRole('button', { name: 'مقارنة' })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'إبلاغ عن المنتج' })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  const compare = await within(dialog).findByRole('button', { name: 'مقارنة' });
  fireEvent.click(compare);
  const comparison=screen.getByRole('dialog',{name:'مقارنة منتجات من النوع نفسه'});
  await waitFor(()=>expect(comparison.querySelector('.atlas-comparison-row')).toHaveTextContent(product.name));
  fireEvent.click(within(comparison).getByRole('button',{name:'إغلاق'}));
  fireEvent.click(trigger);
  const reopened=await screen.findByRole('dialog',{name:'معاينة سريعة'});
  await within(reopened).findByText(product.description);
  fireEvent.click(within(reopened).getByRole('button', { name: 'أضف لسلة العروض' }));
  expect(within(reopened).getByRole('button', { name: 'في سلة العروض' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'سلة طلبات العروض (1)' })).toBeInTheDocument();
  fireEvent.click(within(reopened).getByRole('button', { name: 'إبلاغ عن المنتج' }));
  expect(screen.queryByRole('dialog', { name: 'معاينة سريعة' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText(product.name, { selector: 'strong' })).toBeInTheDocument();
});

test('French preview actions remain accessible and card RFQ preserves the detail return route', async () => {
  render(<App />);
  await screen.findByRole('button', { name: 'معاينة سريعة: ' + product.name });
  fireEvent.change(screen.getByLabelText('لغة الواجهة'), { target: { value: 'fr' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Aperçu rapide : ' + product.name }));
  const dialog = await screen.findByRole('dialog', { name: 'Aperçu rapide' });
  expect(await within(dialog).findByRole('button', { name: 'Comparer' })).toBeEnabled();
  expect(within(dialog).getByRole('button', { name: 'Ajouter à la sélection' })).toBeEnabled();
  expect(within(dialog).getByRole('link', { name: 'Détails et demande de devis' })).toHaveAttribute('href', '/products/' + pid);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Demander un devis' }));
  expect(window.location.pathname).toBe('/login');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/products/' + pid + '?rfq=1');
});

test('cart survives reload, transfers guest choices on login and reuses the same RFQ attempt after an uncertain response', async () => {
  const view = render(<App />); fireEvent.click(await screen.findByRole('button', { name: 'أضف لسلة العروض' }));
  fireEvent.click(screen.getByRole('link', { name: 'سلة طلبات العروض (1)' }));
  await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' });
  view.unmount(); render(<App />); await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' });
  fireEvent.click(screen.getByRole('button', { name: 'دخول المشتري' }));
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/cart');
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'buyer@synthetic.test' } });
  fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'Test-only123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'دخول', exact: true }));
  const review = await screen.findByRole('button', { name: 'مراجعة وإرسال الطلب' });
  await waitFor(() => expect(review).toBeEnabled()); fireEvent.click(review);
  fireEvent.change(await screen.findByLabelText('الكمية المطلوبة'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'إرسال طلب عرض السعر' }));
  await screen.findByText(/نتيجة الإرسال غير مؤكدة/);
  expect(screen.getByRole('link', { name: 'سلة طلبات العروض (1)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال الطلب' }));
  await screen.findByText(/تم إرسال طلب العرض بنجاح/);
  expect(screen.getByRole('link', { name: 'سلة طلبات العروض (0)' })).toBeInTheDocument();
  const calls = fetch.mock.calls.filter(([url, options]) => String(url).endsWith('/rfq') && options.method === 'POST');
  expect(calls).toHaveLength(2); expect(calls[0][1].headers['Idempotency-Key']).toBe(calls[1][1].headers['Idempotency-Key']);
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(calls[1][1].body).toContain('"quantity":12');
});

function CartProbe() { const cart = useQuoteCart(); return <><output aria-label="count">{cart.items.length}</output><button onClick={() => cart.add(pid)}>Add</button></>; }
test('account selections are isolated and do not persist contact data or tokens', async () => {
  act(() => setSession(jwt(uid))); render(<QuoteCartProvider><CartProbe /></QuoteCartProvider>);
  fireEvent.click(screen.getByText('Add')); expect(screen.getByLabelText('count')).toHaveTextContent('1');
  act(() => { clearSession(); setSession(jwt(sid)); });
  expect(screen.getByLabelText('count')).toHaveTextContent('0');
  act(() => setSession(jwt(uid))); expect(screen.getByLabelText('count')).toHaveTextContent('1');
  expect(sessionStorage.getItem('jomla:quote-selection:v1:' + uid)).toBe(JSON.stringify([pid]));
});

test('a withdrawn cart product stays selected for review but cannot be sent', async () => {
  sessionStorage.setItem('jomla:quote-selection:v1:guest', JSON.stringify([pid])); productStatus = 404;
  window.history.replaceState({}, '', '/cart'); render(<App />);
  await screen.findByText('لم يعد متاحاً في الكتالوج.');
  expect(screen.queryByRole('button', { name: 'مراجعة وإرسال الطلب' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'سلة طلبات العروض (1)' })).toBeInTheDocument();
});

test('catalog price range follows the completed search response and preserves the quantity-specific price', async () => {
  const original = fetch.getMockImplementation();
  const priced = { ...product, price: 50, pricingMode: 'fixed', priceTiers: [{ minQty: 10, maxQty: 29, price: 40 }, { minQty: 30, price: 20 }] };
  fetch.mockImplementation((url, options) => {
    const parsed = new URL(url, 'http://localhost');
    if (!parsed.pathname.endsWith('/products/search')) return original(url, options);
    const quantity = Number(parsed.searchParams.get('quantity'));
    return reply({ data: [{ ...priced, effectiveUnitPrice: quantity >= 30 ? 20 : quantity >= 10 ? 40 : 50 }], pagination: { total: 1, pages: 1 } });
  });
  render(<App />);
  const card = (await screen.findByRole('button', { name: 'معاينة سريعة: ' + product.name })).closest('article');
  expect(card.querySelector('[data-price-kind]')).toHaveAttribute('data-price-kind', 'range');
  expect(within(card).getByText('حسب الكمية')).toBeInTheDocument();
  expect(card.querySelector('[data-price-kind]')).toHaveTextContent('20 – 40');
  expect(card.querySelector('[data-price-kind]')).not.toHaveTextContent('20,00');
  fireEvent.change(screen.getByLabelText('الكمية المطلوبة'), { target: { value: '50' } });
  await screen.findByText('للكمية المطلوبة: 50 قطعة');
  expect(screen.getByRole('button', { name: 'معاينة سريعة: ' + product.name }).closest('article').querySelector('[data-price-kind]')).toHaveAttribute('data-price-kind', 'quantity');
  fireEvent.change(screen.getByLabelText('الكمية المطلوبة'), { target: { value: '' } });
  await screen.findByText('حسب الكمية');
  fireEvent.change(screen.getByLabelText('أعلى سعر'), { target: { value: '60' } });
  await screen.findByText('السعر الأساسي للبحث');
  expect(screen.getByRole('button', { name: 'معاينة سريعة: ' + product.name }).closest('article').querySelector('[data-price-kind]')).toHaveAttribute('data-price-kind', 'base');
});

test.each([
  ['range', {price:50,priceTiers:[{minQty:10,maxQty:29,price:40},{minQty:30,price:20}]}],
  ['request', {pricingMode:'on_request'}],
  ['unknown', {priceTiers:[{minQty:10,maxQty:50,price:22},{minQty:30,price:18}]}],
  ['unknown', {price:null}],
  ['unknown', {priceTiers:'invalid'}]
])('quick preview presents validated fresh price kind %s', async (kind, patch) => {
  const original = fetch.getMockImplementation();
  const fresh = {...product,...patch};
  fetch.mockImplementation((url,options) => new URL(url,'http://localhost').pathname.endsWith('/products/'+pid) ? reply({product:fresh}) : original(url,options));
  render(<App />);
  fireEvent.click(await screen.findByRole('button',{name:'معاينة سريعة: '+product.name}));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.querySelector('.atlas-preview-price')).toHaveAttribute('data-price-kind',kind));
  const price = dialog.querySelector('.atlas-preview-price');
  if(kind==='range'){
    expect(price.querySelectorAll('bdi')[0].textContent).toBe(new Intl.NumberFormat('ar-MA',{style:'currency',currency:'MAD'}).format(20));
    expect(price.querySelectorAll('bdi')[1].textContent).toBe(new Intl.NumberFormat('ar-MA',{style:'currency',currency:'MAD'}).format(40));
    expect(dialog.querySelector('.atlas-preview-tiers bdi')).toHaveTextContent('10–29');
    expect(dialog.querySelector('.atlas-preview-tiers bdi')).toHaveAttribute('dir','ltr');
  }else{
    expect(price).toHaveTextContent(kind==='request'?'السعر عند الطلب':'السعر غير متاح');
    expect(dialog.querySelector('.atlas-preview-tiers')).toBeNull();
    expect(price.querySelector('small')).toBeNull();
  }
});

test('quick preview recalculates selected search quantity from fresh DTO instead of stale effective price', async () => {
  const original = fetch.getMockImplementation();
  const fresh = {...product,price:25,priceTiers:[{minQty:30,price:18}]};
  fetch.mockImplementation((url,options) => {
    const pathname = new URL(url,'http://localhost').pathname;
    if(pathname.endsWith('/products/'+pid)) return reply({product:fresh});
    if(pathname.endsWith('/products/search')) return reply({data:[{...fresh,effectiveUnitPrice:20}],pagination:{total:1,pages:1}});
    return original(url,options);
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText('الكمية المطلوبة'),{target:{value:'50'}});
  await screen.findByText('للكمية المطلوبة: 50 قطعة');
  fireEvent.click(screen.getByRole('button',{name:'معاينة سريعة: '+product.name}));
  const dialog = await screen.findByRole('dialog');
  await waitFor(()=>expect(dialog.querySelector('.atlas-preview-price')).toHaveAttribute('data-price-kind','quantity'));
  expect(dialog.querySelector('.atlas-preview-price bdi').textContent).toBe(new Intl.NumberFormat('ar-MA',{style:'currency',currency:'MAD'}).format(18));
  expect(dialog.querySelector('.atlas-preview-price-context')).toHaveTextContent('50');
});
