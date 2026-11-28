import { render,screen,fireEvent,act,waitFor } from '@testing-library/react'
import SupplierDashboard from './SupplierDashboard'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
jest.mock('../../api/config',()=>({apiRequest:jest.fn(),assetUrl:()=>''}))
const user={_id:'supplier-1',id:'supplier-1',role:'supplier',name:'المورد',permissions:['all']}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();require('../../api/session').setSession('s2-dashboard-synthetic-session');apiRequest.mockReset();apiRequest.mockImplementation(async path=>{
 if(path==='/suppliers/me/profile')return user
 if(path.startsWith('/products/mine'))return {data:[{_id:'product-1',name:'منتج المورد الخاص',isDraft:true,moq:10,price:25}],pagination:{pages:1,total:1}}
 if(path.startsWith('/stores/mine'))return {data:[]}
 if(path==='/notifications/notice-1/read')return {notification:{_id:'notice-1',readAt:'2026-11-28T00:00:00Z'}};
 if(path.startsWith('/notifications'))return {data:[{_id:'notice-1',type:'sourcing_decision',resourceType:'sourcing',resourceId:'request-1',readAt:null}]}
 if(path==='/sourcing/request-1')return {_id:'request-1',productName:'طلب تم قبوله',status:'fulfilled',quotes:[{_id:'q-1',supplierId:'supplier-1',unitPrice:20,currency:'MAD',status:'accepted',paymentTerms:'اختبار'}]}
 return {data:[]}
})})
function show(){render(<LanguageProvider><SupplierDashboard supplier={user} onBack={()=>{}} onLogout={()=>{}}/></LanguageProvider>)}
test.each([
 ['ar','طلبات الأسعار','تفاصيل ومحادثة','رفض الطلب','نية الرفض محفوظة وقيد الاستكمال؛ الرفض ليس نهائياً بعد.','استكمال رفض الطلب'],
 ['fr','Demandes de devis','Détails et conversation','Refuser la demande','Refus enregistré, finalisation en cours ; il n’est pas encore définitif.','Reprendre le refus']
])('supplier dashboard keeps 202 pending without final success (%s)',async(lang,tab,open,reject,pending,retry)=>{
 localStorage.setItem('jomla_lang',lang);require('../../api/session').setSession('r43a-dashboard-session');
 const rfq={_id:'r43a-ui',status:'responded',quantity:20,currency:'MAD',buyerName:'Synthetic buyer',productId:{name:'Synthetic product',unit:'زوج'}};
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(path,options)=>{
  if(path==='/rfq/supplier')return {data:[rfq]};
  if(path==='/rfq/r43a-ui/thread')return {rfq,thread:{messages:[]},offers:[]};
  if(path==='/rfq/r43a-ui/respond')return {rfq:{...rfq,status:'deciding',revision:3},processing:true,rejection:{version:1,phase:'pending'}};
  return base(path,options);
 });
 show();fireEvent.click(await screen.findByRole('button',{name:tab,exact:true}));
 fireEvent.click(await screen.findByRole('button',{name:open}));fireEvent.click(await screen.findByRole('button',{name:reject}));
 expect(await screen.findByText(pending)).toBeInTheDocument();expect(screen.getByRole('button',{name:retry})).toBeDisabled();
 expect(screen.queryByText(/تم إرسال الرد وحفظه|Réponse enregistrée et transmise/)).not.toBeInTheDocument();
 expect(apiRequest.mock.calls.filter(([path])=>path.endsWith('/respond'))).toHaveLength(1);
});
test('supplier products come from the private paginated endpoint and display without owner-object comparison',async()=>{
 show();fireEvent.click(await screen.findByRole('button',{name:'منتجاتي',exact:true}))
 expect(await screen.findByRole('heading',{name:'منتج المورد الخاص'})).toBeInTheDocument()
 expect(apiRequest.mock.calls.some(([path])=>path.startsWith('/products/mine?page='))).toBe(true)
 expect(apiRequest.mock.calls.some(([path])=>path==='/products')).toBe(false)
})
test('supplier can open a sourcing decision after fulfillment without resubmitting a closed offer',async()=>{
 show();fireEvent.click(await screen.findByRole('button',{name:/الإشعارات/}))
 fireEvent.click(await screen.findByRole('button',{name:'فتح الطلب'}))
 expect(await screen.findByRole('heading',{name:'طلب تم قبوله'})).toBeInTheDocument()
 expect(screen.getByText(/مقبول/)).toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'إرسال العرض'})).not.toBeInTheDocument()
})

