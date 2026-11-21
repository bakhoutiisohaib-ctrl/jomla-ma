import { act, fireEvent, render, screen } from '@testing-library/react';
import useSupplierRejection from './useSupplierRejection';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
const pending = { processing: true, rfq: { _id: 'r', status: 'deciding' }, rejection: { version: 1, phase: 'pending' } };
const done = { processing: false, rfq: { _id: 'r', status: 'rejected' }, rejection: { version: 1, phase: 'completed' } };
function Harness(props) {
  const state = useSupplierRejection({ rfqId: 'r', ...props });
  return <><p data-testid="phase">{state.phase}</p><p>{state.error}</p><button disabled={state.loading || state.waiting || state.phase === 'completed'} onClick={state.submit}>رفض</button><p data-testid="blocked">{String(state.blocked)}</p></>;
}
beforeEach(() => { jest.useFakeTimers(); localStorage.clear(); setSession('session-A'); apiRequest.mockReset(); });
afterEach(() => { jest.useRealTimers(); });
test('202 stays pending, blocks a new offer, throttles retries and requires an explicit same-RFQ retry', async () => {
  apiRequest.mockResolvedValueOnce(pending).mockResolvedValueOnce(done);
  const updated = jest.fn(); render(<Harness onUpdated={updated}/>);
  fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('button'));
  await act(async () => {});
  expect(apiRequest).toHaveBeenCalledTimes(1); expect(screen.getByTestId('phase')).toHaveTextContent('pending');
  expect(screen.getByTestId('blocked')).toHaveTextContent('true'); expect(screen.getByRole('button')).toBeDisabled();
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  expect(screen.getByTestId('phase')).toHaveTextContent('completed'); expect(updated).toHaveBeenCalledTimes(2);
  expect(apiRequest.mock.calls.map(c => [c[0], c[1].method, c[1].body])).toEqual(Array(2).fill(['/rfq/r/respond', 'PUT', { status: 'rejected' }]));
});
test('network ambiguity never announces completion or automatically resubmits', async () => {
  apiRequest.mockRejectedValueOnce(Error('network lost'));
  render(<Harness/>); fireEvent.click(screen.getByRole('button')); await act(async () => {});
  expect(screen.getByTestId('phase')).toHaveTextContent('uncertain'); expect(screen.getByText('network lost')).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(20000); }); expect(apiRequest).toHaveBeenCalledTimes(1);
});
test.each([done, pending])('late old-account response cannot update the replacement account (%j)', async result => {
  let resolve; apiRequest.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const updated = jest.fn(); render(<Harness onUpdated={updated}/>); fireEvent.click(screen.getByRole('button'));
  await act(async () => { setSession('session-B'); });
  expect(apiRequest.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { resolve(result); });
  expect(updated).not.toHaveBeenCalled(); expect(screen.getByTestId('phase')).toHaveTextContent('idle');
});
test('late response after unmount or switching RFQ is ignored', async () => {
  let resolve; apiRequest.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const updated = jest.fn(), view = render(<Harness onUpdated={updated}/>); fireEvent.click(screen.getByRole('button'));
  view.rerender(<Harness rfqId="other" onUpdated={updated}/>);
  await act(async () => { resolve(done); }); expect(updated).not.toHaveBeenCalled();
  expect(screen.getByTestId('phase')).toHaveTextContent('idle'); view.unmount();
});
test('opening saved progress does not POST; observed completion clears pending without a new decision', async () => {
  const view = render(<Harness progress={pending.rejection} status="deciding"/>);
  expect(screen.getByTestId('phase')).toHaveTextContent('pending'); expect(apiRequest).not.toHaveBeenCalled();
  view.rerender(<Harness progress={done.rejection} status="rejected"/>);
  expect(screen.getByTestId('phase')).toHaveTextContent('completed'); expect(apiRequest).not.toHaveBeenCalled();
});
