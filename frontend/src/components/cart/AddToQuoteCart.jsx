import { useState } from 'react';
import { useQuoteCart, CART_LIMIT } from './QuoteCartContext';
import { useLabels } from '../../i18n/useLabels';
import { MarketIcon } from '../common/MarketLayout';

export default function AddToQuoteCart({ product, user, compact = false }) {
  const cart = useQuoteCart(), l = useLabels(), [error, setError] = useState('');
  if (!cart || (user && user.role !== 'buyer')) return null;
  const inCart = cart.items.includes(product._id), available = product.availability === 'in_stock' || product.inStock === true;
  const label = inCart ? l('في سلة العروض', 'Dans la sélection') : l('أضف لسلة العروض', 'Ajouter à la sélection');
  return <><button type="button" className={'atlas-add-cart' + (compact ? ' atlas-add-cart-compact' : '')} aria-label={label} title={compact ? label : undefined} disabled={inCart || !available} onClick={() => {
    const result = cart.add(product._id);
    setError(result === 'full' ? l('السلة تستوعب حتى ' + CART_LIMIT + ' منتجاً.', 'La sélection accepte jusqu’à ' + CART_LIMIT + ' produits.', 'The quote cart holds up to ' + CART_LIMIT + ' products.') : ['invalid', 'unavailable'].includes(result) ? l('تعذر حفظ الاختيار في المتصفح.', 'Impossible de conserver la sélection dans ce navigateur.') : '');
  }}>{compact && inCart ? <span aria-hidden="true">✓</span> : <MarketIcon name="package" />}{!compact && label}</button>{error && <p className="atlas-cart-add-status" role="status">{error}</p>}</>;
}
