import { clearSession, getSessionToken } from './session';
import englishLabels from '../i18n/englishLabels.json';
export { clearSession } from './session';
export const API = (process.env.REACT_APP_API_URL || '/api').replace(/\/$/, '');
export function assetUrl(value) {
  // Kept for compatibility. Media references require a Bearer request via ProtectedImage.
  return '';
}
const arabicText = /[\u0600-\u06ff]/;
const frenchMessages = {
  'Invalid value': 'Vérifiez cette valeur.',
  'بيانات الدخول غير صحيحة': 'Adresse e-mail ou mot de passe incorrect.',
  'البريد الإلكتروني موجود بالفعل': 'Cette adresse e-mail est déjà utilisée.',
  'أكمل ملف الشركة أولاً': 'Complétez d’abord le profil de l’entreprise.',
  'الاسم يجب أن يكون حرفين على الأقل': 'Le nom doit contenir au moins 2 caractères.',
  'البريد الإلكتروني غير صحيح': 'Adresse e-mail invalide.',
  'رقم الهاتف غير صحيح': 'Numéro de téléphone invalide.',
  'الوصف يجب أن يحتوي 10 أحرف على الأقل': 'La description doit contenir au moins 10 caractères.',
  'يجب تأكيد حالة التوفر': 'Confirmez la disponibilité du produit.',
  'شرائح الأسعار متداخلة': 'Les paliers de prix se chevauchent.',
  'نهاية شريحة السعر يجب أن تكون أكبر من بدايتها': 'La quantité maximale du palier doit être supérieure ou égale à la quantité minimale.',
  'بداية الشريحة يجب ألا تقل عن MOQ': 'Le début du palier ne doit pas être inférieur à la commande minimum.',
  'النشر يحتاج متجراً مملوكاً ومعتمداً ونشطاً': 'Choisissez une boutique de votre entreprise, approuvée et active pour publier.',
  'صورة المنتج مطلوبة للنشر': 'Ajoutez une image du produit avant de publier.',
  'مرجع ترخيص الصورة مطلوب': 'Renseignez la référence de la licence de l’image.',
  'الكمية أقل من الحد الأدنى للطلب': 'La quantité est inférieure au minimum de commande.',
  'الصورة تتجاوز الحد المسموح (10MB)': 'L’image dépasse la limite de 10 Mo.'
};
const fieldLabels = {
  name: ['الاسم', 'Nom'], category: ['الفئة', 'Catégorie'], description: ['الوصف', 'Description'],
  email: ['البريد الإلكتروني', 'Adresse e-mail'], password: ['كلمة المرور', 'Mot de passe'],
  city: ['المدينة', 'Ville'], phone: ['رقم الهاتف', 'Téléphone'], buyerPhone: ['هاتف التواصل', 'Téléphone de contact'],
  moq: ['الحد الأدنى للطلب', 'Commande minimum'], price: ['السعر', 'Prix'], currency: ['العملة', 'Devise'],
  country: ['البلد', 'Pays'], unit: ['وحدة البيع', 'Unité de vente'], storeId: ['المتجر', 'Boutique'],
  imageUrl: ['الصورة', 'Image'], priceTiers: ['أسعار حسب الكمية', 'Tarifs par quantité'],
  availability: ['التوفر', 'Disponibilité'], hasImageRights: ['حقوق الصورة', 'Droits de l’image'],
  approvedAt: ['اعتماد النشر', 'Approbation de publication'], moderationStatus: ['حالة الإشراف', 'Modération']
};
function requestErrorMessage(data, status, lang) {
  const french = lang === 'fr' || lang === 'en';
  const translate = value => lang === 'en' ? englishLabels[value] || 'Check this value.' : value;
  const fallback = (french ? {
    400: 'Vérifiez les informations obligatoires et les valeurs saisies, puis réessayez.',
    401: 'Connectez-vous pour continuer.', 403: 'Cette opération ne vous est pas autorisée.',
    404: 'Élément introuvable.', 409: 'Les données ont changé ou existent déjà. Actualisez la page.',
    413: 'L’image dépasse la limite de 10 Mo.', 429: 'Trop de demandes. Patientez avant de réessayer.',
    503: 'Service indisponible. Vous pouvez saisir les informations manuellement.'
  } : {
    400: 'تحقق من البيانات الإلزامية والقيم المدخلة ثم حاول مجدداً.',
    401: 'سجل الدخول للمتابعة.', 403: 'ليست لديك صلاحية تنفيذ هذه العملية.',
    404: 'العنصر المطلوب غير موجود.', 409: 'تغيرت البيانات أو أنها موجودة بالفعل. حدّث الصفحة.',
    413: 'الصورة تتجاوز الحد المسموح (10MB).', 429: 'طلبات كثيرة. انتظر قليلاً قبل إعادة المحاولة.',
    503: 'الخدمة غير متاحة حالياً. يمكنك إدخال المعلومات يدوياً.'
  })[status] || (french ? 'Requête refusée. Vérifiez les informations saisies.' : 'تعذر تنفيذ الطلب. راجع البيانات وحاول مجدداً.');
  const localize = (value, alternate) => {
    if (typeof value !== 'string' || !value.trim()) return alternate;
    if (french && frenchMessages[value]) return frenchMessages[value];
    if (/^(?:Path `|Cast to |Invalid value|Validator failed)/.test(value)) return alternate;
    return arabicText.test(value) === !french ? value : alternate;
  };
  const details = Array.isArray(data.errors) ? data.errors.slice(0, 5).map(item => {
    const field = typeof item?.field === 'string' ? item.field.split('.')[0] : '';
    const label = fieldLabels[field]?.[french ? 1 : 0] || (french ? 'Champ à corriger' : 'حقل يحتاج تصحيحاً');
    const message = localize(item?.message, french ? 'Vérifiez cette valeur.' : 'راجع هذه القيمة.');
    return label + (french ? ' : ' : ': ') + message;
  }) : [];
  if (lang === 'en') {
    const message = frenchMessages[data.message] || fallback;
    const englishDetails = Array.isArray(data.errors) ? data.errors.slice(0, 5).map(item => {
      const field = typeof item?.field === 'string' ? item.field.split('.')[0] : '';
      return translate(fieldLabels[field]?.[1] || 'Champ à corriger') + ': ' + translate(frenchMessages[item?.message] || 'Vérifiez cette valeur.');
    }) : [];
    return [translate(message), ...englishDetails].join('\n');
  }
  return [localize(data.message, fallback), ...details].join('\n');
}
export async function apiRequest(path, {
  method = 'GET',
  body,
  signal,
  token,
  ...options
} = {}) {
  const auth = token ?? getSessionToken();
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  let response;
  try {
    response = await fetch(API + path, {
    ...options,
    method,
    signal,
    headers: {
      ...(auth ? {
        Authorization: 'Bearer ' + auth
      } : {}),
      ...(!multipart && body ? {
        'Content-Type': 'application/json'
      } : {}),
      ...options.headers
    },
    ...(body ? {
      body: multipart ? body : JSON.stringify(body)
    } : {})
    });
  } catch (cause) {
    if (cause.name === 'AbortError') throw cause;
    const lang = localStorage.getItem('jomla_lang');
    const error = new Error(lang === 'en' ? 'Cannot connect to the server. Check your connection and try again.' : lang === 'fr' ? 'Connexion au serveur impossible. Vérifiez votre connexion puis réessayez.' : 'تعذر الاتصال بالخادم. تحقق من اتصالك ثم حاول مجدداً.');
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth) clearSession(auth);
    const lang = localStorage.getItem('jomla_lang');
    const error = new Error(requestErrorMessage(data, response.status, lang));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