test.each([
 ['ar','طلبات الأسعار','تفاصيل ومحادثة','سعر الوحدة (EUR / صندوق)'],
 ['fr','Demandes de devis','Détails et conversation','Prix unitaire (EUR / صندوق)']
])('the supplier sees the RFQ currency and selling unit before entering a price (%s)',async(lang,tab,open,label)=>{
 localStorage.setItem('jomla_lang',lang)
 const base=apiRequest.getMockImplementation()
 apiRequest.mockImplementation(async(path,options)=>{
  if(path==='/rfq/supplier')return {data:[{_id:'rfq-eur',status:'pending',quantity:30,currency:'EUR',buyerName:'Acheteur test',productId:{name:'Produit synthétique EUR',unit:'صندوق'}}]}
  if(path==='/rfq/rfq-eur/thread')return {thread:{messages:[]},offers:[]}
  return base(path,options)
 })
 show();fireEvent.click(await screen.findByRole('button',{name:tab,exact:true}))
 fireEvent.click(await screen.findByRole('button',{name:open}))
 expect(await screen.findByLabelText(label)).toHaveValue(null)
 expect(screen.queryByLabelText(/MAD/)).not.toBeInTheDocument()
})

test('a sourcing offer displays its fixed MAD currency and the sourcing request unit',async()=>{
 localStorage.setItem('jomla_lang','fr')
 const base=apiRequest.getMockImplementation()
 apiRequest.mockImplementation(async(path,options)=>path==='/sourcing?status=open'
  ? {data:[{_id:'sourcing-open',productName:'Demande test',status:'open',quantity:20,unit:'صندوق'}]}
  : path==='/sourcing/sourcing-open' ? {_id:'sourcing-open',productName:'Demande test',status:'open',quantity:20,unit:'صندوق',quotes:[]} : base(path,options))
 show();fireEvent.click(await screen.findByRole('button',{name:'Opportunités de sourcing',exact:true}))
 fireEvent.click(await screen.findByRole('button',{name:'Soumettre une offre'}))
 expect(await screen.findByLabelText('Prix unitaire (MAD / صندوق)')).toHaveValue(null)
 expect(screen.queryByLabelText(/EUR/)).not.toBeInTheDocument()
})

test('supplier sees the same frozen commercial agreement and a freshly closed decision hides the quote form',async()=>{
 const pending={_id:'rfq-fixed',status:'responded',quantity:20,currency:'MAD',buyerName:'المشتري',productId:{name:'اسم كتالوج جديد',unit:'صندوق'}}
 const agreed={version:1,source:'offer_snapshot',offerId:'offer-fixed',product:{name:'المنتج كما اتفقنا',unit:'زوج',description:'الوصف المثبت'},supplier:{name:'المورد'},buyer:{name:'المشتري'},unitPrice:19,totalPrice:380,quantity:20,unit:'زوج',currency:'MAD',deliveryDays:4,paymentTerms:'الشروط المثبتة'}
 const base=apiRequest.getMockImplementation()
 apiRequest.mockImplementation(async(path,options)=>{
  if(path==='/rfq/supplier')return {data:[pending]}
  if(path==='/rfq/rfq-fixed/thread')return {thread:{messages:[],status:'closed'},offers:[],rfq:{...pending,status:'accepted',decision:{phase:'completed',action:'accept',agreement:agreed}}}
  return base(path,options)
 })
 show();fireEvent.click(await screen.findByRole('button',{name:'طلبات الأسعار',exact:true}))
 fireEvent.click(await screen.findByRole('button',{name:'تفاصيل ومحادثة'}))
 expect(await screen.findByRole('heading',{name:'بيانات الاتفاق المثبتة'})).toBeInTheDocument()
 expect(screen.getByText(/الشروط المثبتة/)).toBeInTheDocument()
 expect(screen.getByText(/20 زوج/)).toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'إرسال العرض'})).not.toBeInTheDocument()
})

