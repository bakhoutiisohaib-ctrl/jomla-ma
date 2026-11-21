import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupplierOfferForm from './SupplierOfferForm';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
const rfq = { _id: 'rfq-r3', status: 'pending', currency: 'MAD', quantity: 20, productId: { name: 'R3 fixture', unit: 'زوج' } };
const done = { rfq: { ...rfq, status: 'responded' }, offer: { _id: 'offer-r3' }, processing: false, submission: { phase: 'completed', offerId: 'offer-r3' } };
beforeEach(() => { localStorage.clear(); setSession('session-A'); apiRequest.mockReset(); });
const show = props => render(<LanguageProvider><SupplierOfferForm rfq={rfq} {...props}/></LanguageProvider>);
function fill() { fireEvent.change(screen.getByLabelText(/سعر الوحدة/), { target: { value: '99' } }); fireEvent.change(screen.getByLabelText('شروط الدفع'), { target: { value: 'original terms' } }); }
test('lost acknowledgement freezes original payload and reuses its secure key; double clicks cannot create two attempts', async () => {
  let reject; apiRequest.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; })).mockResolvedValueOnce(done);
  const updated = jest.fn(), block = jest.fn(); show({ onUpdated: updated, onBlockClose: block }); fill();
  const button = screen.getByRole('button', { name: 'إرسال العرض' }); fireEvent.click(button); fireEvent.click(button);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  const original = apiRequest.mock.calls[0][1]; expect(original.headers['Idempotency-Key']).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  await act(async () => reject(Object.assign(Error('network lost'), { status: 0 })));
  expect(screen.getByLabelText(/سعر الوحدة/)).toBeDisabled(); expect(screen.queryByRole('button', { name: 'إرسال العرض' })).not.toBeInTheDocument();
  expect(block).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال العرض' }));
  await screen.findByText('تأكد حفظ العرض وآثاره. راجع حالته الحالية في سجل العروض.');
  expect(apiRequest.mock.calls[1][1].headers).toEqual(original.headers); expect(apiRequest.mock.calls[1][1].body).toEqual(original.body);
  expect(original.body).toMatchObject({ unitPrice: 99, quantity: 20, currency: 'MAD', paymentTerms: 'original terms' });
  expect(updated).toHaveBeenCalledTimes(1); expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(null);
  apiRequest.mockResolvedValueOnce(done);
  fill(); fireEvent.click(screen.getByRole('button', { name: 'إرسال العرض' }));
  expect(apiRequest.mock.calls[2][1].headers['Idempotency-Key']).not.toBe(original.headers['Idempotency-Key']);
  await waitFor(() => expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(null));
});
test('202 is unresolved and explicit retry resumes the same frozen submission', async () => {
  apiRequest.mockResolvedValueOnce({ processing: true, rfq: { ...rfq, status: 'offering' }, submission: { phase: 'pending', offerId: 'offer-r3' } }).mockResolvedValueOnce(done);
  const block = jest.fn(); show({ onBlockClose: block }); fill(); fireEvent.click(screen.getByRole('button', { name: 'إرسال العرض' }));
  expect(await screen.findByText(/لم يتأكد الإرسال النهائي/)).toBeInTheDocument(); expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(99);
  expect(block).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال العرض' }));
  await screen.findByText(/تأكد حفظ العرض/); expect(apiRequest.mock.calls[1][1].body).toEqual(apiRequest.mock.calls[0][1].body);
});
test('reload of a known pending operation uses the authorized offer ID retry endpoint without new PUT', async () => {
  apiRequest.mockResolvedValue(done); show({ rfq: { ...rfq, status: 'offering' }, progress: { offerId: 'offer-r3', input: { unitPrice: 99, deliveryDays: 4, paymentTerms: 'frozen', notes: '' } } });
  expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(99); expect(screen.getByLabelText('شروط الدفع')).toBeDisabled();
  expect(apiRequest).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال العرض' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/rfq/rfq-r3/offers/retry', expect.objectContaining({ method: 'POST', body: { offerId: 'offer-r3' } })));
  await screen.findByText(/تأكد حفظ العرض/);
});
test('late previous account response cannot affect the new account, callbacks or original terms', async () => {
  let resolve; apiRequest.mockReturnValue(new Promise(r => { resolve = r; })); const updated = jest.fn(); show({ onUpdated: updated }); fill();
  fireEvent.click(screen.getByRole('button', { name: 'إرسال العرض' })); const signal = apiRequest.mock.calls[0][1].signal;
  act(() => setSession('session-B')); expect(signal.aborted).toBe(true); expect(screen.getByLabelText(/سعر الوحدة/)).toHaveValue(null);
  await act(async () => resolve(done)); expect(updated).not.toHaveBeenCalled(); expect(screen.queryByText(/تأكد حفظ العرض/)).not.toBeInTheDocument();
});
test('French error state and frozen fields never claim success after 500 or 409', async () => {
  localStorage.setItem('jomla_lang', 'fr'); apiRequest.mockRejectedValue(Object.assign(Error('Erreur de test'), { status: 500 })); show();
  fireEvent.change(screen.getByLabelText(/Prix unitaire/), { target: { value: '88' } }); fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’offre' }));
  expect(await screen.findByText(/Résultat incertain/)).toBeInTheDocument(); expect(screen.getByLabelText(/Prix unitaire/)).toBeDisabled(); expect(screen.getByRole('button', { name: 'Reprendre l’envoi de l’offre' })).toBeEnabled();
});
test('a late saved staff submission replaces unsent local fields with its original data, without sending automatically', async () => {
  const ui = show(); fill();
  ui.rerender(<LanguageProvider><SupplierOfferForm rfq={{ ...rfq, status: 'offering' }} progress={{ offerId: 'staff-offer', input: { unitPrice: 75, deliveryDays: 8, paymentTerms: 'saved staff terms', notes: 'saved' } }}/></LanguageProvider>);
  expect(await screen.findByLabelText(/سعر الوحدة/)).toHaveValue(75);
  expect(screen.getByLabelText('شروط الدفع')).toHaveValue('saved staff terms'); expect(screen.getByLabelText('شروط الدفع')).toBeDisabled();
  expect(apiRequest).not.toHaveBeenCalled();
  apiRequest.mockResolvedValue(done); fireEvent.click(screen.getByRole('button', { name: 'استكمال إرسال العرض' }));
  await screen.findByText(/تأكد حفظ العرض/);
  expect(apiRequest.mock.calls[0][1].body).toEqual({ offerId: 'staff-offer' });
});
