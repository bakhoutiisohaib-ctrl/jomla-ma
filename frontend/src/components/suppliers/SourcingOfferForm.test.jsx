import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SourcingOfferForm from './SourcingOfferForm'
import SourcingQuoteTerms from '../common/SourcingQuoteTerms'
import BuyerDashboard from '../buyer/BuyerDashboard'
import SupplierDashboard from './SupplierDashboard'
import { apiRequest } from '../../api/config'
import { clearSession, setSession } from '../../api/session'
import { LanguageProvider } from '../../i18n/LanguageContext'
jest.mock('../../api/config', () => ({ ...jest.requireActual('../../api/config'), apiRequest: jest.fn() }))
const supplier = { _id: 'supplier-a', role: 'supplier', permissions: ['all'] }
const sourcing = { _id: 's2-source', productName: 'طلب اصطناعي', status: 'open', quantity: 100, unit: 'زوج', quotes: [] }
const input = { unitPrice: 12, currency: 'MAD', deliveryDays: 3, paymentTerms: 'شروط مثبتة', notes: 'ملاحظات ثابتة' }
const operation = { kind: 'sourcing_offer', phase: 'pending' }
const recovery = { operationId: 'op-1', input }
const view = props => <LanguageProvider><SourcingOfferForm sourcing={sourcing} supplier={supplier} sessionToken="session-a" {...props} /></LanguageProvider>
const error = (status, code) => Object.assign(new Error('synthetic error'), { status, data: { code } })
function submit() { fireEvent.submit(screen.getByLabelText(/سعر الوحدة/).closest('form')) }
beforeEach(() => { localStorage.clear(); setSession('session-a'); apiRequest.mockReset() })
test('no POST on open; an explicit double submit uses one secure stable attempt', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onUpdated = jest.fn(); render(view({ onUpdated }))
  expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '12' } }); submit(); submit()
  expect(apiRequest).toHaveBeenCalledTimes(1)
  expect(apiRequest.mock.calls[0][1].headers['Idempotency-Key']).toMatch(/^[a-f0-9]{48}$/)
  expect(apiRequest.mock.calls[0][1].body.unitPrice).toBe(12)
  await act(async () => { finish({ processing: false, quote: { _id: 'q-1' }, sourcing }) })
  expect(onUpdated).toHaveBeenCalledTimes(1)
})
test('lost acknowledgement freezes the original payload and reuses its key', async () => {
  apiRequest.mockRejectedValueOnce(error(0)).mockResolvedValueOnce({ processing: false, quote: { _id: 'q-1' }, sourcing })
  const onUpdated = jest.fn(); render(view({ onUpdated }))
  fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '12' } }); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('غير محسومة')
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeDisabled(); expect(onUpdated).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'استكمال العرض نفسه' }))
  await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1))
  expect(apiRequest.mock.calls[1][1].headers).toEqual(apiRequest.mock.calls[0][1].headers)
  expect(apiRequest.mock.calls[1][1].body).toEqual(apiRequest.mock.calls[0][1].body)
})
test.each([['ar', 'سعر الوحدة', 'استكمال العرض نفسه', 'لم يُنشر العرض الجديد'], ['fr', 'Prix unitaire', 'Reprendre la même offre', 'La nouvelle offre n’est pas publiée']])('202 remains pending in %s without final success and can close safely once saved', async (lang, price, retry, pending) => {
  localStorage.setItem('jomla_lang', lang)
  apiRequest.mockResolvedValue({ processing: true, sourcing: { ...sourcing, operation, offerRecovery: recovery } })
  const onUpdated = jest.fn(), onBlockClose = jest.fn(); render(view({ onUpdated, onBlockClose }))
  fireEvent.change(screen.getByLabelText(new RegExp(price)), { target: { value: '12' } }); fireEvent.submit(screen.getByLabelText(new RegExp(price)).closest('form'))
  expect(await screen.findByText(new RegExp(pending))).toBeInTheDocument()
  expect(screen.getByRole('button', { name: retry })).toBeDisabled()
  expect(screen.queryByText(/تم تأكيد حفظ العرض|Offre confirmée/)).not.toBeInTheDocument()
  await waitFor(() => expect(onBlockClose).toHaveBeenLastCalledWith(false))
  expect(onUpdated.mock.calls[0][0].processing).toBe(true)
})
test('reopening a persisted operation shows frozen server inputs and resumes by authorized operation id only', async () => {
  apiRequest.mockResolvedValue({ processing: false, quote: { _id: 'q-original', status: 'superseded' }, sourcing })
  render(view({ sourcing: { ...sourcing, operation, offerRecovery: recovery } }))
  expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(12)
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeDisabled(); expect(apiRequest).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'استكمال العرض نفسه' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
  expect(apiRequest.mock.calls[0][0]).toBe('/sourcing/s2-source/operations/op-1/retry')
  expect(apiRequest.mock.calls[0][1].headers).toBeUndefined()
  expect(apiRequest.mock.calls[0][1].body).toEqual({})
})
test('another supplier operation blocks a fresh offer without exposing inputs', () => {
  render(view({ sourcing: { ...sourcing, operation } }))
  expect(screen.getByRole('status')).toHaveTextContent('عرض آخر')
  expect(screen.queryByLabelText(/سعر الوحدة/)).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
})
test.each([['SOURCING_OPERATION_PENDING', 'عملية أخرى'], ['SOURCING_OFFER_KEY_CONFLICT', 'بيانات مختلفة']])('409 %s remains a frozen original attempt with a distinct message', async (code, message) => {
  apiRequest.mockRejectedValue(error(409, code)); render(view({}))
  fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '12' } }); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeDisabled()
  const original = apiRequest.mock.calls[0][1]; fireEvent.click(screen.getByRole('button', { name: 'استكمال العرض نفسه' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
  expect(apiRequest.mock.calls[1][1].headers).toEqual(original.headers)
})
test('a confirmed capacity rejection does not trap the form or claim success', async () => {
  apiRequest.mockRejectedValue(error(413, 'SOURCING_DOCUMENT_CAPACITY')); const onUpdated = jest.fn(); render(view({ onUpdated }))
  fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '12' } }); submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('لم يُحجز عرض جديد')
  expect(screen.getByLabelText(/سعر الوحدة/)).not.toBeDisabled(); expect(onUpdated).not.toHaveBeenCalled()
})
test('late results after account switch cannot invoke callbacks or show the old supplier inputs', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onUpdated = jest.fn(), rendered = render(view({ onUpdated }))
  fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '99' } }); submit()
  act(() => setSession('session-b')); rendered.rerender(view({ onUpdated, supplier: { ...supplier, _id: 'supplier-b' }, sessionToken: 'session-b' }))
  await act(async () => { finish({ processing: false, quote: { _id: 'private-a' }, sourcing }) })
  expect(onUpdated).not.toHaveBeenCalled(); expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(null)
  expect(screen.queryByText('private-a')).not.toBeInTheDocument()
})
test('unmount aborts and ignores a late response', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onUpdated = jest.fn(), rendered = render(view({ onUpdated })); submit()
  const signal = apiRequest.mock.calls[0][1].signal; rendered.unmount(); expect(signal.aborted).toBe(true)
  await act(async () => { finish({ processing: true, sourcing: { ...sourcing, offerRecovery: recovery } }) })
  expect(onUpdated).not.toHaveBeenCalled()
})
test('logout and revoked permissions remove the form and suppress old callbacks', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onUpdated = jest.fn(), rendered = render(view({ onUpdated, supplier: { ...supplier, role: 'staff', permissions: ['manage_rfq'] } })); submit()
  rendered.rerender(view({ onUpdated, supplier: { ...supplier, role: 'staff', permissions: [] } }))
  await act(async () => { finish({ processing: false, quote: { _id: 'old' }, sourcing }) }); expect(onUpdated).not.toHaveBeenCalled()
  expect(screen.queryByLabelText(/سعر الوحدة/)).not.toBeInTheDocument(); act(() => clearSession())
  expect(screen.queryByLabelText(/سعر الوحدة/)).not.toBeInTheDocument()
})
test('opening after login never automatically sends an offer and stores no attempt on disk', () => {
  clearSession(); const rendered = render(view({})); expect(apiRequest).not.toHaveBeenCalled()
  act(() => setSession('session-a')); rendered.rerender(view({}))
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
  expect(Object.keys(localStorage).sort()).toEqual(['jomla_lang', 'supplierToken'])
})
test('frozen snapshot prices and quantity are rendered independently of the current request', () => {
  const quote = { unitPrice: 999, currency: 'MAD', commercialSnapshot: { version: 1, request: { quantity: 20, unit: 'زوج' }, offer: { unitPrice: 12, totalPrice: 240, currency: 'MAD', deliveryDays: 3, paymentTerms: 'شروط قديمة' } } }
  render(<LanguageProvider><SourcingQuoteTerms quote={quote} sourcing={{ quantity: 999, unit: 'صندوق' }} /></LanguageProvider>)
  expect(screen.getByText(/20 زوج/)).toBeInTheDocument(); expect(screen.queryByText(/999/)).not.toBeInTheDocument()
  expect(screen.getByText(/شروط قديمة/)).toBeInTheDocument()
})
test('a notification target with pending publication shows an explicit banner and disabled buyer decisions', async () => {
  const row = { ...sourcing, operation, quotes: [{ _id: 'old-active', supplierName: 'مورد', status: 'active', ...input }] }
  apiRequest.mockImplementation(async path => {
    if (path === '/sourcing/buyer') return { data: [row] }
    if (path === '/notifications') return { data: [{ _id: 'notice', type: 'sourcing_offer', resourceType: 'sourcing', resourceId: row._id }], unreadCount: 1 }
    return { data: [] }
  })
  render(<LanguageProvider><BuyerDashboard user={{ _id: 'buyer', role: 'buyer' }} /></LanguageProvider>)
  fireEvent.click(await screen.findByRole('button', { name: /^الإشعارات/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'فتح الطلب' }))
  expect(await screen.findByText(/لم يُنشر العرض الجديد بعد/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'قبول العرض' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'رفض العرض' })).toBeDisabled()
})
test('the real supplier workspace sends a key and never announces final success for 202', async () => {
  apiRequest.mockImplementation(async (path, options) => {
    if (path === '/suppliers/me/profile') return supplier
    if (path === '/sourcing?status=open') return { data: [sourcing] }
    if (path === '/sourcing/' + sourcing._id) return sourcing
    if (path.endsWith('/quote') && options.method === 'POST') return { processing: true, sourcing: { ...sourcing, operation, offerRecovery: recovery } }
    return { data: [], pagination: { pages: 1, total: 0 } }
  })
  render(<LanguageProvider><SupplierDashboard supplier={supplier} /></LanguageProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'فرص التوريد', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'تقديم عرض محفوظ' }))
  fireEvent.change(await screen.findByLabelText(/سعر الوحدة/), { target: { value: '12' } }); submit()
  expect(await screen.findByText(/محاولة العرض محفوظة وقيد الاستكمال/)).toBeInTheDocument()
  expect(apiRequest.mock.calls.find(([path]) => path.endsWith('/quote'))[1].headers['Idempotency-Key']).toMatch(/^[a-f0-9]{48}$/)
  expect(screen.queryByText('تم حفظ عرض التوريد', { exact: true })).not.toBeInTheDocument()
  act(() => setSession('session-b'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
test('a stale authenticated record cannot be rendered for a replacement token', () => {
  render(view({ sourcing: { ...sourcing, operation, offerRecovery: recovery } }))
  act(() => setSession('session-b'))
  expect(screen.queryByLabelText(/سعر الوحدة/)).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('شروط مثبتة')).not.toBeInTheDocument()
})
test('an owned conflicted operation exposes only a clear review message without unfreezing or auto sending', () => {
  render(view({ sourcing: { ...sourcing, operation, offerRecovery: { ...recovery, requiresReview: true } } }))
  expect(screen.getByRole('alert')).toHaveTextContent('مراجعة تشغيلية')
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeDisabled(); expect(apiRequest).not.toHaveBeenCalled()
})
