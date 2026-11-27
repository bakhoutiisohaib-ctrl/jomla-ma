import { detailPricing, parseQuantity, validOrderQuantity } from './detailPricing';

const product = { price: 25, currency: 'MAD', pricingMode: 'fixed', moq: 10,
  priceTiers: [{ minQty: 30, price: 18 }, { minQty: 10, maxQty: 19, price: 22 }] };

test.each([[10,22,10],[19,22,10],[20,25,null],[29,25,null],[30,18,30],[50,18,30]])(
  'quantity %s matches the declared inclusive tier or base price', (qty, price, tierMin) => {
    expect(detailPricing(product, String(qty))).toEqual({ kind:'fixed', quantity:qty, unitPrice:price, total:qty*price, tierMin });
  }
);

test.each(['', ' ', '1e2', '2.5', '-1', '0', '9007199254740992', true, null, 1.1, Infinity])(
  'rejects invalid quantity %s', value => {
    expect(parseQuantity(value)).toBeNull();
    expect(detailPricing(product,value)).toEqual({kind:'invalid_quantity'});
  }
);

test('MOQ and missing or invalid MOQ never produce an estimate', () => {
  expect(validOrderQuantity(product,9)).toBeNull();
  expect(validOrderQuantity(product,10)).toBe(10);
  expect(validOrderQuantity({...product,moq:undefined},10)).toBeNull();
  expect(validOrderQuantity({...product,moq:1.5},10)).toBeNull();
});

test('quote-only and zero-priced offers do not fabricate or discard a price', () => {
  expect(detailPricing({...product,pricingMode:'on_request'},50)).toEqual({kind:'request',quantity:50});
  expect(detailPricing({...product,priceTiers:[{minQty:10,price:0}]},50)).toEqual({kind:'fixed',quantity:50,unitPrice:0,total:0,tierMin:10});
});

test('legacy overlapping tiers, malformed tiers, currency and missing price are unknown', () => {
  for (const patch of [
    {priceTiers:[{minQty:10,maxQty:40,price:5},{minQty:30,price:1}]},
    {priceTiers:'invalid'},{priceTiers:[null]},{price:undefined},{currency:'bad!'}
  ]) expect(detailPricing({...product,...patch},50)).toEqual({kind:'unknown',quantity:50});
});

test('unsafe totals are suppressed without blocking a valid quantity', () => {
  const result = detailPricing({...product,priceTiers:[],price:25},Number.MAX_SAFE_INTEGER);
  expect(result).toMatchObject({kind:'fixed',quantity:Number.MAX_SAFE_INTEGER,unitPrice:25,total:null});
  expect(detailPricing({...product,priceTiers:[],price:0.1},30).total).toBeCloseTo(3);
});
