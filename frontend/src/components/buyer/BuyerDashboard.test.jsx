import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import BuyerDashboard from './BuyerDashboard'
import { QuoteCartProvider } from '../cart/QuoteCartContext'
import { setSession } from '../../api/session'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }))
const rfq = { _id: 'rfq-1', status: 'responded', currentOfferId: 'offer-current', quantity: 20, productId: { name: 'أحذية بالجملة', unit: 'زوج' }, supplierId: { name: 'المورد' } }
const current = { _id: 'offer-current', status: 'active', unitPrice: 90, totalPrice: 1800, currency: 'MAD', deliveryDays: 4 }
const previous = { ...current, _id: 'offer-old', status: 'superseded', unitPrice: 100 }
const renderBuyer = () => render(<LanguageProvider><BuyerDashboard user={{ _id:'buyer-1', name: 'المشتري' }} onBack={jest.fn()} /></LanguageProvider>)
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('supplierToken', 'test-token'); apiRequest.mockReset()
  apiRequest.mockImplementation(async path => {
    if (path === '/rfq/buyer') return { data: [rfq] }
    if (path === '/sourcing/buyer') return { data: [] }
    if (path === '/notifications') return { data: [{ _id: 'notice-1', type: 'offer_received', resourceType: 'rfq', resourceId: rfq._id, readAt: null, createdAt: new Date().toISOString() }], unreadCount: 1 }
    if (path.endsWith('/thread')) return { rfq, thread: { messages: [], status:'open' }, offers: [current, previous] }
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


test('workspace summary filters actual requests and toggles back to all', async () => {
  const base=apiRequest.getMockImplementation()
  const pending={...rfq,_id:'rfq-pending',status:'pending',productId:{name:'Pending fixture',unit:'piece'}}
  const accepted={...rfq,_id:'rfq-accepted',status:'accepted',productId:{name:'Accepted fixture',unit:'piece'}}
  apiRequest.mockImplementation((path,options)=>path==='/rfq/buyer'?Promise.resolve({data:[rfq,pending,accepted]}):base(path,options))
  renderBuyer()
  await screen.findByText('Pending fixture')
  const review=screen.getByRole('button',{name:/تحتاج مراجعتك/})
  expect(review).toHaveTextContent('1')
  fireEvent.click(review)
  expect(review).toHaveAttribute('aria-pressed','true')
  expect(screen.getByLabelText('تصفية الحالة')).toHaveValue('review')
  expect(screen.queryByText('Pending fixture')).not.toBeInTheDocument()
  fireEvent.click(review)
  expect(screen.getByLabelText('تصفية الحالة')).toHaveValue('all')
  expect(screen.getByText('Pending fixture')).toBeInTheDocument()
  expect(screen.getByText('Accepted fixture')).toBeInTheDocument()
})

test('workspace links to real selection and favorites with account scoped cart count',async()=>{
  sessionStorage.clear()
  const id='buyer-test'
  setSession('test.'+btoa(JSON.stringify({id,exp:9999999999}))+'.signature')
  sessionStorage.setItem('jomla:quote-selection:v1:'+id,JSON.stringify(['111111111111111111111111','222222222222222222222222']))
  render(<LanguageProvider><QuoteCartProvider><BuyerDashboard user={{name:'Buyer',id}} onBack={jest.fn()}/></QuoteCartProvider></LanguageProvider>)
  expect(screen.getByRole('link',{name:'سلة العروض (2)'})).toHaveAttribute('href','/cart')
  expect(screen.getByRole('link',{name:'المفضلة'})).toHaveAttribute('href','/favorites')
  expect(screen.getByRole('link',{name:'السوق'})).toHaveAttribute('href','/')
  await screen.findByText('أحذية بالجملة')
  sessionStorage.clear()
})

test('failed requests load never claims zero or a confirmed empty list',async()=>{
  const base=apiRequest.getMockImplementation()
  apiRequest.mockImplementation((path,options)=>path==='/rfq/buyer'?Promise.reject(new Error('Synthetic request failure')):base(path,options))
  renderBuyer()
  await screen.findByText(/الأرقام غير مؤكدة/)
  expect(screen.getByRole('button',{name:/تحتاج مراجعتك/})).toBeDisabled()
  expect(screen.getByRole('button',{name:/تحتاج مراجعتك/})).toHaveTextContent('—')
  expect(screen.queryByText('لا توجد طلبات بهذه الحالة')).not.toBeInTheDocument()
  apiRequest.mockImplementation(base)
  fireEvent.click(screen.getByRole('button',{name:'تحديث'}))
  await screen.findByText('أحذية بالجملة')
  expect(screen.getByRole('button',{name:/تحتاج مراجعتك/})).toBeEnabled()
})

test('confirmation rechecks expiration at the actual click even if the UI has not rerendered', async()=>{
  const base=apiRequest.getMockImplementation(), now=Date.now(), clock=jest.spyOn(Date,'now').mockReturnValue(now);
  try {
    apiRequest.mockImplementation((p,o)=>p.endsWith('/thread')?Promise.resolve({rfq,thread:{messages:[],status:'open'},offers:[{...current,validUntil:new Date(now+1000).toISOString()}]}):base(p,o));
    renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));
    fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));
    const confirm=screen.getByRole('button',{name:'تأكيد قبول العرض'});
    expect(confirm).toBeEnabled();
    clock.mockReturnValue(now+2000);fireEvent.click(confirm);
    expect(screen.getByRole('alert')).toHaveTextContent('لم يعد العرض صالحاً');
    expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/action'))).toHaveLength(0);
  } finally {clock.mockRestore()}
});

