import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import OrganizationPanel from './OrganizationPanel';
import StoresPanel from './StoresPanel';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {apiRequest} from '../../api/config';
import {setSession} from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn(),assetUrl:()=>''}));
const owner={_id:'owner',role:'supplier',name:'Owner',city:'Rabat',businessTypes:[]};
const organization={_id:'company',ownerSupplierId:owner._id,name:'Synthetic company',city:'Rabat',country:'MA'};
const pending={_id:'pending',name:'Pending store',city:'Rabat',reviewStatus:'pending',isActive:false};
const approved={_id:'approved',name:'Approved store',city:'Rabat',reviewStatus:'approved',isActive:true};
const suspended={_id:'suspended',name:'Suspended store',city:'Rabat',reviewStatus:'approved',adminSuspended:true,isActive:false};
beforeEach(()=>{
 localStorage.clear();setSession('synthetic-company-session');apiRequest.mockReset();
 apiRequest.mockImplementation(async p=>p==='/suppliers/me/organization'?{organization,memberships:[]}:p==='/suppliers/me/staff-invitations'?{data:[]}:owner);
});
const company=onChanged=>render(<LanguageProvider><OrganizationPanel profile={owner} onChanged={onChanged}/></LanguageProvider>);
const stores=(onChanged,ready=true)=>render(<LanguageProvider><StoresPanel stores={[pending,approved,suspended]} ready={ready} onChanged={onChanged}/></LanguageProvider>);
test('company blocks mutation until verified load and permits retry',async()=>{
 const base=apiRequest.getMockImplementation();let reject=true;
 apiRequest.mockImplementation((p,o)=>p==='/suppliers/me/organization'&&reject?Promise.reject(Error('Synthetic company read failure')):base(p,o));
 company(jest.fn());await screen.findByText('Synthetic company read failure');
 expect(screen.getByRole('button',{name:'حفظ الشركة'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'إنشاء الدعوة'})).toBeDisabled();
 fireEvent.submit(screen.getByRole('button',{name:'حفظ الشركة'}).closest('form'));
 expect(apiRequest.mock.calls.filter(([,o])=>o?.method==='PUT')).toHaveLength(0);
 reject=false;fireEvent.click(screen.getByRole('button',{name:'إعادة تحميل الشركة'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'حفظ الشركة'})).toBeEnabled());
 expect(screen.getByLabelText('اسم الشركة')).toHaveValue('Synthetic company');
});
test('invitation is single flight and late response after leaving cannot display a token or refresh another account',async()=>{
 const changed=jest.fn();let finish;const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation((p,o)=>o?.method==='POST'?new Promise(resolve=>{finish=resolve;}):base(p,o));
 const view=company(changed);await waitFor(()=>expect(screen.getByRole('button',{name:'إنشاء الدعوة'})).toBeEnabled());
 fireEvent.change(screen.getByLabelText('بريد الموظف'),{target:{value:'staff@example.test'}});
 const form=screen.getByRole('button',{name:'إنشاء الدعوة'}).closest('form');
 fireEvent.submit(form);fireEvent.submit(form);
 const writes=apiRequest.mock.calls.filter(([,o])=>o?.method==='POST');expect(writes).toHaveLength(1);
 view.unmount();setSession('replacement');
 await act(async()=>finish({acceptanceToken:'a'.repeat(64)}));
 expect(writes[0][1].signal.aborted).toBe(true);expect(changed).not.toHaveBeenCalled();
});
test('ambiguous invitation response locks company actions until reload',async()=>{
 const base=apiRequest.getMockImplementation();
 apiRequest.mockImplementation((p,o)=>o?.method==='POST'?Promise.resolve({}):base(p,o));
 company(jest.fn());await waitFor(()=>expect(screen.getByRole('button',{name:'إنشاء الدعوة'})).toBeEnabled());
 fireEvent.submit(screen.getByRole('button',{name:'إنشاء الدعوة'}).closest('form'));
 await screen.findByText('تعذر تأكيد رمز الدعوة');
 expect(screen.getByRole('button',{name:'إنشاء الدعوة'})).toBeDisabled();
});
test('pending and suspended stores cannot be activated and unconfirmed data locks edits',()=>{
 const changed=jest.fn();const view=stores(changed);
 for(const b of screen.getAllByRole('button',{name:'تفعيل'})){expect(b).toBeDisabled();fireEvent.click(b);}
 expect(apiRequest).not.toHaveBeenCalled();
 view.unmount();stores(changed,false);
 expect(screen.getByRole('button',{name:'حفظ المتجر'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'تعطيل'})).toBeDisabled();
});
test('store save is single flight and a late success does not refresh a replacement session',async()=>{
 const changed=jest.fn();let finish;
 apiRequest.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=stores(changed);fireEvent.change(screen.getByLabelText('اسم المتجر'),{target:{value:'Synthetic new shop'}});
 const form=screen.getByRole('button',{name:'حفظ المتجر'}).closest('form');
 fireEvent.submit(form);fireEvent.submit(form);expect(apiRequest).toHaveBeenCalledTimes(1);
 const signal=apiRequest.mock.calls[0][1].signal;view.unmount();setSession('replacement');
 await act(async()=>finish({store:{_id:'new-store'}}));expect(signal.aborted).toBe(true);expect(changed).not.toHaveBeenCalled();
});
test('mismatched store response does not report success or discard edit inputs',async()=>{
 const changed=jest.fn();apiRequest.mockResolvedValueOnce({store:{_id:'different'}});
 stores(changed);
 fireEvent.click(screen.getAllByRole('button',{name:'تعديل'})[1]);
 fireEvent.change(screen.getByLabelText('اسم المتجر'),{target:{value:'Edited name'}});
 fireEvent.submit(screen.getByRole('button',{name:'حفظ المتجر'}).closest('form'));
 await screen.findByText('تعذر تأكيد حفظ المتجر');
 expect(screen.getByLabelText('اسم المتجر')).toHaveValue('Edited name');expect(changed).not.toHaveBeenCalled();
});

