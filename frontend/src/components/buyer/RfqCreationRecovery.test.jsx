import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RfqCreationRecovery from './RfqCreationRecovery';
import BuyerDashboard from './BuyerDashboard';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
import { setSession } from '../../api/session';
jest.mock('../../api/config',()=>({apiRequest:jest.fn()}));
beforeEach(()=>{localStorage.clear();localStorage.setItem('supplierToken','synthetic-buyer');apiRequest.mockReset();});
test('owned history recovery uses the existing id without sending a new RFQ body',async()=>{
  apiRequest.mockResolvedValue({processing:true}); const refresh=jest.fn();
  render(<LanguageProvider><RfqCreationRecovery id="rfq-saved" onRefresh={refresh}/></LanguageProvider>);
  expect(apiRequest).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'استكمال إنشاء الطلب'}));
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
  expect(apiRequest).toHaveBeenCalledWith('/rfq/rfq-saved/creation/retry',expect.objectContaining({method:'POST',token:'synthetic-buyer'}));
  expect(apiRequest.mock.calls[0][1].body).toBeUndefined();expect(screen.getByRole('status')).toHaveTextContent('لم يكتمل الإرسال');
});
test('a late recovery result from another session is discarded',async()=>{
  let finish;apiRequest.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const refresh=jest.fn();
  render(<LanguageProvider><RfqCreationRecovery id="private-a" onRefresh={refresh}/></LanguageProvider>);
  fireEvent.click(screen.getByRole('button',{name:'استكمال إنشاء الطلب'}));act(()=>setSession('new-buyer'));
  await act(async()=>finish({processing:false}));expect(refresh).not.toHaveBeenCalled();expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
test('buyer history labels creating explicitly and offers recovery instead of negotiation',async()=>{
  apiRequest.mockImplementation(async path=>path==='/rfq/buyer'?{data:[{_id:'creating-id',status:'creating',quantity:20,productId:{name:'منتج قيد الإنشاء'},supplierId:{name:'المورد'}}]}:{data:[],unreadCount:0});
  render(<LanguageProvider><BuyerDashboard user={{_id:'buyer',name:'المشتري'}} onBack={jest.fn()}/></LanguageProvider>);
  expect(await screen.findByRole('button',{name:'استكمال إنشاء الطلب'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'العروض والمحادثة'})).not.toBeInTheDocument();
  expect(screen.getAllByText('طلب قيد الإنشاء').length).toBeGreaterThan(0);
  expect(screen.getByText('تحتاج مراجعتك').closest('div')).toHaveTextContent('1');
});
