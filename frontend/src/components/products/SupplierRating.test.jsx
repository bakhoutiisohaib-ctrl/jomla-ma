import { act, render, screen, waitFor } from '@testing-library/react';
import SupplierRating from './SupplierRating';
import { apiRequest } from '../../api/config';

jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
const id = '222222222222222222222222';
const rating=(avg,total,supplierId=id)=>({stats:{avg,total},legacyTotal:0,data:total?[{_id:'1'.repeat(24),supplierId,stars:4,basis:'mutual_confirmation'}]:[],pagination:{page:1,limit:1,total,pages:total,hasNextPage:total>1,hasPrevPage:false}});
beforeEach(() => {
  apiRequest.mockReset();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

test('labels real API statistics as supplier reviews and coalesces concurrent cards', async () => {
  let resolve;
  apiRequest.mockReturnValue(new Promise(done => { resolve = done; }));
  render(<><SupplierRating supplierId={id} /><SupplierRating supplierId={id} /></>);
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async () => resolve(rating(4.2,7)));
  expect(screen.getAllByText('4.2/5')).toHaveLength(2);
  expect(screen.getAllByText('تقييم المورد من تعاملات أقرها الطرفان (7)')).toHaveLength(2);
  expect(apiRequest).toHaveBeenCalledWith('/reviews/' + id + '?limit=1', { token: '', cache: 'no-store' });
});

test.each([undefined, { avg: 0, total: 0 }, { avg: 4.8, total: 0 }, { avg: 6, total: 2 }, { avg: 4, total: -1 }, { avg: '4.5', total: 1 }])('hides absent or invalid statistics %j', async stats => {
  apiRequest.mockResolvedValue({ stats });
  const { container } = render(<SupplierRating supplierId={id} />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});

test('hides a previously visible rating when visibility revalidation fails', async () => {
  apiRequest.mockResolvedValueOnce(rating(4,2)).mockRejectedValueOnce(new Error('withdrawn'));
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
  apiRequest.mockImplementationOnce(() => new Promise(done => { resolveOld = done; })).mockResolvedValue(rating(3.5,3,'333333333333333333333333'));
  const view = render(<SupplierRating supplierId={id} />);
  view.rerender(<SupplierRating supplierId="333333333333333333333333" />);
  await screen.findByText('3.5/5');
  await act(async () => resolveOld(rating(5,999)));
  expect(screen.queryByText('5.0/5')).not.toBeInTheDocument();
  expect(screen.getByText('تقييم المورد من تعاملات أقرها الطرفان (3)')).toBeInTheDocument();
});

test('invalid supplier identifiers do not start requests', async () => {
  const { container } = render(<SupplierRating supplierId={undefined} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(apiRequest).not.toHaveBeenCalled();
});

test('compact card rating keeps the supplier identity and real review count accessible', async () => {
  apiRequest.mockResolvedValue(rating(4.2,7));
  const { container } = render(<SupplierRating supplierId={id} compact />);
  expect(await screen.findByRole('img', { name: 'تقييم المورد من تعاملات أقرها الطرفان: 4.2/5 (7)' })).toHaveClass('atlas-card-rating');
  expect(container).toHaveTextContent('4.2/5 (7)');
});

test('compact card never invents a rating for an unrated supplier', async () => {
  apiRequest.mockResolvedValue(rating(0,0));
  const { container } = render(<SupplierRating supplierId={id} compact />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});

test.each(['counts','foreign','confirmed-invalid','missing-envelope','contradictory-page'])('compact rating fails closed for %s',async kind=>{
 let r=rating(4,2);
 if(kind==='counts')r.legacyTotal=2;
 if(kind==='foreign')r.data[0].supplierId='3'.repeat(24);
 if(kind==='confirmed-invalid')r.data[0].stars=100000;
 if(kind==='missing-envelope')delete r.pagination;
 if(kind==='contradictory-page'){r.data[0].basis=undefined;}
 apiRequest.mockResolvedValue(r);
 const {container}=render(<SupplierRating supplierId={id} compact/>);
 await act(async()=>{});
 expect(container).toBeEmptyDOMElement();
});
test('all excluded opinions do not create an average on compact card',async()=>{
 const r=rating(0,0);r.legacyTotal=1;r.pagination={...r.pagination,total:1,pages:1};r.data=[{_id:'1'.repeat(24),supplierId:id,stars:5}];
 apiRequest.mockResolvedValue(r);
 const {container}=render(<SupplierRating supplierId={id} compact/>);
 await act(async()=>{});expect(container).toBeEmptyDOMElement();
});
