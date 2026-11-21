import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import BuyerDashboard from './BuyerDashboard'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }))
const rfq = { _id: 'rfq-1', status: 'responded', currentOfferId: 'offer-current', quantity: 20, productId: { name: 'أحذية بالجملة', unit: 'زوج' }, supplierId: { name: 'المورد' } }
const current = { _id: 'offer-current', status: 'active', unitPrice: 90, totalPrice: 1800, currency: 'MAD', deliveryDays: 4 }
const previous = { ...current, _id: 'offer-old', status: 'superseded', unitPrice: 100 }
const renderBuyer = () => render(<LanguageProvider><BuyerDashboard user={{ name: 'المشتري' }} onBack={jest.fn()} /></LanguageProvider>)
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('supplierToken', 'test-token'); apiRequest.mockReset()
  apiRequest.mockImplementation(async path => {
    if (path === '/rfq/buyer') return { data: [rfq] }
    if (path === '/sourcing/buyer') return { data: [] }
    if (path === '/notifications') return { data: [{ _id: 'notice-1', type: 'offer_received', resourceType: 'rfq', resourceId: rfq._id, readAt: null, createdAt: new Date().toISOString() }], unreadCount: 1 }
    if (path.endsWith('/thread')) return { thread: { messages: [] }, offers: [current, previous] }
    return {}
  })
})
test('only the current offer can be accepted and its explicit id is sent', async () => {
  renderBuyer()
  fireEvent.click(await screen.findByRole('button', { name: 'العروض والمحادثة' }))
  const accept = await screen.findByRole('button', { name: 'قبول العرض' })
  expect(screen.getAllByRole('button', { name: 'قبول العرض' })).toHaveLength(1)
  fireEvent.click(accept)
  expect(apiRequest.mock.calls.some(([path]) => path.endsWith('/action'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد قبول العرض' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/rfq/rfq-1/action', expect.objectContaining({ method: 'PUT', body: { action: 'accept', offerId: 'offer-current' } })))
})

test('an offering RFQ remains in follow-up filters and neither offer can be accepted', async () => {
  const base = apiRequest.getMockImplementation(), pending = { ...rfq, status: 'offering', revision: 3 }
  apiRequest.mockImplementation((path, options) => path === '/rfq/buyer'
    ? Promise.resolve({ data: [pending] }) : path.endsWith('/thread')
      ? Promise.resolve({ rfq: pending, thread: { messages: [], status: 'open' }, offers: [current, { ...previous, status: 'preparing' }] }) : base(path, options))
  renderBuyer()
  fireEvent.change(screen.getByLabelText('تصفية الحالة'), { target: { value: 'review' } })
  fireEvent.click(await screen.findByRole('button', { name: 'العروض والمحادثة' }))
  expect(await screen.findByText('عرض غير جاهز بعد')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'قبول العرض', exact: true })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('رسالتك للمورد')).not.toBeInTheDocument()
  expect(apiRequest.mock.calls.some(([path]) => path.endsWith('/action'))).toBe(false)
})
test('a rejected message request preserves the text and reports the error', async () => {
  const base = apiRequest.getMockImplementation()
  apiRequest.mockImplementation((path, options) => path.endsWith('/messages') ? Promise.reject(new Error('فشل الإرسال')) : base(path, options))
  renderBuyer()
  fireEvent.click(await screen.findByRole('button', { name: 'العروض والمحادثة' }))
  const textarea = await screen.findByLabelText('رسالتك للمورد')
  fireEvent.change(textarea, { target: { value: 'أحتاج قياسات أخرى' } })
  fireEvent.click(screen.getByRole('button', { name: 'إرسال' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('فشل الإرسال')
  expect(textarea).toHaveValue('أحتاج قياسات أخرى')
  expect(screen.queryByText('تم حفظ التغيير.')).not.toBeInTheDocument()
})
test('notifications are visible, markable, and translated to French', async () => {
  localStorage.setItem('jomla_lang', 'fr')
  renderBuyer()
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications (1)' }))
  expect(await screen.findByRole('heading', { name: 'Une offre est arrivée' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Marquer comme lu' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/notifications/notice-1/read', expect.objectContaining({ method: 'PUT' })))
})

test('a late response for the previous request cannot replace the selected conversation', async () => {
  let finishFirst
  const second = { ...rfq, _id: 'rfq-2', productId: { name: 'طلب آخر', unit: 'قطعة' } }
  const base = apiRequest.getMockImplementation()
  apiRequest.mockImplementation((path, options) => {
    if (path === '/rfq/buyer') return Promise.resolve({ data: [rfq, second] })
    if (path === '/rfq/rfq-1/thread') return new Promise(resolve => { finishFirst = resolve })
    if (path === '/rfq/rfq-2/thread') return Promise.resolve({
      thread: { messages: [{ _id: 'b', senderName: 'مورد ب', senderRole: 'supplier', content: 'رسالة الطلب ب', sentAt: new Date().toISOString() }] }, offers: []
    })
    return base(path, options)
  })
  renderBuyer()
  const buttons = await screen.findAllByRole('button', { name: 'العروض والمحادثة' })
  fireEvent.click(buttons[0])
  await waitFor(() => expect(finishFirst).toBeDefined())
  fireEvent.click(screen.getByRole('button',{name:'إغلاق'}))
  fireEvent.click(buttons[1])
  expect(await screen.findByText('رسالة الطلب ب')).toBeInTheDocument()
  await act(async () => finishFirst({
    thread: { messages: [{ _id: 'a', senderName: 'مورد أ', senderRole: 'supplier', content: 'رسالة الطلب أ', sentAt: new Date().toISOString() }] }, offers: []
  }))
  expect(screen.queryByText('رسالة الطلب أ')).not.toBeInTheDocument()
  expect(screen.getByText('رسالة الطلب ب')).toBeInTheDocument()
})

test('a pending saved decision disables conflicting decisions and safely retries its exact action and offer', async () => {
  const pending = { ...rfq, status: 'deciding', decision: { phase: 'pending', action: 'accept', offerId: current._id } }
  const base = apiRequest.getMockImplementation()
  apiRequest.mockImplementation((path, options) => {
    if (path === '/rfq/buyer') return Promise.resolve({ data: [pending] })
    if (path.endsWith('/action')) return Promise.resolve({ processing: true, rfq: pending })
    return base(path, options)
  })
  renderBuyer()
  fireEvent.click(await screen.findByRole('button', { name: 'العروض والمحادثة' }))
  expect(await screen.findByRole('button', { name: 'إعادة استكمال القرار' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'قبول العرض' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'رفض العرض' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'إعادة استكمال القرار' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/rfq/rfq-1/action', expect.objectContaining({
    method: 'PUT', body: { action: 'accept', offerId: 'offer-current' }
  })))
  await waitFor(() => expect(screen.getAllByText('حُفظ قرارك وجارٍ استكماله.').length).toBeGreaterThan(0))
})

test('before acceptance, the selected offer definition takes precedence over a changed catalog unit', async () => {
  const base = apiRequest.getMockImplementation()
  apiRequest.mockImplementation((path, options) => path === '/rfq/buyer' ? Promise.resolve({ data: [{ ...rfq,
    productId: { name: 'منتج الكتالوج المعدل', unit: 'صندوق' },
    offer: { productSnapshot: { name: 'المنتج كما عرض', unit: 'زوج' } }
  }] }) : base(path, options))
  renderBuyer()
  expect(await screen.findByRole('heading', { name: 'المنتج كما عرض' })).toBeInTheDocument()
  expect(screen.getByText('الكمية: 20 زوج')).toBeInTheDocument()
  expect(screen.queryByText(/20 صندوق/)).not.toBeInTheDocument()
})


test('confirmation can be cancelled and Escape returns focus without deciding', async () => {
  renderBuyer(); const trigger=await screen.findByRole('button',{name:'العروض والمحادثة'}); trigger.focus(); fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button',{name:'رفض العرض'}));
  fireEvent.click(screen.getByRole('button',{name:'إلغاء القرار'}));
  expect(screen.queryByRole('button',{name:'تأكيد رفض العرض'})).not.toBeInTheDocument();
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(apiRequest.mock.calls.filter(([path])=>path.endsWith('/action'))).toHaveLength(0);
});

test('two rapid confirmation clicks send one decision request', async () => {
  let finish; const base=apiRequest.getMockImplementation();
  apiRequest.mockImplementation((path,options)=>path.endsWith('/action')?new Promise(resolve=>{finish=resolve}):base(path,options));
  renderBuyer(); fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));
  fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));
  const confirm=screen.getByRole('button',{name:'تأكيد قبول العرض'}); fireEvent.click(confirm);fireEvent.click(confirm);
  await waitFor(()=>expect(finish).toBeDefined());expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/action'))).toHaveLength(1);
  await act(async()=>finish({rfq:{...rfq,status:'accepted'}}));
});

