// Presentation only. The catalog API owns filtering and effective prices.
// Base price applies to quantities not covered by any declared tier.
const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validQty = value => Number.isSafeInteger(value) && value >= 1;

export function cardPrice(product, context = {}) {
  if (product.pricingMode === 'on_request') return { kind: 'request' };
  if (!/^[A-Z]{3}$/.test(product.currency || '') || !validPrice(product.price)) return { kind: 'unknown' };
  const base = product.price;
  if (validQty(context.quantity)) {
    if (!validQty(product.moq) || context.quantity < product.moq || !validPrice(product.effectiveUnitPrice))
      return { kind: 'unknown' };
    return { kind: 'quantity', value: product.effectiveUnitPrice, quantity: context.quantity };
  }
  // With a price filter/sort but no quantity, the existing server matches
  // the base price. Do not replace that with a potentially unrelated range.
  if (context.basePriceSearch) return { kind: 'base', value: base };
  if (product.priceTiers != null && !Array.isArray(product.priceTiers)) return { kind: 'unknown' };
  const tiers = [...(product.priceTiers || [])];
  if (!tiers.length) return { kind: 'single', value: base };
  if (!validQty(product.moq) || tiers.some(t => !t || !validQty(t.minQty) ||
      t.minQty < product.moq || !validPrice(t.price) ||
      (t.maxQty != null && (!validQty(t.maxQty) || t.maxQty < t.minQty)))) return { kind: 'unknown' };
  tiers.sort((a,b) => a.minQty - b.minQty);
  const prices = [];
  let next = product.moq, baseReachable = false;
  for (const tier of tiers) {
    if (tier.minQty < next) return { kind: 'unknown' };
    if (tier.minQty > next) baseReachable = true;
    prices.push(tier.price);
    next = tier.maxQty == null || tier.maxQty === Number.MAX_SAFE_INTEGER ? Infinity : tier.maxQty + 1;
  }
  if (baseReachable || next !== Infinity) prices.push(base);
  const min = Math.min(...prices), max = Math.max(...prices);
  return min === max ? { kind: 'single', value: min } : { kind: 'range', min, max };
}
