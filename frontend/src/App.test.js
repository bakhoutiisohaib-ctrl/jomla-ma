import {comparisonFixture} from './comparisonFixture';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
jest.mock('./components/suppliers/SupplierDashboard', () => function IsolatedSupplierDashboard({ onBack }) {
  return <section><h1>Espace fournisseur isolé (test)</h1><button onClick={onBack}>Retour au catalogue (test)</button></section>;
});
const json = (body, status = 200) => Promise.resolve({
  ok: status < 400,
  status,
  json: () => Promise.resolve(body)
});
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  global.fetch = jest.fn(url => String(url).includes('/notifications') ? json({
    data: [],
    unreadCount: 0
  }) : json({
    data: [],
    pagination: {
      page: 1,
      pages: 1,
      total: 0
    }
  }));
});
afterEach(() => jest.restoreAllMocks());
test('renders the wholesale marketplace and administration entry', async () => {
  render(<App />);
  expect(screen.getByRole('heading', {
    name: 'منتجات لتجارتك، وموردون أقرب إليك.'
  })).toBeInTheDocument();
  expect(screen.getByRole('button', {
    name: /الإشراف/
  })).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
});
test('buyer filters reach the catalog API with the selected city and quantity', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('المدينة'), {
    target: {
      value: 'الرباط'
    }
  });
  fireEvent.change(screen.getByLabelText('الكمية المطلوبة'), {
    target: {
      value: '20'
    }
  });
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.get('city') === 'الرباط' && u.searchParams.get('quantity') === '20';
  })).toBe(true));
});
test('French language applies to catalog filters and registration journey', async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('لغة الواجهة'), { target: { value: 'fr' } });
  expect(screen.getByLabelText('Ville')).toBeInTheDocument();
  expect(document.documentElement.dir).toBe('ltr');
  fireEvent.click(screen.getByRole('button', {
    name: 'Devenir Fournisseur'
  }));
  expect(screen.getByRole('heading', {
    name: 'Rejoignez le marché B2B'
  })).toBeInTheDocument();
  expect(screen.getByLabelText('Type de compte')).toBeInTheDocument();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
});
test('restored buyer session stays in the marketplace and logout clears both stored tokens', async () => {
  localStorage.setItem('supplierToken', 'synthetic-test-token');
  localStorage.setItem('adminToken', 'stale-token');
  global.fetch = jest.fn(url => String(url).includes('/me/profile') ? json({
    _id: 'buyer-id',
    role: 'buyer',
    name: 'مشتري الاختبار'
  }) : json({
    data: [],
    pagination: {
      pages: 1,
      total: 0
    }
  }));
  render(<App />);
  expect(await screen.findByRole('button', {
    name: /مساحتي/
  })).toBeInTheDocument();
  expect(screen.getByRole('heading', {
    name: 'منتجات لتجارتك، وموردون أقرب إليك.'
  })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {
    name: 'خروج'
  }));
  await waitFor(() => expect(localStorage.getItem('supplierToken')).toBeNull());
  expect(localStorage.getItem('adminToken')).toBeNull();
  expect(fetch.mock.calls.some(([url, options]) => String(url).endsWith('/suppliers/logout') && options.method === 'POST')).toBe(true);
});

const pilotProduct = {
  _id: '111111111111111111111111', name: 'Carton pilote — produit test', category: 'Emballage',
  description: 'Produit synthétique pour vérifier les paliers de gros.', city: 'Casablanca',
  price: 25, currency: 'MAD', unit: 'carton', moq: 20, pricingMode: 'fixed',
  availability: 'in_stock', inStock: true, supplierId: { _id: 'pilot-supplier', name: 'Fournisseur test' },
  priceTiers: [{ minQty: 20, maxQty: 49, price: 22 }, { minQty: 50, maxQty: null, price: 20 }]
};
const catalogResponse = products => json({ data: products, pagination: { page: 1, pages: 1, total: products.length } });

