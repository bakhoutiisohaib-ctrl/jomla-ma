import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminDashboard from './AdminDashboard'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
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
