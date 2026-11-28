import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TradeCompletionPanel from './TradeCompletionPanel';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import { setSession, clearSession } from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
const id='1'.repeat(24), other='2'.repeat(24), sourceId='3'.repeat(24), offerId='4'.repeat(24), disputeId='5'.repeat(24);
const row={kind:'rfq',sourceId,offerId,title:'Synthetic agreement',supplierId:other,buyerConfirmed:true,supplierConfirmed:false,ownConfirmed:true,completed:false};
const receipt=(dispute=null,extra={})=>({actorId:id,role:'buyer',kind:'rfq',sourceId,offerId,dispute,...extra});
const list=(r=row,actorId=id,role='buyer')=>({actorId,role,kind:'rfq',page:1,data:[r],unavailable:0,hasNext:false});
const path='/trade-confirmations/rfq/'+sourceId+'/'+offerId+'/dispute';
const details='Synthetic dispute statement';
const open=async()=>{fireEvent.click(await screen.findByRole('button',{name:'التحقق من الاعتراض'}));};
const submit=()=>fireEvent.click(screen.getByRole('button',{name:'إرسال الاعتراض للإدارة'}));
function view(user={_id:id,role:'buyer'}){return render(<LanguageProvider><TradeCompletionPanel user={user}/></LanguageProvider>);}
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setSession('synthetic-a');apiRequest.mockReset();apiRequest.mockImplementation(async p=>p===path?receipt():list());});
afterEach(()=>{clearSession();});
test('valid private receipt gates submission and shows only verified status',async()=>{
 apiRequest.mockImplementation(async(p,o)=>p!==path?list():o.method==='POST'?receipt({_id:disputeId,status:'pending'},{replayed:false}):receipt());
 view();await open();
 const input=await screen.findByLabelText('تفاصيل الاعتراض');fireEvent.change(input,{target:{value:' '+details+' '}});
 submit();await screen.findByText(disputeId);
 expect(screen.getByText('قيد المراجعة')).toBeInTheDocument();
 expect(screen.queryByLabelText('تفاصيل الاعتراض')).not.toBeInTheDocument();
 expect(apiRequest.mock.calls.find(([p,o])=>p===path&&o.method==='POST')[1]).toMatchObject({token:'synthetic-a',body:{details}});
 expect(JSON.stringify({...localStorage,...sessionStorage})).not.toContain(details);
});
test.each([{actorId:other},{role:'supplier'},{sourceId:other},{offerId:other},{kind:'sourcing'},{dispute:{_id:'bad',status:'pending'}},{dispute:{_id:disputeId,status:'bad'}}])('foreign or malformed status fails closed: %p',async extra=>{
 apiRequest.mockImplementation(async p=>p===path?receipt(null,extra):list());
 view();await open();await screen.findByRole('alert');
 expect(screen.queryByLabelText('تفاصيل الاعتراض')).not.toBeInTheDocument();
 expect(screen.queryByText(disputeId)).not.toBeInTheDocument();
});
test('uncertain write locks exact payload, rechecks status, then retries without duplication',async()=>{
 let count=0;
 apiRequest.mockImplementation(async(p,o)=>p!==path?list():o.method==='POST'?++count===1?Promise.reject(Error('offline')):receipt({_id:disputeId,status:'pending'},{replayed:true}):receipt());
 view();await open();fireEvent.change(await screen.findByLabelText('تفاصيل الاعتراض'),{target:{value:details}});submit();
 await screen.findByText(/نتيجة الإرسال غير مؤكدة/);
 expect(screen.getByLabelText('تفاصيل الاعتراض')).toBeDisabled();
 await open();await screen.findByText(/نتيجة الإرسال غير مؤكدة/);
 fireEvent.click(screen.getByRole('button',{name:'إعادة إرسال النص نفسه'}));await screen.findByText(disputeId);
 const writes=apiRequest.mock.calls.filter(([p,o])=>p===path&&o.method==='POST');
 expect(writes.map(([,o])=>o.body)).toEqual([{details},{details}]);
});
test('saved receipt with failed audit can recover from exact text even after both confirmations',async()=>{
 apiRequest.mockImplementation(async(p,o)=>p!==path?list({...row,completed:true,supplierConfirmed:true}):o.method==='POST'?receipt({_id:disputeId,status:'resolved'},{replayed:true}):Promise.reject(Object.assign(Error('audit unavailable'),{status:503})));
 view();await open();await screen.findByText(/تعذر تأكيد حفظ الاعتراض/);
 fireEvent.change(screen.getByLabelText('تفاصيل الاعتراض'),{target:{value:details}});
 fireEvent.click(screen.getByRole('button',{name:'إعادة إرسال النص نفسه'}));await screen.findByText('تمت مراجعة الاعتراض');
});
test('completed agreement with no prior dispute has no new submission; unconfirmed party has no dispute control',async()=>{
 apiRequest.mockImplementation(async p=>p===path?receipt():list({...row,completed:true,supplierConfirmed:true}));
 const v=view();await open();await screen.findByText('لا يوجد اعتراض مسجل.');
 expect(screen.queryByLabelText('تفاصيل الاعتراض')).not.toBeInTheDocument();
 v.unmount();apiRequest.mockImplementation(async()=>list({...row,ownConfirmed:false,buyerConfirmed:false}));
 view();await screen.findByText(row.title);expect(screen.queryByRole('button',{name:'التحقق من الاعتراض'})).not.toBeInTheDocument();
});
test('account switch discards old pending result and private draft',async()=>{
 let resolveWrite;
 apiRequest.mockImplementation(async(p,o)=>p!==path?list():o.method==='POST'?new Promise(resolve=>{resolveWrite=resolve}):receipt());
 const v=view();await open();fireEvent.change(await screen.findByLabelText('تفاصيل الاعتراض'),{target:{value:details}});submit();
 await waitFor(()=>expect(resolveWrite).toBeDefined());
 act(()=>setSession('synthetic-b'));apiRequest.mockImplementation(async()=>list({...row,ownConfirmed:false},other,'buyer'));
 v.rerender(<LanguageProvider><TradeCompletionPanel user={{_id:other,role:'buyer'}}/></LanguageProvider>);
 await screen.findByText(row.title);
 await act(async()=>resolveWrite(receipt({_id:disputeId,status:'pending'},{replayed:false})));
 expect(screen.queryByText(disputeId)).not.toBeInTheDocument();expect(screen.queryByDisplayValue(details)).not.toBeInTheDocument();
});
test.each([['fr','Vérifier la réclamation','Détails de la réclamation'],['en','Check dispute','Dispute details']])('dispute form is translated in %s',async(lang,button,label)=>{
 localStorage.setItem('jomla_lang',lang);view();fireEvent.click(await screen.findByRole('button',{name:button}));
 expect(await screen.findByLabelText(label)).toBeInTheDocument();
});