test.each([
  ['ar', 'مقارنة', 'rtl'],
  ['fr', 'Comparer', 'ltr']
])('visitor catalog media and comparison work in %s without credentials', async (lang, compareLabel, direction) => {
  localStorage.setItem('jomla_lang', lang);
  URL.createObjectURL = jest.fn(() => 'blob:anonymous-catalog');
  URL.revokeObjectURL = jest.fn();
  global.fetch = jest.fn(url => String(url).includes('/comparable?') ? json(comparisonFixture(pilotProduct,Number(new URL(url,'http://localhost').searchParams.get('quantity')))) : String(url).includes('/media/') ? Promise.resolve({ ok: true, status: 200,
    blob: async () => new Blob(['synthetic public image'], { type: 'image/png' }) }) :
    String(url).endsWith('/products/' + pilotProduct._id) ? json({ product: { ...pilotProduct, imageUrl: '/uploads/public-app-c1.png' } }) :
    catalogResponse([{ ...pilotProduct, imageUrl: '/uploads/public-app-c1.png' }]));
  render(<App />);
  expect(await screen.findByRole('img', { name: pilotProduct.name })).toHaveAttribute('src', 'blob:anonymous-catalog');
  expect(document.documentElement.dir).toBe(direction);
  const mediaRequest = fetch.mock.calls.find(([url]) => String(url).includes('/media/'));
  expect(mediaRequest[1].headers).toEqual({});
  expect(mediaRequest[1].credentials).toBe('omit');
  fireEvent.click(screen.getByRole('button', { name: (lang === 'fr' ? 'Aperçu rapide : ' : 'معاينة سريعة: ') + pilotProduct.name }));
  fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: compareLabel, exact: true }));
  await waitFor(()=>expect(screen.getByRole('dialog').querySelector('.atlas-comparison-row')).toHaveTextContent(pilotProduct.name));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: lang === 'fr' ? 'Fermer' : 'إغلاق' }));
  expect(screen.getByRole('img', { name: pilotProduct.name })).toBeInTheDocument();
  expect(localStorage.getItem('supplierToken')).toBeNull();
});

test('comparison follows the requested quantity when the catalog price changes from the 20-unit to the 50-unit tier', async () => {
  localStorage.setItem('jomla_lang', 'fr');
  global.fetch = jest.fn(url => {
    const request = new URL(url, 'http://localhost');
    const quantity = Number(request.searchParams.get('quantity'));
    if(request.pathname.endsWith('/comparable'))return json(comparisonFixture(pilotProduct,quantity));
    if (request.pathname === '/api/products/' + pilotProduct._id) return json({ product: pilotProduct });
    return catalogResponse([{ ...pilotProduct, effectiveUnitPrice: quantity >= 50 ? 20 : quantity >= 20 ? 22 : 25 }]);
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText('Quantité souhaitée'), { target: { value: '20' } });
  const title = await screen.findByRole('heading', { name: pilotProduct.name });
  const card = title.closest('article');
  await waitFor(() => expect(card.querySelector('.price')).toHaveTextContent(/22[,.]00/));
  fireEvent.click(within(card).getByRole('button', { name: 'Aperçu rapide : ' + pilotProduct.name }));
  fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: 'Comparer' }));
  const comparison=screen.getByRole('dialog',{name:'Comparer le même type'});
  await waitFor(()=>expect(comparison.querySelector('.atlas-comparison-row b')).toHaveTextContent(/22[,.]00/));
  fireEvent.change(within(comparison).getByLabelText('Quantité souhaitée'),{target:{value:'50'}});
  fireEvent.click(within(comparison).getByRole('button',{name:'Calculer'}));
  await waitFor(()=>expect(comparison.querySelector('.atlas-comparison-row b')).toHaveTextContent(/20[,.]00/));
  expect(fetch.mock.calls.some(([url])=>String(url).includes('/comparable?')&&new URL(url,'http://localhost').searchParams.get('quantity')==='50')).toBe(true);
});

test('returning from the supplier workspace refreshes the public catalog after a newly published product', async () => {
  localStorage.setItem('jomla_lang', 'fr');
  localStorage.setItem('supplierToken', 'synthetic-supplier-token');
  let catalog = [pilotProduct];
  global.fetch = jest.fn(url => String(url).includes('/me/profile') ? json({
    _id: 'pilot-supplier', role: 'supplier', name: 'Fournisseur pilote test'
  }) : catalogResponse(catalog));
  render(<App />);
  await screen.findByRole('heading', { name: pilotProduct.name });
  fireEvent.click(await screen.findByRole('button', { name: 'Mon espace', exact: true }));
  expect(screen.getByRole('heading', { name: 'Espace fournisseur isolé (test)' })).toBeInTheDocument();

  // The real backend publication is covered by the isolated journey tests. Here the
  // server fixture changes while the supplier workspace is open to test App's return.
  const published = { ...pilotProduct, _id: 'pilot-product-2', name: 'Nouveau produit publié — test' };
  catalog = [...catalog, published];
  fireEvent.click(screen.getByRole('button', { name: 'Retour au catalogue (test)' }));
  expect(await screen.findByRole('heading', { name: published.name })).toBeInTheDocument();
});
