import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import VerificationRecovery from './VerificationRecovery';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {apiRequest} from '../../api/config';
import {setSession} from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
const id='1'.repeat(24),op='2'.repeat(24);
const reserved={supplierId:id,verificationRevision:0,verificationStatus:'unverified',isVerified:false,operation:{id:op,kind:'submit',phase:'reserved',baseRevision:0,attempts:10,canResume:true}};
const completed={...reserved,verificationRevision:1,verificationStatus:'pending',operation:{...reserved.operation,phase:'completed',canResume:false}};
const show=(props={})=>render(<LanguageProvider><VerificationRecovery supplierId={id} role="supplier" revision={0} status="unverified" {...props}/></LanguageProvider>);
const check=()=>fireEvent.click(screen.getByRole('button',{name:'التحقق من العملية المحفوظة'}));
const resume=()=>fireEvent.click(screen.getByRole('button',{name:'استكمال العملية نفسها'}));
beforeEach(()=>{localStorage.clear();setSession('synthetic-session');apiRequest.mockReset()});
test('malformed or foreign receipt refuses recovery',async()=>{
 apiRequest.mockResolvedValue({...reserved,supplierId:'9'.repeat(24)});show();check();
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
 expect(apiRequest.mock.calls).toHaveLength(1);
});
test('owner cannot resume an administrative decision',async()=>{
 apiRequest.mockResolvedValue({...reserved,verificationRevision:1,verificationStatus:'pending',operation:{...reserved.operation,kind:'approve',baseRevision:1,canResume:false}});
 show({revision:1,status:'pending'});check();await screen.findByText(/هذه العملية محفوظة لدى الإدارة/);
 expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
});
test('superseded response is not success and another attempt requires a fresh check',async()=>{
 const settled=jest.fn();apiRequest.mockResolvedValueOnce(reserved).mockResolvedValueOnce({...completed,operation:{...completed.operation,id:'9'.repeat(24)}});
 show({onSettled:settled});check();await screen.findByRole('button',{name:'استكمال العملية نفسها'});resume();await screen.findByRole('alert');
 expect(settled).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
});
test('failed terminal receipt is reported as failed, not completed',async()=>{
 const settled=jest.fn();apiRequest.mockResolvedValueOnce(reserved).mockResolvedValueOnce({...reserved,operation:{...reserved.operation,phase:'failed',canResume:false}});
 show({onSettled:settled});check();await screen.findByRole('button',{name:'استكمال العملية نفسها'});resume();
 await waitFor(()=>expect(settled).toHaveBeenCalledWith('failed'));
});
test('late response after session replacement cannot confirm recovery',async()=>{
 const settled=jest.fn();let resolve;
 apiRequest.mockResolvedValueOnce(reserved).mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 show({onSettled:settled});check();await screen.findByRole('button',{name:'استكمال العملية نفسها'});resume();
 await act(async()=>{setSession('replacement-session');resolve(completed)});
 expect(settled).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
});
test('status moved since list read requires refresh, not a new POST',async()=>{
 apiRequest.mockResolvedValue(completed);show();check();await screen.findByText(/تغيرت الحالة المحفوظة/);
 expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
 expect(apiRequest.mock.calls).toHaveLength(1);
});

test('a real service unavailable response never invites entering a new dossier and requires a new check',async()=>{
 const settled=jest.fn();
 apiRequest.mockResolvedValueOnce(reserved).mockRejectedValueOnce(Object.assign(Error('الخدمة غير متاحة حالياً. يمكنك إدخال المعلومات يدوياً.'),{status:503})).mockResolvedValueOnce(reserved);
 show({onSettled:settled});check();await screen.findByRole('button',{name:'استكمال العملية نفسها'});resume();
 expect(await screen.findByRole('alert')).toHaveTextContent(/لم يتأكد استكمال التوثيق/);
 expect(screen.queryByText(/يمكنك إدخال المعلومات يدوياً/)).toBeNull();
 expect(screen.queryByRole('button',{name:'استكمال العملية نفسها'})).toBeNull();
 expect(settled).not.toHaveBeenCalled();
 check();await screen.findByRole('button',{name:'استكمال العملية نفسها'});
 expect(apiRequest.mock.calls.filter(([,o])=>o.method==='POST')).toHaveLength(1);
});
