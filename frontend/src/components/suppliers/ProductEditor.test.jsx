import { act, fireEvent, render, screen } from '@testing-library/react';
import { setSession } from '../../api/session';
import ProductEditor from './ProductEditor';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import { waitForJob } from '../../api/jobs';
jest.mock('../../api/jobs', () => ({ waitForJob: jest.fn() }));
jest.mock('../../api/config', () => ({
  apiRequest: jest.fn(),
  assetUrl: () => ''
}));
const originalFetch = global.fetch;
const originalCrypto = globalThis.crypto;
beforeAll(() => {
  // jsdom in react-scripts does not expose the browser's Web Crypto API.
  // Exercise the secure fallback with Node's real random generator.
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: array => require('crypto').randomFillSync(array)
  } });
});
afterAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }));
const stores = [{ _id: 'store-a', name: 'متجر معتمد دون توثيق تجاري', reviewStatus: 'approved', isActive: true }];
const completeProduct = { _id: 'product-a', name: 'منتج صحيح للمراجعة', category: 'منزل', city: 'الرباط', description: 'وصف واضح ومكتمل للاختبار فقط', imageUrl: '/uploads/example.png', storeId: 'store-a', price: 20, currency: 'MAD', unit: 'صندوق', moq: 10, pricingMode: 'fixed', availability: 'in_stock' };
function next() { fireEvent.click(screen.getByRole('button', { name: 'التالي', exact: true })); }
function stepOne() { fireEvent.click(screen.getByRole('button', { name: /الصور والبيانات/ })); }
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  // Media now also revalidates without a session. Keep this editor suite fully
  // isolated; byte rendering/authorization has its own dedicated tests.
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
});
afterEach(() => { global.fetch = originalFetch; });
test('failed draft save preserves supplier input and does not signal success', async () => {
  apiRequest.mockRejectedValue(new Error('تعذر الحفظ'));
  const saved = jest.fn();
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={saved} onCancel={() => {}} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), {
    target: {
      value: 'منتج لمراجعة المورد'
    }
  });
  fireEvent.click(screen.getByRole('button', {
    name: 'حفظ مسودة خاصة'
  }));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر الحفظ');
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('منتج لمراجعة المورد');
  expect(saved).not.toHaveBeenCalled();
});
test('publication starts without preselected rights or approval and changing rights resets approval', () => {
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={stores} onSaved={() => {}} onCancel={() => {}} /></LanguageProvider>);
  expect(screen.queryByRole('button', { name: 'اعتماد ونشر' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('checkbox').every(box => !box.checked)).toBe(true);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  next(); next();
  const publish = screen.getByRole('button', { name: 'اعتماد ونشر' });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByLabelText('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.'));
  expect(publish).toBeEnabled();
  stepOne();
  fireEvent.change(screen.getByLabelText('مصدر حق الصورة'), {
    target: {
      value: 'licensed'
    }
  });
  next(); next();
  expect(screen.getByRole('button', { name: 'اعتماد ونشر' })).toBeDisabled();
});