test('drafts scan the existing private pagination and never use the public catalog',async()=>{
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(path,options)=>{
  if(path==='/products/mine?page=1&limit=100')return {data:[{_id:'pub',name:'Published first',isDraft:false}],pagination:{pages:2,total:101}}
  if(path==='/products/mine?page=2&limit=100')return {data:[{_id:'draft-page-two',name:'مسودة في الصفحة التالية',isDraft:true}],pagination:{pages:2,total:101}}
  return base(path,options)
 });
 show();fireEvent.click(await screen.findByRole('button',{name:'المسودات',exact:true}));
 expect(await screen.findByRole('heading',{name:'مسودة في الصفحة التالية'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Published first'})).not.toBeInTheDocument();
 expect(apiRequest.mock.calls.some(([path])=>path==='/products')).toBe(false)
})

test('supplier capabilities still hide product and RFQ sections from an unprivileged staff member',async()=>{
 const staff={...user,role:'staff',permissions:[]};const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(path,options)=>path==='/suppliers/me/profile'?staff:base(path,options));
 render(<LanguageProvider><SupplierDashboard supplier={staff} onBack={()=>{}} onLogout={()=>{}}/></LanguageProvider>);
 expect(await screen.findByRole('button',{name:'الشركة والفريق'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'المسودات',exact:true})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'إضافة منتج',exact:true})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'طلبات الأسعار',exact:true})).not.toBeInTheDocument();
})

test('refreshing revoked product permission removes the currently open private product list',async()=>{
 let allowed=true;const base=apiRequest.getMockImplementation();
 const staff={...user,role:'staff',organizationId:'org-test',permissions:['manage_products']};
 apiRequest.mockImplementation(async(path,options)=>path==='/suppliers/me/profile'?{...staff,permissions:allowed?['manage_products']:[]}:base(path,options));
 render(<LanguageProvider><SupplierDashboard supplier={staff} onBack={()=>{}} onLogout={()=>{}}/></LanguageProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'منتجاتي',exact:true}));
 expect(await screen.findByRole('heading',{name:'منتج المورد الخاص'})).toBeInTheDocument();
 allowed=false;fireEvent.click(screen.getByRole('button',{name:'تحديث مساحة العمل'}));
 await screen.findByRole('button',{name:'الشركة والفريق'});
 await act(async()=>{});
 expect(screen.queryByRole('heading',{name:'منتج المورد الخاص'})).not.toBeInTheDocument();
})

test('leaving the editor offers stay or explicit discard without auto-saving or publishing',async()=>{
 show();fireEvent.click(await screen.findByRole('button',{name:'إضافة منتج',exact:true}));
 fireEvent.change(screen.getByLabelText('عنوان المنتج'),{target:{value:'مدخلات غير محفوظة'}});
 fireEvent.click(screen.getByRole('button',{name:'متاجري',exact:true}));
 expect(screen.getByRole('alert')).toHaveTextContent('ستفقد المدخلات غير المحفوظة');
 expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('مدخلات غير محفوظة');
 fireEvent.click(screen.getByRole('button',{name:'البقاء في المحرر'}));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'متاجري',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'مغادرة دون حفظ'}));
 expect(await screen.findByRole('heading',{name:'متاجر الشركة'})).toBeInTheDocument();
 expect(screen.queryByLabelText('عنوان المنتج')).not.toBeInTheDocument();
 expect(apiRequest.mock.calls.some(([,o])=>['POST','PUT'].includes(o?.method))).toBe(false);
})


