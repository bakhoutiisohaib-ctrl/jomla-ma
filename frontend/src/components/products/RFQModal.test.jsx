import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import RFQModal from './RFQModal'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { apiRequest } from '../../api/config'
import { setSession } from '../../api/session'
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }))
const product = { _id: 'product-1', name: 'أحذية بالجملة', moq: 10, currency: 'MAD', unit: 'زوج' }
beforeEach(() => { localStorage.clear(); apiRequest.mockReset() })
test('requires login before exposing a submission form', () => {
  const login = jest.fn()
  render(<LanguageProvider><RFQModal product={product} onClose={jest.fn()} onRequireLogin={login} /></LanguageProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'دخول المشتري' }))
  expect(login).toHaveBeenCalledTimes(1)
  expect(apiRequest).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('هاتف التواصل')).not.toBeInTheDocument()
})
test('keeps entered fields after a failed submission and never announces success', async () => {
  localStorage.setItem('supplierToken', 'token')
  apiRequest.mockRejectedValue(new Error('الكمية غير متاحة'))
  const success = jest.fn()
  render(<LanguageProvider><RFQModal product={product} onClose={jest.fn()} onSuccess={success} /></LanguageProvider>)
  const phone = screen.getByLabelText('هاتف التواصل')
  fireEvent.change(phone, { target: { value: '+212612345678' } })
  fireEvent.change(screen.getByLabelText('المواصفات والملاحظات'), { target: { value: 'قياسات متعددة' } })
  fireEvent.submit(screen.getByRole('button', { name: 'إرسال طلب عرض السعر' }).closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('الكمية غير متاحة')
  expect(phone).toHaveValue('+212612345678')
  expect(screen.getByLabelText('المواصفات والملاحظات')).toHaveValue('قياسات متعددة')
  expect(success).not.toHaveBeenCalled()
})

const submitForm = () => fireEvent.submit(screen.getByRole('button', { name: 'إرسال طلب عرض السعر' }).closest('form'))
function show(props = {}) {
  localStorage.setItem('supplierToken', 'synthetic-token-a')
  const success = jest.fn(), close = jest.fn()
  render(<LanguageProvider><RFQModal product={product} onClose={close} onSuccess={success} {...props}/></LanguageProvider>)
  fireEvent.change(screen.getByLabelText('هاتف التواصل'), { target: { value: '+212600000001' } })
  return { success, close }
}
test('lost acknowledgement keeps one secure key and the exact original body for explicit recovery', async () => {
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('network lost'), { status: 0 })).mockResolvedValue({ rfq: { _id: 'r2-original', status: 'pending' }, threadId: 'thread' })
  const { success, close } = show()
  fireEvent.change(screen.getByLabelText('المواصفات والملاحظات'), { target: { value: 'PRIVATE ORIGINAL REQUEST' } })
  submitForm(); await screen.findByRole('button', { name: 'استكمال إرسال الطلب' })
  const first = apiRequest.mock.calls[0][1]
  expect(first.headers['Idempotency-Key']).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  expect(success).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(screen.getByLabelText('هاتف التواصل')).toBeDisabled()
  fireEvent.change(screen.getByLabelText('المواصفات والملاحظات'), { target: { value: 'LATE EDIT' } })
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال الطلب' }))
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
  expect(apiRequest.mock.calls[1][1]).toMatchObject({ headers: first.headers, body: first.body, token: 'synthetic-token-a' })
  expect(apiRequest.mock.calls[1][1].body.notes).toBe('PRIVATE ORIGINAL REQUEST')
  expect(localStorage.getItem('PRIVATE ORIGINAL REQUEST')).toBeNull()
})
test('202 never announces success, keeps the original attempt, and closes safely when an RFQ id is known', async () => {
  apiRequest.mockResolvedValueOnce({ processing: true, rfq: { _id: 'partial-rfq', status: 'creating' } }).mockResolvedValue({ processing: false, rfq: { _id: 'partial-rfq', status: 'pending' } })
  const { success, close } = show(); submitForm()
  expect(await screen.findByRole('status')).toHaveTextContent('لم يكتمل الإرسال بعد')
  expect(success).not.toHaveBeenCalled()
  expect(screen.getByText('partial-rfq')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'إغلاق' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال الطلب' }))
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1)); expect(close).not.toHaveBeenCalled()
  expect(apiRequest.mock.calls[1][1].headers).toEqual(apiRequest.mock.calls[0][1].headers)
})
test('double submit and repeated recovery clicks issue one request at a time', async () => {
  let complete
  apiRequest.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const { success } = show(); submitForm()
  fireEvent.submit(screen.getByRole('button', { name: 'جاري الإرسال…' }).closest('form'))
  expect(apiRequest).toHaveBeenCalledTimes(1)
  await act(async () => complete({ processing: true, rfq: { _id: 'partial', status: 'creating' } }))
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال الطلب' }))
  fireEvent.click(screen.getByRole('button', { name: 'جارٍ الاستكمال…' }))
  expect(apiRequest).toHaveBeenCalledTimes(2)
  await act(async () => complete({ rfq: { _id: 'partial', status: 'pending' } })); expect(success).toHaveBeenCalledTimes(1)
})
test('an unknown result blocks Escape and close until the original attempt is reconciled', async () => {
  apiRequest.mockRejectedValue(new Error('lost'))
  const { close } = show(); submitForm(); await screen.findByRole('button', { name: 'استكمال إرسال الطلب' })
  fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeInTheDocument()
})
test('switching accounts aborts a late response and clears the previous request data', async () => {
  let complete; apiRequest.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const { success } = show(); fireEvent.change(screen.getByLabelText('المواصفات والملاحظات'), { target: { value: 'PRIVATE ACCOUNT A' } }); submitForm()
  const signal = apiRequest.mock.calls[0][1].signal
  act(() => setSession('synthetic-token-b'))
  await act(async () => complete({ processing: true, rfq: { _id: 'private-a', status: 'creating' } }))
  expect(signal.aborted).toBe(true); expect(success).not.toHaveBeenCalled()
  expect(screen.getByLabelText('المواصفات والملاحظات')).toHaveValue('')
  expect(screen.getByLabelText('هاتف التواصل')).toHaveValue('')
  expect(screen.queryByText('private-a')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'استكمال إرسال الطلب' })).not.toBeInTheDocument()
})
test('a stale profile cannot prefill the replacement account while it is loading', () => {
  show({ user: { _id: 'a', phone: '+212611111111', city: 'PRIVATE CITY A' } })
  act(() => setSession('synthetic-token-b'))
  expect(screen.getByLabelText('هاتف التواصل')).toHaveValue(''); expect(screen.getByLabelText('مدينة التوصيل')).toHaveValue('')
})
test('validation rejection allows a corrected new attempt while409 preserves the unresolved key', async () => {
  apiRequest.mockRejectedValueOnce(Object.assign(new Error('invalid'), { status: 400 })).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 })).mockResolvedValue({ rfq: { _id: 'original' } })
  const { success } = show(); submitForm(); await screen.findByRole('alert')
  const keyA = apiRequest.mock.calls[0][1].headers['Idempotency-Key']
  fireEvent.change(screen.getByLabelText('الكمية المطلوبة'), { target: { value: 30 } }); submitForm()
  await screen.findByRole('button', { name: 'استكمال إرسال الطلب' })
  const keyB = apiRequest.mock.calls[1][1].headers['Idempotency-Key']; expect(keyB).not.toBe(keyA)
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال الطلب' })); await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
  expect(apiRequest.mock.calls[2][1].headers['Idempotency-Key']).toBe(keyB)
})
test('French recovery preserves the202 distinction and never automatically posts on mount', async () => {
  localStorage.setItem('jomla_lang', 'fr'); localStorage.setItem('supplierToken', 'synthetic')
  apiRequest.mockResolvedValue({ processing: true, rfq: { _id: 'partial', status: 'creating' } })
  render(<LanguageProvider><RFQModal product={product} onClose={jest.fn()} /></LanguageProvider>)
  expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.submit(screen.getByRole('button', { name: 'Envoyer la demande' }).closest('form'))
  expect(await screen.findByRole('status')).toHaveTextContent('L’envoi n’est pas terminé')
  expect(screen.getByRole('button', { name: 'Reprendre l’envoi de la demande' })).toBeInTheDocument()
})
test('without secure randomness no unkeyed request is sent', async () => {
  const secure = window.crypto; Object.defineProperty(window, 'crypto', { configurable: true, value: undefined })
  try { show(); submitForm(); expect(await screen.findByRole('alert')).toHaveTextContent('معرف آمن'); expect(apiRequest).not.toHaveBeenCalled() }
  finally { Object.defineProperty(window, 'crypto', { configurable: true, value: secure }) }
})