test('saved dispute identity cannot silently change after a failed recheck',async()=>{
 let check=0;
 apiRequest.mockImplementation(async p=>p!==path?list():++check===1?receipt({_id:disputeId,status:'pending'}):check===2?Promise.reject(Error('offline')):receipt({_id:other,status:'resolved'}));
 view();await open();await screen.findByText(disputeId);
 await open();await screen.findByRole('alert');
 await open();await screen.findByRole('alert');
 expect(screen.queryByText(other)).not.toBeInTheDocument();
 expect(screen.queryByText('تمت مراجعة الاعتراض')).not.toBeInTheDocument();
});
test('supplier sourcing dispute uses the authenticated role and exact offer path',async()=>{
 const r={...row,kind:'sourcing',buyerConfirmed:false,supplierConfirmed:true};
 const endpoint='/trade-confirmations/sourcing/'+sourceId+'/'+offerId+'/dispute';
 apiRequest.mockImplementation(async(p,o)=>{
   if(p===endpoint)return {...receipt(o.method==='POST'?{_id:disputeId,status:'pending'}:null,{replayed:false}),actorId:other,role:'supplier',kind:'sourcing'};
   return {...list(r,other,'supplier'),kind:p.includes('kind=sourcing')?'sourcing':'rfq',data:p.includes('kind=sourcing')?[r]:[]};
 });
 view({_id:other,role:'supplier'});fireEvent.click(screen.getByRole('button',{name:'طلبات التوريد'}));await open();
 fireEvent.change(await screen.findByLabelText('تفاصيل الاعتراض'),{target:{value:details}});submit();await screen.findByText(disputeId);
 expect(apiRequest.mock.calls.find(([p,o])=>p===endpoint&&o.method==='POST')[1].body).toEqual({details});
});
