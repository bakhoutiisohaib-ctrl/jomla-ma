import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminDashboard from './AdminDashboard'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
import {setSession} from '../../api/session'
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }))
test('successful administrator login clears the password even before parent navigation', async () => {
  localStorage.clear()
  apiRequest.mockResolvedValue({ token: 'synthetic-token', admin: { id: 'synthetic-admin', role: 'admin' } })
  const onLogin = jest.fn()
  render(<LanguageProvider><AdminDashboard onLogin={onLogin} /></LanguageProvider>)
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'admin@example.test' } })
  const password = screen.getByLabelText('كلمة المرور')
  fireEvent.change(password, { target: { value: 'Synthetic-Only123!' } })
  fireEvent.submit(password.closest('form'))
  await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1))
  expect(password).toHaveValue('')
})

test('supplier review buttons remain disabled while verification completion is pending or paused', async()=>{
 localStorage.clear();
 const item={_id:'synthetic-supplier',name:'Synthetic supplier',verificationStatus:'pending',verificationRevision:1,verificationSync:'pending'};
 let phase='pending';
 apiRequest.mockImplementation(async p=>p==='/admin/stats'?{}:{data:[{...item,verificationSync:phase}],pagination:{pages:1}});
 render(<LanguageProvider><AdminDashboard user={{role:'admin'}}/></LanguageProvider>);
 await screen.findByText('Synthetic supplier');
 expect(screen.getByRole('button',{name:'اعتماد التوثيق'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'رفض التوثيق'})).toBeDisabled();
 phase='paused';fireEvent.click(screen.getByRole('button',{name:'تحديث'}));
 await screen.findByText(/توقف الاستكمال التلقائي/);
 expect(screen.getByRole('button',{name:'اعتماد التوثيق'})).toBeDisabled();
 phase='idle';fireEvent.click(screen.getByRole('button',{name:'تحديث'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'اعتماد التوثيق'})).toBeEnabled());
 expect(apiRequest.mock.calls.every(([,o])=>o?.method!=='PUT')).toBe(true);
})

test('administrator resumes a saved decision without submitting a new decision',async()=>{
 localStorage.clear();setSession('synthetic-admin-session');apiRequest.mockReset();
 const id='4'.repeat(24),op='5'.repeat(24),item={_id:id,name:'Synthetic recovery supplier',verificationStatus:'verified',verificationRevision:1,verificationSync:'paused'};
 let phase='paused';
 const state={supplierId:id,verificationRevision:1,verificationStatus:'verified',isVerified:true,operation:{id:op,kind:'approve',phase:'applied',baseRevision:1,attempts:10,canResume:true}};
 apiRequest.mockImplementation(async(p,o)=>p==='/admin/stats'?{}:p.endsWith('/verification-state')?state:p.endsWith('/verification-recover')?(phase='idle',{...state,operation:{...state.operation,phase:'completed',canResume:false}}):{data:[{...item,verificationSync:phase}],pagination:{pages:1}});
 render(<LanguageProvider><AdminDashboard user={{role:'admin'}}/></LanguageProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'التحقق من العملية المحفوظة'}));
 fireEvent.click(await screen.findByRole('button',{name:'استكمال العملية نفسها'}));
 await screen.findByText('تم استكمال العملية المحفوظة دون قرار جديد.');
 await screen.findByText('Synthetic recovery supplier');
 expect(apiRequest.mock.calls.filter(([,o])=>o?.method).map(([p,o])=>[p,o.method,o.body])).toEqual([['/admin/suppliers/'+id+'/verification-recover','POST',{operationId:op}]]);
});