test('queued image analysis waits for its result and requires a fresh publication approval', async () => {
  let complete;
  waitForJob.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  apiRequest.mockResolvedValue({ imageUrl: '/uploads/example.png', job: { id: 'job1', status: 'pending' } });
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={() => {}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.change(screen.getByLabelText('ملف الصورة (حتى 10MB)'), { target: { files: [new File(['png'], 'owned.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'اقتراح وصف من الصورة' }));
  expect(await screen.findByText('الصورة محفوظة، والتحليل جارٍ في الخلفية…')).toBeInTheDocument();
  complete({ imageUrl: '/uploads/example.png', draft: { title: 'حذاء ظاهر', category: 'أحذية', description: 'وصف مرئي يحتاج المراجعة' } });
  expect(await screen.findByDisplayValue('حذاء ظاهر')).toBeInTheDocument();
  next();
  expect(screen.getByLabelText('سعر الوحدة')).toHaveValue(null);
  next();
  expect(screen.getByRole('button', { name: 'اعتماد ونشر' })).toBeDisabled();
  expect(apiRequest).toHaveBeenCalledTimes(1);
});

test('a delayed AI result preserves fields the supplier edited while waiting', async () => {
  let complete;
  waitForJob.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  apiRequest.mockResolvedValue({ imageUrl: '/uploads/example.png', job: { id: 'job2', status: 'pending' } });
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={() => {}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.change(screen.getByLabelText('ملف الصورة (حتى 10MB)'), { target: { files: [new File(['png'], 'owned.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'اقتراح وصف من الصورة' }));
  await screen.findByText('الصورة محفوظة، والتحليل جارٍ في الخلفية…');
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'عنوان المورد الذي راجعه' } });
  complete({ imageUrl: '/uploads/example.png', draft: { title: 'اقتراح متأخر', category: 'فئة', description: 'وصف' } });
  await screen.findByText('راجع الوصف المرئي، وأدخل الأسعار والتوفر والمواصفات بنفسك.');
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('عنوان المورد الذي راجعه');
});

test('legacy external product images must be replaced instead of saved as managed media', async () => {
  render(<LanguageProvider><ProductEditor product={{ _id: 'legacy', imageUrl: 'https://external.invalid/private.png' }} stores={[]} onSaved={jest.fn()} onCancel={() => {}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  expect(await screen.findByText(/ارفع الصورة داخل المنصة قبل حفظ المنتج/)).toBeInTheDocument();
  expect(apiRequest).not.toHaveBeenCalled();
});

test('an upload response from the prior account is discarded after a session switch', async () => {
  let complete;
  setSession('synthetic-owner-a');
  apiRequest.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={() => {}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.change(screen.getByLabelText('ملف الصورة (حتى 10MB)'), { target: { files: [new File(['png'], 'owned.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'رفع الصورة' }));
  const signal = apiRequest.mock.calls[0][1].signal;
  act(() => setSession('synthetic-owner-b'));
  await act(async () => complete({ imageUrl: '/uploads/old-account.png' }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('تم رفع الصورة. راجع البيانات قبل النشر.')).not.toBeInTheDocument();
});

test('back and next preserve all pricing inputs, tiers and private draft payload', async () => {
  apiRequest.mockResolvedValue({}); const saved=jest.fn();
  render(<LanguageProvider><ProductEditor stores={stores} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'),{target:{value:'مسودة بخطوات'}});
  next();
  fireEvent.change(screen.getByLabelText('سعر الوحدة'),{target:{value:'45'}});
  fireEvent.change(screen.getByLabelText('الحد الأدنى للطلب MOQ'),{target:{value:'12'}});
  fireEvent.click(screen.getByRole('button',{name:'إضافة شريحة'}));
  fireEvent.change(screen.getByLabelText('سعر الوحدة في الشريحة'),{target:{value:'40'}});
  next();
  fireEvent.click(screen.getByRole('button',{name:'السابق'}));
  expect(screen.getByLabelText('سعر الوحدة')).toHaveValue(45);
  expect(screen.getByLabelText('سعر الوحدة في الشريحة')).toHaveValue(40);
  fireEvent.click(screen.getByRole('button',{name:'السابق'}));
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('مسودة بخطوات');
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة خاصة'}));
  await screen.findByLabelText('عنوان المنتج');
  expect(apiRequest).toHaveBeenCalledWith('/products',expect.objectContaining({method:'POST',body:expect.objectContaining({isDraft:true,publishApproved:false,hasImageRights:false,price:45,moq:12,priceTiers:[{minQty:12,maxQty:null,price:40}]})}));
  await act(async()=>{}); expect(saved).toHaveBeenCalledWith(true);
});

test('a late save cannot complete the previous account or retain its text', async () => {
  let complete; setSession('synthetic-a'); apiRequest.mockImplementation(()=>new Promise(resolve=>{complete=resolve;})); const saved=jest.fn();
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'),{target:{value:'PRIVATE ACCOUNT A'}});
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة خاصة'}));
  const signal=apiRequest.mock.calls[0][1].signal;
  act(()=>setSession('synthetic-b')); await act(async()=>complete({}));
  expect(signal.aborted).toBe(true); expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('');
});

test('explicit review publishes exactly once using existing contract; Enter never publishes', async () => {
  apiRequest.mockResolvedValue({}); const saved=jest.fn();
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={stores} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.submit(screen.getByLabelText('عنوان المنتج').closest('form'));
  expect(apiRequest).not.toHaveBeenCalled(); next(); next();
  fireEvent.click(screen.getByLabelText('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.'));
  const publish=screen.getByRole('button',{name:'اعتماد ونشر'});
  fireEvent.submit(publish.closest('form')); expect(apiRequest).not.toHaveBeenCalled();
  fireEvent.click(publish); fireEvent.click(publish); await act(async()=>{});
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(apiRequest).toHaveBeenCalledWith('/products/product-a',expect.objectContaining({method:'PUT',body:expect.objectContaining({isDraft:false,publishApproved:true,hasImageRights:true,availabilityConfirmed:true,currency:'MAD',moq:10})}));
  expect(saved).toHaveBeenCalledWith(false);
});

test('unapproved store and missing license block publication without blocking drafts', async () => {
  apiRequest.mockResolvedValue({});
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={[{...stores[0],reviewStatus:'pending'}]} onSaved={()=>{}} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.change(screen.getByLabelText('مصدر حق الصورة'),{target:{value:'licensed'}}); next();next();
  fireEvent.click(screen.getByLabelText('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.'));
  expect(screen.getByRole('button',{name:'اعتماد ونشر'})).toBeDisabled();
  expect(screen.getByText('أدخل مرجع الترخيص.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة خاصة'}));await act(async()=>{});
  expect(apiRequest.mock.calls[0][1].body.isDraft).toBe(true);
});

test('failed upload keeps inputs and allows a manual retry for a secondary managed image', async () => {
  apiRequest.mockRejectedValueOnce(new Error('network failure')).mockResolvedValue({imageUrl:'/uploads/secondary.png'});
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={stores} onSaved={()=>{}} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  fireEvent.change(screen.getByLabelText('نوع الصورة'),{target:{value:'secondary'}});
  fireEvent.change(screen.getByLabelText('ملف الصورة (حتى 10MB)'),{target:{files:[new File(['png'],'extra.png',{type:'image/png'})]}});
  fireEvent.click(screen.getByRole('button',{name:'رفع الصورة'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('network failure');
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue(completeProduct.name);
  fireEvent.click(screen.getByRole('button',{name:'رفع الصورة'})); await screen.findByText('تم رفع الصورة. راجع البيانات قبل النشر.');
  expect(screen.getByRole('button',{name:'إزالة الصورة 1'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة خاصة'}));await act(async()=>{});
  expect(apiRequest.mock.calls.at(-1)[1].body).toEqual(expect.objectContaining({imageUrl:'/uploads/example.png',images:['/uploads/secondary.png'],isDraft:true}));
});

test('failed publication preserves review data, clears approval and needs an explicit retry', async () => {
  apiRequest.mockRejectedValue(new Error('save unavailable'));
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={stores} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));next();next();
  const consent=screen.getByLabelText('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.');
  fireEvent.click(consent);fireEvent.click(screen.getByRole('button',{name:'اعتماد ونشر'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('save unavailable');
  expect(consent).not.toBeChecked();expect(screen.getByText(completeProduct.name)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'اعتماد ونشر'})).toBeDisabled();
});

test('lost creation acknowledgement recovers the exact frozen payload and key without an ordinary second save', async () => {
  const lost = Object.assign(new Error('response lost after write'), { status: 0 });
  const unavailable = Object.assign(new Error('restart in progress'), { status: 503 });
  apiRequest.mockRejectedValueOnce(lost).mockRejectedValueOnce(unavailable).mockResolvedValueOnce({ product: { _id: 'one-product', isDraft: true }, creation: { replayed: true } });
  const saved = jest.fn();
  render(<LanguageProvider><ProductEditor stores={stores} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'مسودة واحدة فقط' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  const recovery = await screen.findByRole('button', { name: 'استكمال محاولة الحفظ' });
  const first = apiRequest.mock.calls[0][1];
  expect(first.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(screen.getByRole('button', { name: 'حفظ مسودة خاصة' })).toBeDisabled();
  expect(screen.getByLabelText('عنوان المنتج')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'إلغاء', exact: true })).toBeDisabled();
  // Even a queued input event cannot change the payload already submitted.
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'تعديل لم يرسل' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  expect(apiRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(recovery);
  await screen.findByText('restart in progress');
  fireEvent.click(screen.getByRole('button', { name: 'استكمال محاولة الحفظ' }));
  await act(async()=>{});
  expect(apiRequest).toHaveBeenCalledTimes(3);
  for (const [, options] of apiRequest.mock.calls) {
    expect(options.headers).toEqual(first.headers);
    expect(options.body).toEqual(first.body);
    expect(options.body.name).toBe('مسودة واحدة فقط');
  }
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved).toHaveBeenCalledWith(true);
  expect(Object.keys(localStorage)).toEqual(['jomla_lang']);
});

test('publication recovery reuses the explicit original consent without preselecting a fresh approval', async () => {
  const { _id, ...initialDraft } = completeProduct;
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('published response lost'), { status: 0 })).mockResolvedValueOnce({ product: { _id: 'published-once', isDraft: false }, creation: { replayed: true } });
  const saved = jest.fn();
  render(<LanguageProvider><ProductEditor initialDraft={initialDraft} stores={stores} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByLabelText('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.'));
  next(); next();
  const approval = screen.getByLabelText('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.');
  expect(approval).not.toBeChecked();
  fireEvent.click(approval);
  fireEvent.click(screen.getByRole('button', { name: 'اعتماد ونشر' }));
  const recovery = await screen.findByRole('button', { name: 'استكمال محاولة الحفظ' });
  expect(approval).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'اعتماد ونشر' })).toBeDisabled();
  expect(screen.getByText(/استكمال محاولة الحفظ يستخدم البيانات وإقرار النشر/)).toBeInTheDocument();
  fireEvent.click(recovery);
  await act(async()=>{});
  const first = apiRequest.mock.calls[0][1], replay = apiRequest.mock.calls[1][1];
  expect(replay.body).toEqual(first.body);
  expect(replay.headers).toEqual(first.headers);
  expect(replay.body).toEqual(expect.objectContaining({ isDraft: false, publishApproved: true, hasImageRights: true }));
  expect(saved).toHaveBeenCalledWith(false);
});

test('double clicking creation or recovery sends only one request at a time', async () => {
  let rejectFirst, resolveReplay;
  apiRequest.mockImplementationOnce(()=>new Promise((resolve,reject)=>{rejectFirst=reject;})).mockImplementationOnce(()=>new Promise(resolve=>{resolveReplay=resolve;}));
  const saved=jest.fn();
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  const save=screen.getByRole('button',{name:'حفظ مسودة خاصة'});
  fireEvent.click(save); fireEvent.click(save);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async()=>rejectFirst(Object.assign(new Error('lost'),{status:0})));
  const recover=screen.getByRole('button',{name:'استكمال محاولة الحفظ'});
  fireEvent.click(recover); fireEvent.click(recover);
  expect(apiRequest).toHaveBeenCalledTimes(2);
  await act(async()=>resolveReplay({product:{_id:'one',isDraft:true}}));
  expect(saved).toHaveBeenCalledTimes(1);
});

test('a conflict keeps the unresolved key and cannot silently create another operation', async () => {
  apiRequest.mockRejectedValue(Object.assign(new Error('key payload conflict'), { status: 409 }));
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  const recovery=await screen.findByRole('button', { name: 'استكمال محاولة الحفظ' });
  fireEvent.click(recovery); await act(async()=>{});
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(apiRequest.mock.calls[1][1].headers).toEqual(apiRequest.mock.calls[0][1].headers);
  expect(apiRequest.mock.calls[1][1].body).toEqual(apiRequest.mock.calls[0][1].body);
  expect(screen.getByRole('button', { name: 'حفظ مسودة خاصة' })).toBeDisabled();
});

test('a definitive validation rejection permits corrected data with a fresh creation key', async () => {
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('invalid data'), { status: 400 })).mockResolvedValueOnce({ product: { _id: 'corrected', isDraft: true } });
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await screen.findByText('invalid data');
  expect(screen.queryByRole('button', { name: 'استكمال محاولة الحفظ' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'بيانات مصححة' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await act(async()=>{});
  expect(apiRequest.mock.calls[1][1].headers['Idempotency-Key']).not.toBe(apiRequest.mock.calls[0][1].headers['Idempotency-Key']);
  expect(apiRequest.mock.calls[1][1].body.name).toBe('بيانات مصححة');
});

test('account switching discards unresolved creation data and never reuses its key or token', async () => {
  setSession('supplier-r1-a');
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('lost for A'), { status: 0 })).mockResolvedValueOnce({ product: { _id: 'b-product', isDraft: true } });
  const saved=jest.fn();
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={saved} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'PRIVATE R1 A' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await screen.findByRole('button', { name: 'استكمال محاولة الحفظ' });
  const original=apiRequest.mock.calls[0][1];
  act(()=>setSession('supplier-r1-b'));
  expect(screen.queryByRole('button', { name: 'استكمال محاولة الحفظ' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('');
  expect(original.signal.aborted).toBe(true);
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'PRODUCT B' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await act(async()=>{});
  const current=apiRequest.mock.calls[1][1];
  expect(current.token).toBe('supplier-r1-b');
  expect(current.body.name).toBe('PRODUCT B');
  expect(current.headers['Idempotency-Key']).not.toBe(original.headers['Idempotency-Key']);
  expect(saved).toHaveBeenCalledTimes(1);
});

test('a fresh editor creates a distinct operation after a completed product', async () => {
  apiRequest.mockResolvedValue({ product: { _id: 'created', isDraft: true } });
  const first=render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await act(async()=>{}); first.unmount();
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await act(async()=>{});
  expect(apiRequest.mock.calls[1][1].headers['Idempotency-Key']).not.toBe(apiRequest.mock.calls[0][1].headers['Idempotency-Key']);
});

test('existing product edits retain PUT semantics without a creation key or blocked create recovery', async () => {
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('edit unavailable'), { status: 503 })).mockResolvedValueOnce({ product: { ...completeProduct, isDraft: true } });
  render(<LanguageProvider><ProductEditor product={completeProduct} stores={stores} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await screen.findByText('edit unavailable');
  expect(screen.queryByRole('button', { name: 'استكمال محاولة الحفظ' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('عنوان المنتج'), { target: { value: 'تعديل محفوظ' } });
  fireEvent.click(screen.getByRole('button', { name: 'حفظ مسودة خاصة' }));
  await act(async()=>{});
  for (const [path, options] of apiRequest.mock.calls) {
    expect(path).toBe('/products/product-a'); expect(options.method).toBe('PUT');
    expect(options.headers).toBeUndefined();
  }
  expect(apiRequest.mock.calls[1][1].body.name).toBe('تعديل محفوظ');
});

test('French suppliers receive an explicit recovery action and explanation', async () => {
  localStorage.setItem('jomla_lang','fr');
  apiRequest.mockRejectedValue(Object.assign(new Error('Connexion interrompue'), { status: 0 }));
  render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer un brouillon privé' }));
  expect(await screen.findByRole('button', { name: 'Reprendre l’enregistrement' })).toBeEnabled();
  expect(screen.getByText(/Le résultat du brouillon est incertain/)).toBeInTheDocument();
  expect(document.documentElement.dir).toBe('ltr');
});

test('creation never falls back to an unsafe or missing request key', async () => {
  const secureCrypto=globalThis.crypto;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  try {
    render(<LanguageProvider><ProductEditor stores={[]} onSaved={jest.fn()} onCancel={()=>{}} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة خاصة'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تأمين معرف الحفظ');
    expect(apiRequest).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:secureCrypto});
  }
});