test('office starts simple, advanced tools remain accessible and returning to simple keeps the current editor',async()=>{
 show();
 expect(screen.getByRole('button',{name:'مبسط'})).toHaveAttribute('aria-pressed','true');
 expect(screen.queryByRole('button',{name:'توثيق المورد',exact:true})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'متقدم'}));
 fireEvent.click(screen.getByRole('button',{name:'توثيق المورد',exact:true}));
 expect(screen.getByRole('heading',{name:'طلب مراجعة وتوثيق المورد'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'مبسط'}));
 expect(screen.getByRole('heading',{name:'نظرة عامة'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'إضافة منتج',exact:true}));
 fireEvent.change(screen.getByLabelText('عنوان المنتج'),{target:{value:'Synthetic unsaved'}});
 fireEvent.click(screen.getByRole('button',{name:'متقدم'}));
 fireEvent.click(screen.getByRole('button',{name:'مبسط'}));
 expect(screen.getByLabelText('عنوان المنتج')).toHaveValue('Synthetic unsaved');
 await act(async()=>{});
});

test('advanced mode cannot expose staff capabilities',async()=>{
 const staff={...user,role:'staff',permissions:[]};
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>p==='/suppliers/me/profile'?staff:base(p,o));
 render(<LanguageProvider><SupplierDashboard supplier={staff} onBack={()=>{}} onLogout={()=>{}}/></LanguageProvider>);
 fireEvent.click(screen.getByRole('button',{name:'متقدم'}));
 expect(screen.queryByRole('button',{name:'توثيق المورد',exact:true})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'مهام الصور',exact:true})).not.toBeInTheDocument();
 await act(async()=>{});
});

test('office counts use pagination totals and failed RFQ reads do not show zero',async()=>{
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>{
  if(p.startsWith('/stores/mine'))return {data:[],pagination:{total:103}};
  if(p==='/rfq/supplier')throw Error('Synthetic RFQ load failure');
  return base(p,o);
 });
 show();
 await screen.findByText('Synthetic RFQ load failure');
 expect(document.querySelector('.supplier-content .stat-grid').textContent).toContain('103');
 expect(document.querySelector('.supplier-priorities button strong')).toHaveTextContent('—');
 expect(document.querySelectorAll('.supplier-content .stat-grid strong')[1]).toHaveTextContent('—');
});

test('notification summary uses the server total, not the bounded inbox length',async()=>{
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>p.startsWith('/notifications')?{data:[],unreadCount:125}:base(p,o));
 show();
 expect(await screen.findByRole('button',{name:'الإشعارات (125)'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'تنبيهات الحساب: 125'})).toHaveTextContent('99+');
});

test('a failed second private draft page is not an empty catalog and retry confirms both pages',async()=>{
 let failed=true;const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>{
  if(p==='/products/mine?page=1&limit=100')return {data:[{_id:'draft-first',name:'First private draft',isDraft:true}],pagination:{pages:2,total:101}};
  if(p==='/products/mine?page=2&limit=100'){
   if(failed)throw Error('Synthetic draft page failure');
   return {data:[{_id:'draft-second',name:'Second private draft',isDraft:true}],pagination:{pages:2,total:101}};
  }
  return base(p,o);
 });
 show();fireEvent.click(await screen.findByRole('button',{name:'المسودات',exact:true}));
 await screen.findByText('Synthetic draft page failure');
 expect(screen.queryByText('لا توجد مسودات محفوظة.')).not.toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'First private draft'})).not.toBeInTheDocument();
 failed=false;fireEvent.click(screen.getByRole('button',{name:'تحديث مساحة العمل'}));
 expect(await screen.findByRole('heading',{name:'Second private draft'})).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'First private draft'})).toBeInTheDocument();
 expect(apiRequest.mock.calls.filter(([p])=>p.includes('limit=100')&&p.includes('/products/mine')).every(([,o])=>o.token==='s2-dashboard-synthetic-session')).toBe(true);
});

