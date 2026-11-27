import { cardPrice } from './cardPrice';

const product = { price: 50, currency: 'MAD', moq: 10, pricingMode: 'fixed' };
const tier = (minQty, maxQty, price) => ({ minQty, maxQty, price });
const withTiers = (...priceTiers) => ({ ...product, priceTiers });

test('a single valid base is shown without fabricating a range', () => {
  expect(cardPrice(product)).toEqual({ kind: 'single', value: 50 });
  expect(cardPrice({ ...product, price: 0 })).toEqual({ kind: 'single', value: 0 });
});
test('all quantities covered: unreachable base price is excluded, even for unsorted tiers', () => {
  expect(cardPrice(withTiers(tier(30, null, 20), tier(10, 29, 40)))).toEqual({ kind: 'range', min: 20, max: 40 });
  expect(cardPrice(withTiers(tier(10, null, 20)))).toEqual({ kind: 'single', value: 20 });
});
test.each([
  [tier(20, null, 30)],
  [tier(10, 19, 30)],
  [tier(10, 19, 30), tier(21, null, 30)]
])('an actual gap or finite last tier retains the base price', (...tiers) => {
  expect(cardPrice(withTiers(...tiers))).toEqual({ kind: 'range', min: 30, max: 50 });
});
test('a tier at the safe-integer limit covers the last permitted quantity', () => {
  expect(cardPrice(withTiers(tier(10, Number.MAX_SAFE_INTEGER, 20)))).toEqual({ kind: 'single', value: 20 });
});
test('a valid applied quantity uses the server effective price; no stale base fallback', () => {
  const p = { ...withTiers(tier(10, 29, 40), tier(30, null, 20)), effectiveUnitPrice: 20 };
  expect(cardPrice(p, { quantity: 50, basePriceSearch: true })).toEqual({ kind: 'quantity', value: 20, quantity: 50 });
  expect(cardPrice({ ...p, effectiveUnitPrice: 0 }, { quantity: 50 })).toEqual({ kind: 'quantity', value: 0, quantity: 50 });
  expect(cardPrice(p, { quantity: 9 })).toEqual({ kind: 'unknown' });
  expect(cardPrice({ ...p, effectiveUnitPrice: undefined }, { quantity: 50 })).toEqual({ kind: 'unknown' });
});
test('base-price filters and sorting display the server search basis, not a misleading range', () => {
  expect(cardPrice(withTiers(tier(10, null, 20)), { basePriceSearch: true })).toEqual({ kind: 'base', value: 50 });
});
test('quote-only products never display obsolete numeric prices or tiers', () => {
  expect(cardPrice({ ...withTiers(tier(10, null, 20)), pricingMode: 'on_request' }, { quantity: 30 })).toEqual({ kind: 'request' });
});
test.each([
  { price: -1 }, { price: NaN }, { price: null }, { price: '50' }, { currency: '' },
  { priceTiers: {} }, { priceTiers: [null] }, { priceTiers: [tier(9, null, 20)] },
  { priceTiers: [tier(10, 9, 20)] }, { priceTiers: [tier(10, 20, 30), tier(20, null, 25)] },
  { priceTiers: [tier(10, null, 30), tier(30, null, 25)] },
  { priceTiers: [tier(10, 20, -1)] }
])('malformed prices or ranges fail closed: %j', override => {
  expect(cardPrice({ ...product, ...override })).toEqual({ kind: 'unknown' });
});

test('confirmed MOQ price is the effective tier, never the base or range',()=>{
 expect(cardPrice({...product,effectiveUnitPrice:20},{moqPriceSearch:true})).toEqual({kind:'moq',value:20,quantity:product.moq});
 expect(cardPrice(product,{moqPriceSearch:true})).toEqual({kind:'unknown'});
});
