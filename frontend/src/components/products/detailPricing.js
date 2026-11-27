import { cardPrice } from './cardPrice';

// Public quantity context only: no prices, credentials or buyer details in URLs.
// Match the RFQ server's positive safe-integer and MOQ contract.
export function parseQuantity(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^[0-9]{1,16}$/.test(value)) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function validOrderQuantity(product, value) {
  const quantity = parseQuantity(value), moq = parseQuantity(product?.moq);
  return quantity !== null && moq !== null && quantity >= moq ? quantity : null;
}

// Preview only. The actual RFQ contains the quantity; a supplier's negotiated
// offer, not this estimate, establishes the commercial price.
export function detailPricing(product, rawQuantity) {
  const quantity = validOrderQuantity(product, rawQuantity);
  if (quantity === null) return { kind: 'invalid_quantity' };
  if (product.pricingMode === 'on_request') return { kind: 'request', quantity };
  if (cardPrice(product).kind === 'unknown') return { kind: 'unknown', quantity };
  const tier = (product.priceTiers || []).find(t => t.minQty <= quantity && (t.maxQty == null || t.maxQty >= quantity));
  const unitPrice = tier?.price ?? product.price;
  const total = unitPrice * quantity;
  let minorFactor;
  try {
    minorFactor = 10 ** new Intl.NumberFormat('en', { style: 'currency', currency: product.currency }).resolvedOptions().maximumFractionDigits;
  } catch { return { kind: 'unknown', quantity }; }
  // Do not display an overflowed or unsafe minor-unit estimate. The unit
  // price and quantity can still be shown and a quote requested.
  const safeTotal = Number.isFinite(total) && total >= 0 && total * minorFactor <= Number.MAX_SAFE_INTEGER;
  return { kind: 'fixed', quantity, unitPrice, total: safeTotal ? total : null, tierMin: tier?.minQty ?? null };
}
