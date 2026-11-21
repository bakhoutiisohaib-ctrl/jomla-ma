import { fireEvent, render, screen } from '@testing-library/react';
import JobsPanel from './JobsPanel';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { apiRequest } from '../../api/config';
jest.mock('../../api/config', () => ({ apiRequest: jest.fn() }));
beforeEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('completed analysis can be recovered for manual review without publishing a product', async () => {
  const onReview = jest.fn();
  apiRequest.mockResolvedValue({ data: [{ id: 'completed-job', type: 'ai_product_draft', status: 'succeeded', attempts: 1, maxAttempts: 2,
    result: { imageUrl: '/uploads/owned.png', draft: { title: 'منتج', category: 'فئة', description: 'وصف مرئي', price: 42 } }
  }], pagination: { pages: 1 } });
  render(<LanguageProvider><JobsPanel onReview={onReview} /></LanguageProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'فتح للمراجعة' }));
  expect(onReview).toHaveBeenCalledWith({ jobId: 'completed-job', imageUrl: '/uploads/owned.png', name: 'منتج', category: 'فئة', description: 'وصف مرئي' });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(apiRequest.mock.calls[0][0]).toBe('/jobs/mine?page=1&limit=10');
});
