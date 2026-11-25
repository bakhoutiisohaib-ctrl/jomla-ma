import { act, render, screen, waitFor } from '@testing-library/react';
import SupplierRating from './SupplierRating';
import { apiRequest } from '../../api/config';

jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
const id = '222222222222222222222222';
beforeEach(() => {
  apiRequest.mockReset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

test('labels real API statistics as supplier reviews and coalesces concurrent cards', async () => {
  let resolve;
  apiRequest.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<><SupplierRating supplierId={id} /><SupplierRating supplierId={id} /></>);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ stats: { avg: 4.2, total: 7 } }));
  expect(screen.getAllByText('4.2/5')).toHaveLength(2);
  expect(screen.getAllByText('تقييم المورد (7)')).toHaveLength(2);
  expect(apiRequest).toHaveBeenCalledWith('/reviews/' + id + '?limit=1', { token: '', cache: 'no-store' });
});

test.each([undefined, { avg: 0, total: 0 }, { avg: 4.8, total: 0 }, { avg: 6, total: 2 }, { avg: 4, total: -1 }, { avg: '4.5', total: 1 }])('hides absent or invalid statistics %j', async stats => {
  apiRequest.mockResolvedValue({ stats });
  const { container } = render(<SupplierRating supplierId={id} />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});

test('hides a previously visible rating when visibility revalidation fails', async () => {
  apiRequest.mockResolvedValueOnce({ stats: { avg: 4, total: 2 } }).mockRejectedValueOnce(new Error('withdrawn'));
  const { container } = render(<SupplierRating supplierId={id} />);
  await screen.findByText('4.0/5');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(container).toBeEmptyDOMElement();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(container).toBeEmptyDOMElement();
});

test('does not leak an old suppliers pending rating after the supplier changes', async () => {
  let resolveOld;
  apiRequest.mockImplementationOnce(() => new Promise(done => { resolveOld = done; })).mockResolvedValue({ stats: { avg: 3.5, total: 3 } });
  const view = render(<SupplierRating supplierId={id} />);
  view.rerender(<SupplierRating supplierId="333333333333333333333333" />);
  await screen.findByText('3.5/5');
  await act(async () => resolveOld({ stats: { avg: 5, total: 999 } }));
  expect(screen.queryByText('5.0/5')).not.toBeInTheDocument();
  expect(screen.getByText('تقييم المورد (3)')).toBeInTheDocument();
});

test('invalid supplier identifiers do not start requests', async () => {
  const { container } = render(<SupplierRating supplierId={undefined} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(apiRequest).not.toHaveBeenCalled();
});

test('compact card rating keeps the supplier identity and real review count accessible', async () => {
  apiRequest.mockResolvedValue({ stats: { avg: 4.2, total: 7 } });
  const { container } = render(<SupplierRating supplierId={id} compact />);
  expect(await screen.findByRole('img', { name: 'تقييم المورد: 4.2/5 (7)' })).toHaveClass('atlas-card-rating');
  expect(container).toHaveTextContent('4.2/5 (7)');
});

test('compact card never invents a rating for an unrated supplier', async () => {
  apiRequest.mockResolvedValue({ stats: { avg: 0, total: 0 } });
  const { container } = render(<SupplierRating supplierId={id} compact />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});
