import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SourcingModal from './SourcingModal'
import { getAttempt } from './sourcingCreationAttempt'
import { apiRequest } from '../../api/config'
import { clearSession, setSession } from '../../api/session'
import { LanguageProvider } from '../../i18n/LanguageContext'
import BuyerDashboard from '../buyer/BuyerDashboard'
import App from '../../App'
jest.mock('../../api/config', () => ({ ...jest.requireActual('../../api/config'), apiRequest: jest.fn() }))
const buyer = { _id: 'buyer-a', role: 'buyer', phone: '+212655443322', city: 'الرباط' }
const props = () => ({ user: buyer, sessionToken: 'session-a', initialData: { productName: 'منتج اصطناعي' }, onSuccess: jest.fn(), onClose: jest.fn() })
const view = value => <LanguageProvider><SourcingModal {...value} /></LanguageProvider>
const submit = () => fireEvent.submit(screen.getByLabelText('المنتج المطلوب').closest('form'))
const rejected = (status, code) => Object.assign(new Error('synthetic error'), { status, data: { code } })
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setSession('session-a'); getAttempt('reset-test-cache')
  apiRequest.mockReset()
})
test('opening the modal never posts; creation sends a secure key only after explicit submission', async () => {
  const value = props(); apiRequest.mockResolvedValue({ sourcing: { _id: 'created-1' } })
  render(view(value)); expect(apiRequest).not.toHaveBeenCalled()
  submit()
  await waitFor(() => expect(value.onSuccess).toHaveBeenCalledTimes(1))
  const [path, options] = apiRequest.mock.calls[0]
  expect(path).toBe('/sourcing'); expect(options.method).toBe('POST')
  expect(options.headers['Idempotency-Key']).toMatch(/^[a-f0-9]{48}$/)
  expect(options.body.quantity).toBe(1); expect(options.body.buyerPhone).toBe(buyer.phone)
  expect(sessionStorage.length).toBe(0)
  expect(Object.keys(localStorage).sort()).toEqual(['jomla_lang', 'supplierToken']) // existing language/authentication only
})
test('lost acknowledgement freezes input and an explicit retry reuses the exact key and body', async () => {
  apiRequest.mockRejectedValueOnce(rejected(0)).mockResolvedValueOnce({ sourcing: { _id: 'original' } })
  const value = props(); render(view(value)); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('غير محسومة')
  expect(screen.getByLabelText('المنتج المطلوب')).toBeDisabled()
  expect(value.onSuccess).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'استكمال المحاولة نفسها' }))
  await waitFor(() => expect(value.onSuccess).toHaveBeenCalledWith({ _id: 'original' }))
  const first = apiRequest.mock.calls[0][1], second = apiRequest.mock.calls[1][1]
  expect(second.body).toEqual(first.body); expect(second.headers).toEqual(first.headers)
  expect(getAttempt(buyer._id)).toBeNull()
})
test('lookup 404 does not unlock fields, generate a key, or automatically POST', async () => {
  apiRequest.mockRejectedValueOnce(rejected(503)).mockRejectedValueOnce(rejected(404)).mockResolvedValueOnce({ sourcing: { _id: 'original' } })
  render(view(props())); submit(); await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'التحقق من نتيجة المحاولة' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('لا يعني أن الطلب لم'))
  expect(apiRequest).toHaveBeenCalledTimes(2)
  expect(apiRequest.mock.calls[1][0]).toBe('/sourcing/creation-result')
  expect(apiRequest.mock.calls[1][1].method).toBeUndefined()
  expect(screen.getByLabelText('المنتج المطلوب')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'استكمال المحاولة نفسها' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3))
  expect(apiRequest.mock.calls[2][1].headers).toEqual(apiRequest.mock.calls[0][1].headers)
  expect(apiRequest.mock.calls[2][1].body).toEqual(apiRequest.mock.calls[0][1].body)
})
test('lookup confirms the current request without another POST or reopening it', async () => {
  apiRequest.mockRejectedValueOnce(rejected(0)).mockResolvedValueOnce({ sourcing: { _id: 'closed', status: 'fulfilled' } })
  const value = props(); render(view(value)); submit(); await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'التحقق من نتيجة المحاولة' }))
  await waitFor(() => expect(value.onSuccess).toHaveBeenCalledWith({ _id: 'closed', status: 'fulfilled' }))
  expect(apiRequest.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1)
})
test('double submission while in flight sends one POST', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const value = props(); render(view(value)); submit(); submit()
  expect(apiRequest).toHaveBeenCalledTimes(1)
  await act(async () => { finish({ sourcing: { _id: 'once' } }) })
  expect(value.onSuccess).toHaveBeenCalledTimes(1)
})
test('closing and reopening the modal retains an unresolved attempt without automatically sending', async () => {
  apiRequest.mockRejectedValueOnce(rejected(0)).mockResolvedValueOnce({ sourcing: { _id: 'same' } })
  const first = render(view(props())); submit(); await screen.findByRole('alert')
  const original = apiRequest.mock.calls[0][1]; first.unmount()
  render(view({ ...props(), initialData: { productName: 'different' } }))
  expect(apiRequest).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('المنتج المطلوب')).toHaveValue('منتج اصطناعي')
  fireEvent.click(screen.getByRole('button', { name: 'استكمال المحاولة نفسها' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
  expect(apiRequest.mock.calls[1][1].headers).toEqual(original.headers)
  expect(apiRequest.mock.calls[1][1].body).toEqual(original.body)
})
test('late responses after account switch cannot invoke callbacks or display former account data', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const value = props(), rendered = render(view(value)); submit()
  act(() => setSession('session-b'))
  // The old verified account prop is not accepted for the replacement token.
  expect(screen.queryByLabelText('هاتف التواصل')).not.toBeInTheDocument()
  rendered.rerender(view({ ...value, sessionToken: 'session-b', user: { _id: 'buyer-b', role: 'buyer', phone: '+212600001111' } }))
  await act(async () => { finish({ sourcing: { _id: 'private-a' } }) })
  expect(value.onSuccess).not.toHaveBeenCalled(); expect(screen.queryByText('private-a')).not.toBeInTheDocument()
  expect(screen.getByLabelText('هاتف التواصل')).toHaveValue('+212600001111')
  expect(getAttempt('buyer-b')).toBeNull()
})
test('late responses after unmount are ignored and the request is aborted', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const value = props(), rendered = render(view(value)); submit()
  const signal = apiRequest.mock.calls[0][1].signal; rendered.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => { finish({ sourcing: { _id: 'late' } }) })
  expect(value.onSuccess).not.toHaveBeenCalled()
})
test('logout clears the account cache even while its unresolved modal is closed', async () => {
  apiRequest.mockRejectedValue(rejected(0))
  const rendered = render(view(props())); submit(); await screen.findByRole('alert')
  rendered.unmount(); expect(getAttempt(buyer._id)).not.toBeNull()
  act(() => clearSession()); expect(getAttempt(buyer._id)).toBeNull()
})
test('logout immediately removes private form data and ignores the old response', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const value = props(); render(view(value)); submit(); act(() => clearSession())
  expect(screen.queryByLabelText('هاتف التواصل')).not.toBeInTheDocument()
  await act(async () => { finish({ sourcing: { _id: 'old' } }) })
  expect(value.onSuccess).not.toHaveBeenCalled()
})
test.each(['supplier', 'staff', 'admin'])('role %s cannot view the buyer creation form', role => {
  render(view({ ...props(), user: { ...buyer, role } }))
  expect(screen.queryByLabelText('المنتج المطلوب')).not.toBeInTheDocument()
  expect(apiRequest).not.toHaveBeenCalled()
})
test('authentication does not submit a request automatically', () => {
  clearSession(); const value = props(), rendered = render(view({ ...value, user: null, sessionToken: '' }))
  act(() => setSession('session-a')); rendered.rerender(view(value))
  expect(screen.getByLabelText('المنتج المطلوب')).toBeInTheDocument()
  expect(apiRequest).not.toHaveBeenCalled()
})
test('confirmed 400 permits correction; 409 keeps the original attempt frozen', async () => {
  apiRequest.mockRejectedValueOnce(rejected(400)).mockRejectedValueOnce(rejected(409))
  render(view(props())); submit(); await screen.findByRole('alert')
  expect(screen.getByLabelText('المنتج المطلوب')).not.toBeDisabled()
  fireEvent.change(screen.getByLabelText('المنتج المطلوب'), { target: { value: 'corrected' } }); submit()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('بيانات مختلفة'))
  expect(screen.getByLabelText('المنتج المطلوب')).toBeDisabled()
})
test('French LTR recovery is explicit and preserves the frozen payload', async () => {
  localStorage.setItem('jomla_lang', 'fr'); apiRequest.mockRejectedValue(rejected(0))
  render(view(props()))
  fireEvent.submit(screen.getByLabelText('Produit recherché').closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Résultat non confirmé')
  expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByRole('button', { name: 'Reprendre la même tentative' })).toBeEnabled()
})
const workspaceApi = async (path, options) => {
  if (path === '/suppliers/me/profile') return buyer
  if (path === '/sourcing' && options?.method === 'POST') return { sourcing: { _id: 'from-buyer' } }
  return { data: [], pagination: { pages: 1, total: 0 }, unreadCount: 0 }
}
test('the real buyer workspace passes its verified session to the creation modal', async () => {
  apiRequest.mockImplementation(workspaceApi)
  render(<LanguageProvider><BuyerDashboard user={buyer} /></LanguageProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /^طلبات التوريد/ }))
  fireEvent.click(screen.getByRole('button', { name: 'طلب توريد جديد' }))
  fireEvent.change(screen.getByLabelText('المنتج المطلوب'), { target: { value: 'Workspace creation' } })
  submit()
  await waitFor(() => expect(apiRequest.mock.calls.some(([path, options]) => path === '/sourcing' && options.headers['Idempotency-Key'])).toBe(true))
  expect(await screen.findByText('from-buyer')).toBeInTheDocument()
})
test('the real marketplace caller opens a buyer form without posting until an explicit action', async () => {
  window.history.replaceState({}, '', '/'); apiRequest.mockImplementation(workspaceApi)
  render(<App />)
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/suppliers/me/profile'))
  fireEvent.click(screen.getByRole('button', { name: 'المزيد' }))
  fireEvent.click(within(screen.getByRole('navigation', { name: 'التنقل العام' })).getByRole('button', { name: 'طلب توريد خاص' }))
  fireEvent.change(await screen.findByLabelText('المنتج المطلوب'), { target: { value: 'Marketplace creation' } })
  expect(apiRequest.mock.calls.some(([path, options]) => path === '/sourcing' && options?.method === 'POST')).toBe(false)
  submit()
  await waitFor(() => expect(apiRequest.mock.calls.some(([path, options]) => path === '/sourcing' && options.headers['Idempotency-Key'])).toBe(true))
})


test('backdrop cannot close an in-flight sourcing submission', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const value = props(); render(view(value)); submit()
  fireEvent.click(screen.getByRole('dialog').parentElement)
  expect(value.onClose).not.toHaveBeenCalled()
  await act(async () => { finish({ sourcing: { _id: 'backdrop-result' } }) })
  fireEvent.click(screen.getByRole('dialog').parentElement)
  expect(value.onClose).toHaveBeenCalledTimes(1)
})