test('a successful list refresh without a confirmed thread cannot unlock an ambiguous decision or send', async()=>{
  let failed=false, release=false;
  const base=apiRequest.getMockImplementation();
  apiRequest.mockImplementation((p,o)=>{
    if(p.endsWith('/action')){failed=true;return Promise.reject(new Error('Synthetic interruption'))}
    if(p.endsWith('/thread')&&failed&&!release)return Promise.resolve({thread:{messages:[],status:'open'},offers:[current]});
    return base(p,o);
  });
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));
  fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));fireEvent.click(screen.getByRole('button',{name:'تأكيد قبول العرض'}));
  const refresh=await screen.findByRole('button',{name:'تحديث حالة الطلب'});
  fireEvent.click(refresh);
  await waitFor(()=>expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/thread')).length).toBeGreaterThan(1));
  expect(screen.getByRole('button',{name:'رفض العرض'})).toBeDisabled();
  const input=screen.getByLabelText('رسالتك للمورد');fireEvent.change(input,{target:{value:'Synthetic draft'}});
  fireEvent.submit(input.closest('form'));
  expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/messages'))).toHaveLength(0);
  release=true;fireEvent.click(refresh);
  await waitFor(()=>expect(screen.getByRole('button',{name:'رفض العرض'})).toBeEnabled());
});

test('a notification response for a different request is not opened or marked read',async()=>{
  const base=apiRequest.getMockImplementation();
  apiRequest.mockImplementation((p,o)=>p==='/rfq/rfq-1'?Promise.resolve({...rfq,_id:'unexpected'}):base(p,o));
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'الإشعارات (1)'}));fireEvent.click(screen.getByRole('button',{name:'فتح الطلب'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('الطلب غير متاح لهذا الحساب.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/read'))).toHaveLength(0);
});

test('a mismatched thread cannot replace the selected request or enable a decision', async()=>{
  const base=apiRequest.getMockImplementation();
  apiRequest.mockImplementation((p,o)=>p.endsWith('/thread')?Promise.resolve({rfq:{...rfq,_id:'other'},thread:{messages:[{_id:'foreign',content:'Foreign synthetic message'}]},offers:[current]}):base(p,o));
  renderBuyer();fireEvent.click(await screen.findByRole('button',{name:'العروض والمحادثة'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('الطلب غير متاح لهذا الحساب.');
  expect(screen.queryByText('Foreign synthetic message')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'قبول العرض'})).not.toBeInTheDocument();
});

test('uncertain decisions are retained separately for different requests', async()=>{
  const second={...rfq,_id:'rfq-2',productId:{name:'Second synthetic request',unit:'piece'}};
  const base=apiRequest.getMockImplementation();let failRead=false;
  apiRequest.mockImplementation((p,o)=>{
    if(p==='/rfq/buyer')return Promise.resolve({data:[rfq,second]});
    if(p.endsWith('/action')){failRead=true;return Promise.reject(new Error('Synthetic decision interruption'))}
    if(p.endsWith('/thread')){
      const record=p.includes('rfq-2')?second:rfq;
      return Promise.resolve({...(failRead?{}:{rfq:record}),thread:{messages:[],status:'open'},offers:[current]});
    }
    return base(p,o);
  });
  renderBuyer();
  const buttons=await screen.findAllByRole('button',{name:'العروض والمحادثة'});
  for(const button of buttons){
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole('button',{name:'قبول العرض'}));
    fireEvent.click(screen.getByRole('button',{name:'تأكيد قبول العرض'}));
    await screen.findByRole('button',{name:'تحديث حالة الطلب'});
    fireEvent.click(screen.getByRole('button',{name:'إغلاق'}));
  }
  fireEvent.click(buttons[0]);
  await screen.findByRole('button',{name:'تحديث حالة الطلب'});
  await waitFor(()=>expect(screen.getByRole('button',{name:'رفض العرض'})).toBeDisabled());
});
