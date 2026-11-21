import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SourcingDecisionCard from './SourcingDecisionCard'
import SourcingOfferForm from '../suppliers/SourcingOfferForm'
import { apiRequest } from '../../api/config'
import { setSession, clearSession } from '../../api/session'
import { LanguageProvider } from '../../i18n/LanguageContext'
jest.mock('../../api/config', () => ({ ...jest.requireActual('../../api/config'), apiRequest: jest.fn() }))
const user = { _id: 'buyer-a', role: 'buyer' }, quote = { _id: 'quote-a', supplierName: 'مورد اصطناعي', status: 'active', unitPrice: 12, currency: 'MAD', deliveryDays: 3, paymentTerms: 'شروط ثابتة' }
const sourcing = { _id: 's3-request', productName: 'منتج اصطناعي', quantity: 100, unit: 'زوج', status: 'open', __v: 2, quotes: [quote] }
const recovery = { operationId: 'op-a', quoteId: quote._id, action: 'accept' }, pending = { ...sourcing, __v: 3, operation: { kind: 'sourcing_decision', phase: 'pending' }, decisionRecovery: recovery }
const done = action => ({ processing: false, quote: { ...quote, status: action === 'accept' ? 'accepted' : 'rejected', decision: { action } }, sourcing: { ...sourcing, __v: 4, status: action === 'accept' ? 'fulfilled' : 'open', quotes: [{ ...quote, status: action === 'accept' ? 'accepted' : 'rejected' }] } })
const view = props => <LanguageProvider><SourcingDecisionCard sourcing={sourcing} user={user} sessionToken="session-a" {...props}/></LanguageProvider>
beforeEach(() => { localStorage.clear(); setSession('session-a'); apiRequest.mockReset() })
test('opening never submits; double click cannot create a second request', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve })); const onUpdated = jest.fn()
  render(view({ onUpdated })); expect(apiRequest).not.toHaveBeenCalled()
  const accept = screen.getByRole('button', { name: 'قبول العرض' }); fireEvent.click(accept); fireEvent.click(accept)
  expect(apiRequest).toHaveBeenCalledTimes(1); expect(apiRequest.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: { action: 'accept' }, token: 'session-a' })
  expect(apiRequest.mock.calls[0][1].headers).toBeUndefined()
  await act(async () => { finish(done('accept')) }); expect(onUpdated).toHaveBeenCalledTimes(1); expect(screen.getByText('تم تأكيد تثبيت القرار.')).toBeInTheDocument()
})
test.each([['ar', 'قبول العرض', 'استكمال القرار نفسه', 'لم يُثبت اتفاق نهائي'], ['fr', 'Accepter l’offre', 'Reprendre la même décision', 'aucun nouvel accord final']])('202 stays pending in %s and resumes the saved operation only', async (lang, accept, retry, label) => {
  localStorage.setItem('jomla_lang', lang); apiRequest.mockResolvedValueOnce({ processing: true, sourcing: pending }).mockResolvedValueOnce(done('accept'))
  render(view()); fireEvent.click(screen.getByRole('button', { name: accept }))
  expect(await screen.findByText(new RegExp(label))).toBeInTheDocument(); expect(screen.queryByText(/تم تأكيد تثبيت القرار|Décision confirmée/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: accept })).toBeDisabled(); fireEvent.click(await screen.findByRole('button', { name: retry }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2)); expect(apiRequest.mock.calls[1]).toEqual(['/sourcing/s3-request/operations/op-a/retry', expect.objectContaining({ method: 'POST', body: {} })])
})
test('lost response freezes the action and retries the same natural identity', async () => {
  apiRequest.mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(done('reject')); render(view())
  fireEvent.click(screen.getByRole('button', { name: 'رفض العرض' })); expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تأكيد القرار')
  expect(screen.getByRole('button', { name: 'قبول العرض' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'استكمال القرار نفسه' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2)); expect(apiRequest.mock.calls[1][0]).toBe(apiRequest.mock.calls[0][0]); expect(apiRequest.mock.calls[1][1].body).toEqual({ action: 'reject' })
})
test('reopening a saved buyer decision does not create it automatically', async () => {
  render(view({ sourcing: pending })); expect(apiRequest).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'قبول العرض' })).toBeDisabled()
  apiRequest.mockResolvedValue(done('accept')); fireEvent.click(screen.getByRole('button', { name: 'استكمال القرار نفسه' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1)); expect(apiRequest.mock.calls[0][0]).toContain('/operations/op-a/retry')
})
test('unmount ignores a late decision response and aborts the request', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve })); const onUpdated = jest.fn(), ui = render(view({ onUpdated }))
  fireEvent.click(screen.getByRole('button', { name: 'قبول العرض' })); const signal = apiRequest.mock.calls[0][1].signal; ui.unmount()
  expect(signal.aborted).toBe(true); await act(async () => { finish(done('accept')) }); expect(onUpdated).not.toHaveBeenCalled()
})
test('account switch hides previous data and ignores late callbacks', async () => {
  let finish; apiRequest.mockImplementation(() => new Promise(resolve => { finish = resolve })); const onUpdated = jest.fn()
  render(view({ onUpdated })); fireEvent.click(screen.getByRole('button', { name: 'قبول العرض' })); act(() => setSession('session-b'))
  expect(screen.queryByText('منتج اصطناعي')).not.toBeInTheDocument(); await act(async () => { finish(done('accept')) }); expect(onUpdated).not.toHaveBeenCalled()
})
test('logout hides recovery and creates no new request', () => {
  render(view({ sourcing: pending })); act(() => clearSession('session-a')); expect(screen.queryByRole('button', { name: 'استكمال القرار نفسه' })).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
})
test('only buyer role can see decision controls', () => { render(view({ user: { _id: 'supplier', role: 'supplier' } })); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled() })
test('a response without confirmed receipt remains uncertain', async () => {
  apiRequest.mockResolvedValue({ ...done('accept'), quote: { ...quote } }); render(view()); fireEvent.click(screen.getByRole('button', { name: 'قبول العرض' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.queryByText('تم تأكيد تثبيت القرار.')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'رفض العرض' })).toBeDisabled()
})
test('agreement renders fixed values instead of changed root or live quote', () => {
  const agreement = { version: 1, source: 'legacy_sourcing_quote_at_decision', snapshot: { request: { productName: 'تعريف مثبت', quantity: 20, unit: 'صندوق' }, offer: { unitPrice: 50, totalPrice: 1000, currency: 'MAD', deliveryDays: 7, paymentTerms: 'اتفاق ثابت' } } }
  render(view({ sourcing: { ...sourcing, status: 'fulfilled', quantity: 900, quotes: [{ ...quote, status: 'accepted', agreement }] } }))
  expect(screen.getByText('تعريف مثبت')).toBeInTheDocument(); expect(screen.getByText(/اتفاق ثابت/)).toBeInTheDocument(); expect(screen.getByText(/عرض قديم: ثُبتت البيانات/)).toBeInTheDocument(); expect(screen.getByText(/الكمية: 20 صندوق/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'قبول العرض' })).not.toBeInTheDocument()
})
test('another pending operation blocks all decisions without a new POST', () => { render(view({ sourcing: { ...sourcing, operation: { kind: 'sourcing_offer', phase: 'pending' } } })); expect(screen.getByRole('button', { name: 'قبول العرض' })).toBeDisabled(); expect(screen.queryByRole('button', { name: 'استكمال القرار نفسه' })).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled() })
test('pending supplier destination explains decision without offering unauthorized retry', () => {
  render(<LanguageProvider><SourcingOfferForm sourcing={pending} supplier={{ _id: 'supplier-a', role: 'supplier' }} sessionToken="session-a"/></LanguageProvider>)
  expect(screen.getByText(/قرار المشتري قيد الاستكمال/)).toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
})
test('capacity rejection before claim unlocks controls and explains the actual error', async () => {
  apiRequest.mockRejectedValue(Object.assign(Error('size'), { status: 413, data: { code: 'SOURCING_DOCUMENT_CAPACITY' } })); render(view()); fireEvent.click(screen.getByRole('button', { name: 'قبول العرض' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('لا يتسع السجل'); expect(screen.getByRole('button', { name: 'رفض العرض' })).not.toBeDisabled()
})
test('a later authenticated read discovers a pending decision without sending it', () => {
  const ui = render(view()); ui.rerender(view({ sourcing: pending }))
  expect(screen.getByRole('button', { name: 'استكمال القرار نفسه' })).toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
})
test('a confirmed receipt from refresh clears pending controls without a POST', () => {
  const ui = render(view({ sourcing: pending })), result = done('accept')
  ui.rerender(view({ sourcing: { ...result.sourcing, quotes: [result.quote] } }))
  expect(screen.queryByRole('button', { name: 'استكمال القرار نفسه' })).not.toBeInTheDocument(); expect(apiRequest).not.toHaveBeenCalled()
})
