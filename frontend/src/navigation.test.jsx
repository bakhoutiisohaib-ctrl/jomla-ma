import { parseRoute, safeReturnTo, productPath, storePath, navigate } from './navigation';
const id = 'abcdef0123456789abcdef01';
beforeEach(() => window.history.replaceState({}, '', '/'));
test.each([['/', 'home'], ['/stores', 'stores'], ['/login', 'login'], ['/register', 'register'],
  ['/buyer', 'buyer'], ['/supplier', 'supplier'], ['/admin', 'admin'], [productPath(id), 'product'],
  [storePath(id), 'store'], ['/suppliers/' + id, 'supplierPublic']])('%s has a stable route', (path, page) => {
  expect(parseRoute(path).page).toBe(page);
});
test.each(['/products/not-an-id', '/stores/../../private', '/unknown', '/products/%2fsecret'])('invalid route %s never resolves to a public document', path => {
  expect(parseRoute(path).page).toBe('notFound');
});
test('case and trailing slash do not depend on the editable product title', () => {
  expect(parseRoute('/products/' + id.toUpperCase() + '/')).toMatchObject({ page: 'product', id });
});
test.each(['https://external.invalid/', '//external.invalid/', '/login', '/register', '/admin', '/unknown'])('untrusted return target %s cannot escape or elevate buyer navigation', target => {
  expect(safeReturnTo('?returnTo=' + encodeURIComponent(target), 'buyer')).toBe('');
});
test('only the public product reference and RFQ intent survive an authentication return', () => {
  expect(safeReturnTo('?returnTo=' + encodeURIComponent(productPath(id) + '?rfq=1&token=never-copy'), 'buyer')).toBe(productPath(id) + '?rfq=1');
  expect(safeReturnTo('?returnTo=%2Fbuyer', 'buyer')).toBe('/buyer');
  expect(safeReturnTo('?returnTo=%2Fsupplier', 'buyer')).toBe('');
});
test('programmatic navigation rejects an external origin', () => {
  expect(() => navigate('https://external.invalid')).toThrow();
  expect(window.location.pathname).toBe('/');
});
