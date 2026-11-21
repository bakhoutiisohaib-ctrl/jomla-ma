import { fireEvent, render, screen } from '@testing-library/react';
import CommercialAgreement, { agreedProduct } from './CommercialAgreement';
import { LanguageProvider } from '../../i18n/LanguageContext';

const agreement = {
  version: 1, source: 'offer_snapshot', offerId: 'original-offer',
  product: { id: 'old-product', name: 'تعريف المنتج عند العرض', unit: 'زوج', category: 'أحذية', description: 'وصف المنتج المثبت' },
  supplier: { name: 'المورد وقت العرض' }, buyer: { name: 'المشتري' },
  unitPrice: 19, totalPrice: 380, quantity: 20, currency: 'MAD', unit: 'زوج', deliveryDays: 4,
  paymentTerms: 'شروط الاتفاق الأصلية', notes: 'ملاحظة العرض', requestNotes: 'متطلبات المشتري الأصلية'
};
const rfq = { _id: 'rfq-1', status: 'accepted', productId: { name: 'اسم كتالوج متغير', unit: 'صندوق' },
  decision: { action: 'accept', phase: 'completed', offerId: 'original-offer', agreement } };
beforeEach(() => localStorage.clear());
function show(value = rfq, props = {}) { render(<LanguageProvider><CommercialAgreement rfq={value} {...props} /></LanguageProvider>); }

test.each(['ar', 'fr'])('fixed agreement details remain visible independently from catalog changes (%s)', lang => {
  localStorage.setItem('jomla_lang', lang);
  show();
  expect(screen.getByText('تعريف المنتج عند العرض')).toBeInTheDocument();
  expect(screen.getByText('وصف المنتج المثبت')).toBeInTheDocument();
  expect(screen.getByText(/شروط الاتفاق الأصلية/)).toBeInTheDocument();
  expect(screen.getByText(/متطلبات المشتري الأصلية/)).toBeInTheDocument();
  expect(screen.queryByText('اسم كتالوج متغير')).not.toBeInTheDocument();
  expect(screen.getByText(/20 زوج/)).toBeInTheDocument();
  expect(agreedProduct(rfq).unit).toBe('زوج');
});

test('a deleted catalog product does not remove the agreement description', () => {
  show({ ...rfq, productId: null });
  expect(screen.getByText('تعريف المنتج عند العرض')).toBeInTheDocument();
});

test('pending decisions show recovery rather than completed acceptance and expose one retry action', () => {
  const retry = jest.fn();
  show({ ...rfq, status: 'deciding', decision: { ...rfq.decision, phase: 'pending' } }, { onRetry: retry });
  expect(screen.getByRole('status')).toHaveTextContent('لم يكتمل تثبيت القرار');
  expect(screen.queryByRole('heading', { name: 'بيانات الاتفاق المثبتة' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'إعادة استكمال القرار' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('legacy accepted records are clearly marked without a fabricated snapshot', () => {
  show({ ...rfq, decision: undefined });
  expect(screen.getByText(/سجل قديم دون نسخة تاريخية مثبتة/)).toBeInTheDocument();
  expect(screen.queryByText('تعريف المنتج عند العرض')).not.toBeInTheDocument();
});

test('new decisions on old offers label the limited provenance', () => {
  show({ ...rfq, decision: { ...rfq.decision, agreement: { ...agreement, source: 'legacy_product_at_decision' } } });
  expect(screen.getByText(/وقت هذا القرار الجديد، وليس وقت إنشاء العرض القديم/)).toBeInTheDocument();
});