test('mismatched supplier thread cannot expose foreign messages or submit an offer',async()=>{
 const rfq={_id:'rfq-local',status:'pending',quantity:20,currency:'MAD',productId:{name:'Local product',unit:'piece'}};
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>p==='/rfq/supplier'?{data:[rfq]}:p.endsWith('/thread')?{rfq:{...rfq,_id:'other'},thread:{messages:[{content:'Foreign message'}]},offers:[]}:base(p,o));
 show();fireEvent.click(await screen.findByRole('button',{name:'طلبات الأسعار',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'تفاصيل ومحادثة'}));
 expect(await screen.findByText('بيانات المحادثة غير مطابقة للطلب.')).toBeInTheDocument();
 expect(screen.queryByText('Foreign message')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'إرسال العرض'})).not.toBeInTheDocument();
});
test('supplier message submission is single flight and uncertain response blocks further sends until explicit refresh',async()=>{
 const rfq={_id:'rfq-message',status:'pending',quantity:20,currency:'MAD',productId:{name:'Message product',unit:'piece'}};
 const base=apiRequest.getMockImplementation();let finish;
 apiRequest.mockImplementation((p,o)=>p==='/rfq/supplier'?Promise.resolve({data:[rfq]}):p.endsWith('/thread')?Promise.resolve({rfq,thread:{rfqId:rfq._id,status:'open',messages:[]},offers:[]}):p.endsWith('/messages')?new Promise(resolve=>{finish=resolve;}):base(p,o));
 show();fireEvent.click(await screen.findByRole('button',{name:'طلبات الأسعار',exact:true}));fireEvent.click(await screen.findByRole('button',{name:'تفاصيل ومحادثة'}));
 const input=await screen.findByLabelText('رسالتك');fireEvent.change(input,{target:{value:'Synthetic supplier message'}});
 fireEvent.submit(input.closest('form'));fireEvent.submit(input.closest('form'));
 expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/messages'))).toHaveLength(1);
 await act(async()=>finish({}));
 expect(await screen.findByText(/لم يتأكد إرسال الرسالة/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'إرسال العرض'})).toBeDisabled();
 expect(input).toHaveValue('Synthetic supplier message');
 fireEvent.submit(input.closest('form'));
 expect(apiRequest.mock.calls.filter(([p])=>p.endsWith('/messages'))).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'تحديث المحادثة'}));
 await act(async()=>{});
 expect(screen.getByRole('button',{name:'إرسال العرض'})).toBeEnabled();
});

