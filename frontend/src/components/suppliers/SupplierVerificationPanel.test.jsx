import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import SupplierVerificationPanel from './SupplierVerificationPanel';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {apiRequest} from '../../api/config';
import {setSession} from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
const owner='1'.repeat(24), initial={_id:owner,role:'supplier',verificationRevision:0,verificationSync:'idle',verificationStatus:'unverified',isVerified:false,iceNumber:'',tradeRegistry:'',verificationDoc:''};
const pending={...initial,verificationRevision:1,verificationStatus:'pending',iceNumber:'001234567890001'};
beforeEach(()=>{localStorage.clear();setSession('verification-synthetic-token');apiRequest.mockReset()});
test('optional verification requires a confirmed profile and freezes a pending dossier',async()=>{
  apiRequest.mockImplementation(async(p,o)=>o.method==='POST'?{supplier:pending}:initial);
  render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('ICE'),{target:{value:pending.iceNumber}});
  fireEvent.click(screen.getByRole('button',{name:'إرسال للمراجعة'}));
  await screen.findByText('أرسل ملفك للمراجعة');
  expect(screen.getByLabelText('ICE')).toBeDisabled();
  expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')[0][1].body).toEqual({iceNumber:pending.iceNumber,tradeRegistry:'',verificationDoc:'',verificationRevision:0});
});
test('wrong owner acknowledgement locks writes until a confirmed private refresh',async()=>{
  let read=0;apiRequest.mockImplementation(async(p,o)=>o.method==='POST'?{supplier:{...pending,_id:'2'.repeat(24)}}:++read===1?initial:pending);
  render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
  await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('ICE'),{target:{value:pending.iceNumber}});
  fireEvent.click(screen.getByRole('button',{name:'إرسال للمراجعة'}));
  await screen.findByRole('alert');expect(screen.getByLabelText('ICE')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
  await screen.findByText('الملف قيد المراجعة؛ لا يمكن تعديله قبل القرار.');
  expect(screen.queryByText('أرسل ملفك للمراجعة')).not.toBeInTheDocument();
  expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
});

test('a saved status with incomplete recovery stays locked after private refresh',async()=>{
 const verified={...pending,verificationStatus:'verified',isVerified:true,verificationSync:'pending'};
 apiRequest.mockResolvedValueOnce(verified).mockResolvedValueOnce({...verified,verificationSync:'paused'}).mockResolvedValueOnce({...verified,verificationSync:'idle'});
 render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
 await screen.findByText(/لم يكتمل سجل عملية التوثيق/);
 expect(screen.getByLabelText('ICE')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await screen.findByText(/توقف الاستكمال التلقائي/);expect(screen.getByLabelText('ICE')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 expect(apiRequest.mock.calls.every(([,o])=>o.method!=='POST')).toBe(true);
});
test('missing synchronization contract fails closed',async()=>{
 apiRequest.mockResolvedValue({...initial,verificationSync:undefined});
 render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
 await screen.findByRole('alert');expect(screen.getByLabelText('ICE')).toBeDisabled();
});

test('failed refresh of an editable dossier blocks new writes until a valid fresh read',async()=>{
 apiRequest.mockResolvedValueOnce(initial).mockRejectedValueOnce(Error('Synthetic refresh outage')).mockResolvedValueOnce(initial);
 render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 fireEvent.change(screen.getByLabelText('ICE'),{target:{value:pending.iceNumber}});
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await screen.findByText('Synthetic refresh outage');
 expect(screen.getByLabelText('ICE')).toBeDisabled();
 expect(screen.getByLabelText('ICE')).toHaveValue(pending.iceNumber);
 fireEvent.submit(screen.getByLabelText('ICE').closest('form'));
 expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 expect(screen.getByLabelText('ICE')).toHaveValue('');
});
test('malformed refreshed contract cannot reopen the previously editable dossier',async()=>{
 apiRequest.mockResolvedValueOnce(initial).mockResolvedValueOnce({...initial,verificationSync:undefined}).mockResolvedValueOnce(pending);
 render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await screen.findByRole('alert');
 expect(screen.getByLabelText('ICE')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await screen.findByText('الملف قيد المراجعة؛ لا يمكن تعديله قبل القرار.');
 expect(screen.getByLabelText('ICE')).toBeDisabled();
 expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
});
test('a regressive profile revision cannot replace the latest confirmed dossier',async()=>{
 const current={...pending,verificationRevision:2,verificationStatus:'verified',isVerified:true};
 apiRequest.mockResolvedValueOnce(current).mockResolvedValueOnce(initial).mockResolvedValueOnce(current);
 render(<LanguageProvider><SupplierVerificationPanel owner={owner}/></LanguageProvider>);
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await screen.findByRole('alert');
 expect(screen.getByLabelText('ICE')).toHaveValue(current.iceNumber);
 expect(screen.getByLabelText('ICE')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'تحديث حالة التوثيق'}));
 await waitFor(()=>expect(screen.getByLabelText('ICE')).toBeEnabled());
 expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(0);
});
