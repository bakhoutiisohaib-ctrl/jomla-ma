import { useFavorites, validFavoriteId } from './FavoritesContext';
import { useLabels } from '../../i18n/useLabels';
import { loginPath, navigate, productPath } from '../../navigation';
import { MarketIcon } from '../common/MarketLayout';

export default function FavoriteButton({ product }) {
  const favorites = useFavorites(), l = useLabels();
  if (!favorites || favorites.mode === 'other' || !validFavoriteId(product._id)) return null;
  const saved = favorites.ids?.includes(product._id) === true;
  const guest = favorites.mode === 'guest';
  const retry = favorites.mode === 'buyer' && favorites.status === 'error';
  const ready = favorites.mode === 'buyer' && favorites.status === 'ready';
  const label = guest ? l('سجل الدخول لحفظ المنتج: ', 'Connectez-vous pour enregistrer : ', 'Sign in to save: ')
    : retry ? l('إعادة تحميل المفضلة: ', 'Recharger les favoris : ', 'Reload favorites: ')
    : saved ? l('إزالة من المفضلة: ', 'Retirer des favoris : ', 'Remove from favorites: ')
    : l('إضافة إلى المفضلة: ', 'Ajouter aux favoris : ', 'Add to favorites: ');
  return <button type="button" className="atlas-favorite-heart" title={label + product.name}
    aria-label={label + product.name} aria-pressed={ready ? saved : undefined}
    disabled={favorites.busy || (!guest && !ready && !retry)}
    onClick={() => guest ? navigate(loginPath(productPath(product._id))) : retry ? favorites.refresh() : favorites.toggle(product._id)}>
    <MarketIcon name="heart" />
  </button>;
}
