import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import RecoveryPage from './components/auth/RecoveryPage';
import { LanguageProvider } from './i18n/LanguageContext';
import { apiRequest, clearSession } from './api/config';
jest.mock('./api/config', () => ({ apiRequest: jest.fn(), clearSession: jest.fn() }));
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/forgot-password'); jest.clearAllMocks(); });
afterEach(cleanup);
function show(props = {}) { return render(<LanguageProvider><RecoveryPage onBack={jest.fn()} onLogin={jest.fn()} onRequest={jest.fn()} {...props} /></LanguageProvider>); }
test.each([['ar','استرجاع حسابك'],['fr','Récupérer votre compte'],['en','Recover your account']])('request form is localized in %s and does not claim an account exists', async (lang, heading) => {
  localStorage.setItem('jomla_lang', lang); apiRequest.mockResolvedValue({}); show();
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'trial@example.test' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form'));
  expect(await screen.findByRole('status')).toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith('/account-recovery/request', expect.objectContaining({ token: '', body: { email: 'trial@example.test', language: lang } }));
});
test('reset removes token fragment, prevents mismatched confirmation, sends no old session and clears session after success', async () => {
  localStorage.setItem('jomla_lang','en'); const token = 'a'.repeat(64);
  window.history.replaceState({}, '', '/reset-password#token=' + token); apiRequest.mockResolvedValue({}); show({ reset: true });
  expect(window.location.hash).toBe('');
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'New-Test-Password!' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Mismatch-Test!' } });
  fireEvent.click(screen.getByRole('button', { name:'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('do not match'); expect(apiRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'New-Test-Password!' } });
  fireEvent.click(screen.getByRole('button', { name:'Save password' }));
  await waitFor(() => expect(clearSession).toHaveBeenCalled());
  expect(apiRequest).toHaveBeenCalledWith('/account-recovery/reset', expect.objectContaining({ token: '', body: { token, password: 'New-Test-Password!', language: 'en' } }));
  expect(screen.getByRole('status')).toHaveTextContent('previous sessions were revoked');
});
test('expired link and unavailable delivery are actionable without exposing server internals', async () => {
  localStorage.setItem('jomla_lang','en'); show({ reset:true });
  expect(screen.getByRole('alert')).toHaveTextContent('invalid or expired');
  expect(screen.queryByRole('button',{name:'Save password'})).not.toBeInTheDocument();
  cleanup(); apiRequest.mockRejectedValue({data:{code:'RECOVERY_UNAVAILABLE'}}); show();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'trial@example.test'}});
  fireEvent.submit(screen.getByRole('textbox').closest('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('currently unavailable');
});
