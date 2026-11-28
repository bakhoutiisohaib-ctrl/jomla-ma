import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegisterPage from './RegisterPage';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import BuyerContactGate from './BuyerContactGate';
import { setSession } from '../../api/session';
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });
test('minimal buyer registration checks confirmation and offers browsing without contact details', async () => {
  const done = jest.fn();
  render(<LanguageProvider><RegisterPage onRegister={done} onBack={jest.fn()} /></LanguageProvider>);
  expect(screen.queryByLabelText('الاسم')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('الهاتف')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'minimal@example.test' } });
  fireEvent.change(screen.getByLabelText('كلمة المرور (8 أحرف على الأقل)'), { target: { value: 'Synthetic-Only123!' } });
  fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور'), { target: { value: 'Different123!' } });
  fireEvent.submit(screen.getByRole('button', { name: 'إنشاء الحساب' }).closest('form'));
  expect(apiRequest).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('غير متطابقتين');
  apiRequest.mockResolvedValue({ token: 'synthetic', supplier: { id: 'test-buyer', role: 'buyer', profilePending: true } });
  fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور'), { target: { value: 'Synthetic-Only123!' } });
  fireEvent.submit(screen.getByRole('button', { name: 'إنشاء الحساب' }).closest('form'));
  await screen.findByRole('button', { name: /استمر للتصفح/ });
  expect(done).not.toHaveBeenCalled();
  expect(apiRequest.mock.calls[0][1].body).not.toHaveProperty('name');
  fireEvent.click(screen.getByRole('button', { name: /استمر للتصفح/ }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(expect.objectContaining({ profilePending: true }), { browse: true }));
});
test('first-quote contact gate keeps the request blocked on save failure and releases after persisted completion', async () => {
  setSession('synthetic-contact-session');
  const user = { id: 'contact-buyer', role: 'buyer', name: 'مشتري جديد', profilePending: true };
  apiRequest.mockResolvedValueOnce(user).mockRejectedValueOnce(new Error('Synthetic save failure')).mockResolvedValueOnce({ supplier: { ...user, name: 'Test buyer', city: 'Rabat', phone: '+212600000001', profilePending: false } });
  render(<LanguageProvider><BuyerContactGate user={user} token="synthetic-contact-session" onClose={jest.fn()}>{() => <p>Quote form ready</p>}</BuyerContactGate></LanguageProvider>);
  await screen.findByLabelText('الاسم'); expect(screen.queryByText('Quote form ready')).not.toBeInTheDocument();
  for (const [label, value] of [['الاسم', 'Test buyer'], ['المدينة', 'Rabat'], ['هاتف التواصل', '+212600000001']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.submit(screen.getByLabelText('الاسم').closest('form'));
  await screen.findByText('Synthetic save failure'); expect(screen.queryByText('Quote form ready')).not.toBeInTheDocument();
  fireEvent.submit(screen.getByLabelText('الاسم').closest('form'));
  await screen.findByText('Quote form ready');
  expect(apiRequest.mock.calls[2][1].body).toEqual({ name: 'Test buyer', city: 'Rabat', phone: '+212600000001' });
});

function fillRegistration() {
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'minimal@example.test' } });
  for (const name of ['كلمة المرور (8 أحرف على الأقل)', 'تأكيد كلمة المرور']) {
    fireEvent.change(screen.getByLabelText(name), { target: { value: 'Synthetic-Only123!' } });
  }
  return screen.getByRole('button', { name: 'إنشاء الحساب' }).closest('form');
}

test('registration is single-flight and a response after leaving does not replace the current session', async () => {
  let finish;
  const done = jest.fn();
  apiRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<LanguageProvider><RegisterPage onRegister={done} onBack={jest.fn()} /></LanguageProvider>);
  const form = fillRegistration();
  fireEvent.submit(form); fireEvent.submit(form);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const signal = apiRequest.mock.calls[0][1].signal;
  view.unmount();
  setSession('replacement-session');
  await act(async () => finish({ token:'old-registration', supplier:{id:'old',role:'buyer',profilePending:true} }));
  expect(signal.aborted).toBe(true);
  expect(localStorage.getItem('supplierToken')).toBe('replacement-session');
  expect(done).not.toHaveBeenCalled();
});

test('registration confirmation cannot open a previous account after the session changes', async () => {
  apiRequest.mockResolvedValueOnce({token:'created-session',supplier:{id:'created',role:'buyer',profilePending:true}});
  const done=jest.fn();
  render(<LanguageProvider><RegisterPage onRegister={done} onBack={jest.fn()} /></LanguageProvider>);
  fireEvent.submit(fillRegistration());
  await screen.findByRole('button',{name:/استمر للتصفح/});
  act(()=>setSession('replacement-session'));
  expect(await screen.findByRole('heading',{name:'تغيرت الجلسة'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/استمر للتصفح/})).not.toBeInTheDocument();
  expect(done).not.toHaveBeenCalled();
});

const pendingBuyer={id:'contact-buyer',role:'buyer',name:'New buyer',profilePending:true};
test('contact lookup failure is retryable and a different profile never unlocks the request', async () => {
  setSession('contact-session');
  apiRequest.mockRejectedValueOnce(new Error('Synthetic lookup failure'))
    .mockResolvedValueOnce({...pendingBuyer,id:'different',profilePending:false})
    .mockResolvedValueOnce(pendingBuyer);
  render(<LanguageProvider><BuyerContactGate user={pendingBuyer} token="contact-session" onClose={jest.fn()}>{()=> <p>Quote form ready</p>}</BuyerContactGate></LanguageProvider>);
  await screen.findByText('Synthetic lookup failure');
  fireEvent.click(screen.getByRole('button',{name:'إعادة تحميل الحساب'}));
  await screen.findByText('تعذر التحقق من الحساب الحالي.');
  expect(screen.queryByText('Quote form ready')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'إعادة تحميل الحساب'}));
  await screen.findByLabelText('الاسم');
  expect(screen.queryByText('Quote form ready')).not.toBeInTheDocument();
});

test('contact submission stays blocked for incomplete server result and ignores a late save after closing', async () => {
  setSession('contact-session');
  let finish;
  apiRequest.mockResolvedValueOnce(pendingBuyer)
    .mockResolvedValueOnce({supplier:pendingBuyer})
    .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const content=jest.fn(()=> <p>Quote form ready</p>);
  const view=render(<LanguageProvider><BuyerContactGate user={pendingBuyer} token="contact-session" onClose={jest.fn()}>{content}</BuyerContactGate></LanguageProvider>);
  await screen.findByLabelText('الاسم');
  for(const [label,value] of [['الاسم','Test buyer'],['المدينة','Rabat'],['هاتف التواصل','+212600000001']]) fireEvent.change(screen.getByLabelText(label),{target:{value}});
  const form=screen.getByLabelText('الاسم').closest('form');
  fireEvent.submit(form);
  await screen.findByText('لم يكتمل حفظ معلومات التواصل. تحقق منها وأعد المحاولة.');
  expect(content).not.toHaveBeenCalled();
  fireEvent.submit(form);fireEvent.submit(form);
  expect(apiRequest).toHaveBeenCalledTimes(3);
  const signal=apiRequest.mock.calls[2][1].signal;
  view.unmount();
  await act(async()=>finish({supplier:{...pendingBuyer,profilePending:false}}));
  expect(signal.aborted).toBe(true);
  expect(content).not.toHaveBeenCalled();
});