test('default country is not a declaration, owner explicitly opts in and may withdraw',async()=>{
 const base=apiRequest.getMockImplementation();let saved={...organization,ownerSupplierId:owner._id};
 apiRequest.mockImplementation(async(p,o)=>{
  if(p!=='/suppliers/me/organization')return base(p,o);
  if(o?.method==='PUT'){saved={...saved,...o.body,declaredCountry:o.body.declareCountry?o.body.country:undefined};return {organization:saved}}
  return {organization:saved,memberships:[]};
 });
 company(jest.fn());const checkbox=await screen.findByRole('checkbox',{name:'أصرح بأن هذا هو بلد مقر شركتي'});
 await waitFor(()=>expect(checkbox).toBeEnabled());expect(checkbox).not.toBeChecked();
 const save=()=>fireEvent.click(screen.getByRole('button',{name:'حفظ الشركة'}));
 save();await screen.findByText('تم حفظ ملف الشركة');
 expect(apiRequest.mock.calls.filter(([,o])=>o?.method==='PUT').at(-1)[1].body.declareCountry).toBe(false);
 await waitFor(()=>expect(checkbox).toBeEnabled());fireEvent.click(checkbox);save();
 await waitFor(()=>expect(saved.declaredCountry).toBe('MA'));await waitFor(()=>expect(checkbox).toBeEnabled());expect(checkbox).toBeChecked();
 fireEvent.change(screen.getByLabelText('رمز البلد'),{target:{value:'FR'}});expect(checkbox).not.toBeChecked();
 save();await waitFor(()=>expect(saved.country).toBe('FR'));await waitFor(()=>expect(checkbox).toBeEnabled());
 fireEvent.click(checkbox);save();await waitFor(()=>expect(saved.declaredCountry).toBe('FR'));await waitFor(()=>expect(checkbox).toBeEnabled());
 fireEvent.click(checkbox);save();await waitFor(()=>expect(saved.declaredCountry).toBeUndefined());
});
test('wrong owner country receipt cannot report success',async()=>{
 const base=apiRequest.getMockImplementation();const changed=jest.fn();
 apiRequest.mockImplementation(async(p,o)=>o?.method==='PUT'?{organization:{...organization,ownerSupplierId:'foreign',declaredCountry:'MA'}}:base(p,o));
 company(changed);const checkbox=await screen.findByRole('checkbox',{name:'أصرح بأن هذا هو بلد مقر شركتي'});
 await waitFor(()=>expect(checkbox).toBeEnabled());fireEvent.click(checkbox);fireEvent.click(screen.getByRole('button',{name:'حفظ الشركة'}));
 await screen.findByText('تعذر تأكيد حفظ تصريح البلد. أعد تحميل الشركة.');
 expect(changed).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'حفظ الشركة'})).toBeDisabled();
});

test('successful write receipt followed by mismatched readback does not claim declaration saved',async()=>{
 const base=apiRequest.getMockImplementation(),changed=jest.fn();
 apiRequest.mockImplementation(async(p,o)=>o?.method==='PUT'?{organization:{...organization,declaredCountry:'MA'}}:base(p,o));
 company(changed);const checkbox=await screen.findByRole('checkbox',{name:'أصرح بأن هذا هو بلد مقر شركتي'});
 await waitFor(()=>expect(checkbox).toBeEnabled());fireEvent.click(checkbox);fireEvent.click(screen.getByRole('button',{name:'حفظ الشركة'}));
 await screen.findByText('تعذر تأكيد حفظ تصريح البلد. أعد تحميل الشركة.');
 expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('تم حفظ ملف الشركة')).not.toBeInTheDocument();
});
