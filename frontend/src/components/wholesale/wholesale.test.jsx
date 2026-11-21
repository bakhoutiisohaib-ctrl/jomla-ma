import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WholesaleWorkspace from './WholesaleWorkspace';
import WholesalePage from './WholesalePage';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
import { parseRoute, safeReturnTo, opportunityPath } from '../../navigation';
import CommercialAgreement, { agreedProduct } from '../common/CommercialAgreement';
import SupplierOfferForm from '../suppliers/SupplierOfferForm';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
jest.mock('../common/ProtectedImage',()=>props=><img alt={props.alt} data-reference={props.value}/>);
const pid='6ad7e13f5b9e1437e32f6aba', oid='6ad7e13f5b9e1437e32f6abc';
const product={_id:pid,name:'أحذية الجملة',unit:'زوج',currency:'MAD',moq:10,imageUrl:'/uploads/synthetic.jpg'};
const offer={_id:oid,productId:pid,storeId:'6ad7e13f5b9e1437e32f6abb',title:'فرصة الاختبار',description:'وصف تجاري',terms:'شروط أصلية',price:90,moq:20,currency:'MAD',unit:'زوج',revision:0,status:'draft',expiresAt:'2030-01-01T10:00:00.000Z',priceTiers:[],product,store:{name:'متجر اختبار',city:'الرباط'},supplier:{name:'المورد'}};
const view = node => render(<LanguageProvider>{node}</LanguageProvider>);
beforeEach(()=>{localStorage.clear();localStorage.setItem('supplierToken','w1-synthetic-owner');apiRequest.mockReset();window.history.replaceState({},'','/');});
function setupWorkspace(handler) {
  apiRequest.mockImplementation(async(path,options)=>{
    if(options?.method)return handler(path,options);
    if(path.includes('/eligible-products'))return {data:[product],pages:1};
    return {data:[],total:0};
  });
}
async function fillWorkspace() {
  await screen.findByRole('option',{name:product.name});
  fireEvent.change(screen.getByLabelText('المنتج المنشور'),{target:{value:pid}});
  fireEvent.change(screen.getByLabelText('السعر لكل وحدة'),{target:{value:'90'}});
}
test('supplier saves a draft explicitly, publishes and pauses without auto-POST on opening',async()=>{
  let current=offer;
  setupWorkspace(async(_p,options)=>{current={...current,...options.body,revision:options.method==='POST'?0:current.revision+1};return {opportunity:current};});
  view(<WholesaleWorkspace/>);await fillWorkspace();expect(apiRequest.mock.calls.every(([,o])=>!o.method)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة'}));
  await screen.findByRole('button',{name:'نشر الفرصة'});
  const post=apiRequest.mock.calls.find(([,o])=>o.method==='POST');expect(post[0]).toBe('/wholesale-opportunities');expect(post[1].headers['Idempotency-Key']).toMatch(/^[a-f0-9]{32}$/);
  expect(post[1].body).toMatchObject({productId:pid,price:90,unit:'زوج',currency:'MAD'});expect(post[1].body.status).toBeUndefined();
  fireEvent.click(screen.getByRole('button',{name:'نشر الفرصة'}));
  await waitFor(()=>expect(apiRequest.mock.calls.filter(([,o])=>o.method==='PUT')).toHaveLength(1));
  await waitFor(()=>expect(screen.getByRole('button',{name:'إيقاف الفرصة'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'إيقاف الفرصة'}));
  await waitFor(()=>expect(apiRequest.mock.calls.filter(([,o])=>o.method==='PUT')).toHaveLength(2));
  const puts=apiRequest.mock.calls.filter(([,o])=>o.method==='PUT');expect(puts[0][1].body.status).toBe('published');expect(puts[1][1].body).toEqual({status:'paused',revision:1});
});
test('uncertain creation locks original inputs and retry uses the exact same key/body',async()=>{
  let calls=0;
  setupWorkspace(async()=>{if(++calls===1)throw Object.assign(new Error('Network uncertain'),{status:0});return {opportunity:offer};});
  view(<WholesaleWorkspace/>);await fillWorkspace();fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة'}));
  await screen.findByRole('button',{name:'استكمال حفظ المحاولة نفسها'});expect(screen.getByLabelText('السعر لكل وحدة')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'استكمال حفظ المحاولة نفسها'}));
  await screen.findByRole('button',{name:'نشر الفرصة'});
  const sends=apiRequest.mock.calls.filter(([,o])=>o.method==='POST');expect(sends).toHaveLength(2);
  expect(sends[1][1].body).toEqual(sends[0][1].body);expect(sends[1][1].headers).toEqual(sends[0][1].headers);
  expect(Object.keys(localStorage)).toEqual(['supplierToken','jomla_lang']);
});
test('double click is fenced and a response from the previous account is discarded',async()=>{
  let finish;setupWorkspace(()=>new Promise(resolve=>{finish=resolve;}));
  view(<WholesaleWorkspace/>);await fillWorkspace();const button=screen.getByRole('button',{name:'حفظ مسودة'});
  fireEvent.click(button);fireEvent.click(button);expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
  act(()=>setSession('w1-other-owner'));
  await act(async()=>finish({opportunity:{...offer,title:'PRIVATE_PREVIOUS_OWNER'}}));
  expect(screen.queryByDisplayValue('PRIVATE_PREVIOUS_OWNER')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'نشر الفرصة'})).not.toBeInTheDocument();
});
test('unmount aborts in-flight requests without applying a late result',async()=>{
  let finish;setupWorkspace(()=>new Promise(resolve=>{finish=resolve;}));
  const rendered=view(<WholesaleWorkspace/>);await fillWorkspace();fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة'}));
  const send=apiRequest.mock.calls.find(([,o])=>o.method==='POST');rendered.unmount();expect(send[1].signal.aborted).toBe(true);
  await act(async()=>finish({opportunity:offer}));
});
test.each(['ar','fr'])('public list is readable without JWT in %s with links, terms and filters',async lang=>{
  localStorage.setItem('jomla_lang',lang);apiRequest.mockResolvedValue({data:[{...offer,status:'published',effectivePrice:85}],total:1,limit:12});
  view(<WholesalePage/>);
  expect(await screen.findByRole('heading',{name:offer.title})).toBeInTheDocument();
  expect(apiRequest.mock.calls[0][1]).toMatchObject({token:'',cache:'no-store'});expect(document.documentElement.dir).toBe(lang==='fr'?'ltr':'rtl');
  expect(screen.getByRole('link',{name:offer.title})).toHaveAttribute('href',opportunityPath(oid));
  fireEvent.change(screen.getByLabelText(lang==='fr'?'Quantité souhaitée':'الكمية المطلوبة'),{target:{value:'40'}});
  fireEvent.click(screen.getByRole('button',{name:lang==='fr'?'Filtrer les opportunités':'تصفية الفرص'}));
  await waitFor(()=>expect(apiRequest.mock.calls.some(([p])=>p.includes('quantity=40'))).toBe(true));
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
});
test('visitor RFQ redirects back to opportunity, while supplier cannot request and expiry disables action',async()=>{
  localStorage.removeItem('supplierToken');apiRequest.mockResolvedValue({opportunity:{...offer,status:'published'}});const login=jest.fn();
  const rendered=view(<WholesalePage id={oid} onRequireLogin={login}/>);
  fireEvent.click(await screen.findByRole('button',{name:'طلب عرض سعر لهذه الفرصة'}));expect(login).toHaveBeenCalledWith(opportunityPath(oid)+'?rfq=1');
  expect(apiRequest.mock.calls.some(([,o])=>o.method==='POST')).toBe(false);rendered.unmount();
  apiRequest.mockResolvedValue({opportunity:{...offer,status:'published',expiresAt:'2000-01-01T00:00:00.000Z'}});
  view(<WholesalePage id={oid} user={{role:'supplier'}} onRequireLogin={login}/>);
  expect(await screen.findByRole('button',{name:'طلب عرض سعر لهذه الفرصة'})).toBeDisabled();expect(screen.getByText('انتهت الفرصة')).toBeInTheDocument();
});
test('buyer uses existing RFQ modal with opportunity identity and immutable retry attempt',async()=>{
  let posts=0;apiRequest.mockImplementation(async(path,options)=>{
    if(path==='/rfq'){if(++posts===1)throw Object.assign(new Error('Lost acknowledgement'),{status:0});return {rfq:{_id:'rfq-created',status:'pending'}};}
    return {opportunity:{...offer,status:'published'}};
  });
  const success=jest.fn();view(<WholesalePage id={oid} user={{role:'buyer',_id:'buyer'}} onRfqCreated={success}/>);
  fireEvent.click(await screen.findByRole('button',{name:'طلب عرض سعر لهذه الفرصة'}));
  const dialog=screen.getByRole('dialog');fireEvent.change(within(dialog).getByLabelText('هاتف التواصل'),{target:{value:'+212600000001'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'إرسال طلب عرض السعر'}));
  fireEvent.click(await screen.findByRole('button',{name:'استكمال إرسال الطلب'}));
  await waitFor(()=>expect(success).toHaveBeenCalledTimes(1));
  const sends=apiRequest.mock.calls.filter(([p])=>p==='/rfq');expect(sends).toHaveLength(2);expect(sends[0][1].body).toMatchObject({productId:pid,opportunityId:oid,quantity:20});expect(sends[1][1].headers).toEqual(sends[0][1].headers);expect(sends[1][1].body).toEqual(sends[0][1].body);
});
test('direct URLs and safe post-login return use stable ids',()=>{
  expect(parseRoute('/opportunities').page).toBe('opportunities');expect(parseRoute(opportunityPath(oid))).toMatchObject({page:'opportunity',id:oid});
  expect(parseRoute('/opportunities/not-an-id').page).toBe('notFound');expect(safeReturnTo('?returnTo='+encodeURIComponent(opportunityPath(oid)+'?rfq=1'),'buyer')).toBe(opportunityPath(oid)+'?rfq=1');
});
test('negotiation shows captured opportunity context; accepted agreement uses its frozen copy',()=>{
  const context={...offer,id:oid,indicativeUnitPrice:85,product:{name:product.name},store:{name:offer.store.name}};
  const pending=view(<CommercialAgreement rfq={{status:'pending',wholesaleOpportunity:context}}/>);expect(screen.getByText('شروط أصلية')).toBeInTheDocument();pending.unmount();
  view(<CommercialAgreement rfq={{status:'accepted',wholesaleOpportunity:{...context,terms:'CHANGED_CONTEXT'},decision:{agreement:{wholesaleOpportunity:context,product:{name:product.name},supplier:{name:'Supplier'},buyer:{name:'Buyer'},unit:'زوج',quantity:40,unitPrice:88,totalPrice:3520,currency:'MAD',deliveryDays:3}}}}/>);
  expect(screen.getByText('شروط أصلية')).toBeInTheDocument();expect(screen.queryByText('CHANGED_CONTEXT')).not.toBeInTheDocument();
});
test('supplier and buyer RFQ labels use the frozen product unit after a catalog edit',()=>{
  const rfq={_id:'request',status:'pending',quantity:40,currency:'MAD',productId:{name:'CHANGED',unit:'كرتون'},wholesaleOpportunity:{product:{name:product.name,unit:'زوج'}}};
  expect(agreedProduct(rfq)).toEqual({name:product.name,unit:'زوج'});
  view(<SupplierOfferForm rfq={rfq}/>);
  expect(screen.getByLabelText('سعر الوحدة (MAD / زوج)')).toBeInTheDocument();
  expect(screen.queryByText(/كرتون/)).not.toBeInTheDocument();
});
