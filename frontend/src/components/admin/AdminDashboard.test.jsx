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