const noticeRfq={_id:'notice-rfq',type:'message_received',resourceType:'rfq',resourceId:'rfq-target',readAt:null};
const directRfq={_id:'rfq-target',supplierId:{_id:'supplier-1'},buyerId:'buyer-1',buyerName:'Synthetic buyer',status:'responded',quantity:12,currency:'MAD',productId:{name:'Notification product',unit:'piece'}};
const directThread={rfq:{...directRfq,supplierId:'supplier-1',status:'rejected'},thread:{rfqId:'rfq-target',supplierId:'supplier-1',buyerId:'buyer-1',status:'closed',messages:[]},offers:[]};
function targetMock(overrides={}){
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation(async(p,o)=>{
  if(Object.hasOwn(overrides,p))return typeof overrides[p]==='function'?overrides[p](o):overrides[p];
  if(p==='/notifications?limit=50')return {data:[noticeRfq],unreadCount:1};
  if(p==='/rfq/supplier')return {data:[]};
  if(p==='/rfq/rfq-target')return directRfq;
  if(p==='/rfq/rfq-target/thread')return directThread;
  if(p==='/notifications/notice-rfq/read')return {notification:{...noticeRfq,readAt:'2026-11-28T00:00:00Z'}};
  return base(p,o);
 });
}
async function openInbox(){fireEvent.click(await screen.findByRole('button',{name:/^الإشعارات/}));return screen.findByRole('button',{name:'فتح الطلب'});}
test('notification fetches absent RFQ and verified matching thread before marking read; latest closed state wins',async()=>{
 targetMock();show();const open=await openInbox();fireEvent.click(open);fireEvent.click(open);
 expect(await screen.findByRole('dialog')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'إرسال العرض'})).toBeNull();
 await waitFor(()=>expect(apiRequest.mock.calls.filter(([p])=>p==='/notifications/notice-rfq/read')).toHaveLength(1));
 const calls=apiRequest.mock.calls;expect(calls.filter(([p])=>p==='/rfq/rfq-target')).toHaveLength(1);
 expect(calls.findIndex(([p])=>p==='/rfq/rfq-target/thread')).toBeLessThan(calls.findIndex(([p])=>p==='/notifications/notice-rfq/read'));
 expect(calls.find(([p])=>p==='/rfq/rfq-target')[1]).toMatchObject({cache:'no-store',token:'s2-dashboard-synthetic-session'});
});
test.each([
 ['foreign record',{'/rfq/rfq-target':{...directRfq,supplierId:'foreign'}}],
 ['wrong thread',{'/rfq/rfq-target/thread':{...directThread,thread:{...directThread.thread,rfqId:'other'}}}],
 ['forbidden',{'/rfq/rfq-target':()=>{throw Error('Synthetic access denied')}}],
 ['missing thread',{'/rfq/rfq-target/thread':{rfq:directRfq,thread:null,offers:[]}}]
])('failed notification target (%s) never opens or marks read',async(_,overrides)=>{
 targetMock(overrides);show();fireEvent.click(await openInbox());await screen.findByRole('alert');
 expect(screen.queryByRole('dialog')).toBeNull();expect(apiRequest.mock.calls.some(([p,o])=>p.endsWith('/read')&&o?.method==='PUT')).toBe(false);
});
test('switching tab during pending lookup cancels late target and does not mark read',async()=>{
 let finish;targetMock({'/rfq/rfq-target':()=>new Promise(r=>{finish=r})});show();fireEvent.click(await openInbox());
 fireEvent.click(screen.getByRole('button',{name:'نظرة عامة',exact:true}));await act(async()=>finish(directRfq));
 expect(screen.queryByRole('dialog')).toBeNull();expect(apiRequest.mock.calls.some(([p])=>p==='/rfq/rfq-target/thread'||p.endsWith('/read'))).toBe(false);
});
test('session replacement drops pending target and prevents old-session private dialog',async()=>{
 let finish;targetMock({'/rfq/rfq-target':()=>new Promise(r=>{finish=r})});show();fireEvent.click(await openInbox());
 await act(async()=>{require('../../api/session').setSession('new-supplier-session');finish(directRfq)});
 expect(screen.queryByRole('dialog')).toBeNull();expect(apiRequest.mock.calls.some(([p])=>p==='/rfq/rfq-target/thread'||p.endsWith('/read'))).toBe(false);
});
test('unsupported notification type cannot trigger a sourcing lookup',async()=>{
 targetMock({'/notifications?limit=50':{data:[{...noticeRfq,resourceType:'future',type:'future'}],unreadCount:1}});show();expect(await openInbox()).toBeDisabled();
 expect(apiRequest.mock.calls.some(([p])=>p==='/sourcing/rfq-target')).toBe(false);
});
test('read acknowledgement failure keeps confirmed dialog and explicitly reports uncertain read state',async()=>{
 targetMock({'/notifications/notice-rfq/read':()=>{throw Error('Synthetic read outage')}});show();fireEvent.click(await openInbox());
 expect(await screen.findByRole('dialog')).toBeInTheDocument();expect(await screen.findByText(/لم يتأكد تعليم الإشعار كمقروء/)).toBeInTheDocument();
});