test('202 is retained when a following read fails and never appears as a completed agreement', async () => {
  let decided=false;const base=apiRequest.getMockImplementation();
  const pending={...rfq,revision:2,status:'deciding',decision:{phase:'pending',action:'accept',offerId:current._id}};
  apiRequest.mockImplementation((path,options)=>{
    if(path.endsWith('/action')){decided=true;return Promise.resolve({processing:true,rfq:pending})}
    if(decided && ['/rfq/buyer','/rfq/rfq-1/thread'].includes(path))return Promise.reject(new Error('قراءة غير متاحة'));
    return base(path,options);
  });
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));fireEvent.click(screen.getByRole('button',{name:'تأكيد قبول العرض'}));
  expect(await screen.findByRole('heading',{name:'القرار محفوظ وقيد الاستكمال'})).toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'بيانات الاتفاق المثبتة'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'رفض العرض'})).not.toBeInTheDocument();expect(screen.queryByLabelText('رسالتك للمورد')).not.toBeInTheDocument();
});

test('an ambiguous failed decision blocks another decision until authoritative refresh',async()=>{
  const base=apiRequest.getMockImplementation(); apiRequest.mockImplementation((p,o)=>p.endsWith('/action')?Promise.reject(new Error('انقطع الاتصال')):base(p,o));
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));fireEvent.click(screen.getByRole('button',{name:'تأكيد قبول العرض'}));
  expect(await screen.findByRole('button',{name:'تحديث حالة الطلب'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'رفض العرض'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'تحديث حالة الطلب'})); await waitFor(()=>expect(screen.getByRole('button',{name:'رفض العرض'})).toBeEnabled());
});

test('notification navigation checks ownership and a denied request never opens a conversation',async()=>{
  const base=apiRequest.getMockImplementation();apiRequest.mockImplementation((p,o)=>p==='/rfq/rfq-1'?Promise.reject(new Error('غير مصرح')):base(p,o));
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'الإشعارات (1)'}));fireEvent.click(screen.getByRole('button',{name:'فتح الطلب'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('غير مصرح');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(apiRequest.mock.calls.some(([p])=>p.endsWith('/read'))).toBe(false);
});

test('authorized notification opens the exact request and marks it read',async()=>{
  const base=apiRequest.getMockImplementation();apiRequest.mockImplementation((p,o)=>p==='/rfq/rfq-1'?Promise.resolve(rfq):base(p,o));
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'الإشعارات (1)'}));fireEvent.click(screen.getByRole('button',{name:'فتح الطلب'}));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();await waitFor(()=>expect(apiRequest).toHaveBeenCalledWith('/notifications/notice-1/read',expect.objectContaining({method:'PUT'})));
});

test('late notifications and conversations from a previous account are discarded',async()=>{
  const {setSession}=require('../../api/session');let finish;const base=apiRequest.getMockImplementation();
  apiRequest.mockImplementation((p,o)=>{
    if(o.token==='second-token')return Promise.resolve(p==='/notifications'?{data:[],unreadCount:0}:{data:[]});
    if(p==='/notifications')return new Promise(resolve=>{finish=resolve});return base(p,o);
  });
  renderBuyer();await waitFor(()=>expect(finish).toBeDefined());
  await act(async()=>setSession('second-token'));
  fireEvent.click(await screen.findByRole('button',{name:'الإشعارات (0)'}));
  await act(async()=>finish({data:[{_id:'old',type:'message_received',titleAr:'إشعار الحساب السابق'}],unreadCount:9}));
  expect(screen.queryByText('إشعار الحساب السابق')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'الإشعارات (0)'})).toBeInTheDocument();
  expect(screen.queryByText('أحذية بالجملة')).not.toBeInTheDocument();
});

test('the header and center share one notification refresh source',async()=>{
  jest.useFakeTimers();try{
    renderBuyer();await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'تنبيهات الحساب: 1'}));await act(async()=>{});
    expect(apiRequest.mock.calls.filter(([p])=>p==='/notifications')).toHaveLength(1);
    await act(async()=>jest.advanceTimersByTime(30000));expect(apiRequest.mock.calls.filter(([p])=>p==='/notifications')).toHaveLength(2);
  }finally{jest.useRealTimers()}
});

test('status filtering shows only the chosen existing state',async()=>{
  renderBuyer();await screen.findByRole('button',{name:'العروض والمحادثة'});fireEvent.change(screen.getByLabelText('تصفية الحالة'),{target:{value:'accepted'}});
  expect(screen.queryByRole('button',{name:'العروض والمحادثة'})).not.toBeInTheDocument();expect(screen.getByText('لا توجد طلبات بهذه الحالة')).toBeInTheDocument();
});

