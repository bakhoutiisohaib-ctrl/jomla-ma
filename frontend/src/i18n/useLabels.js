import { useTranslation } from './LanguageContext';
import englishLabels from './englishLabels.json';
export const labelFor = (lang, ar, fr, en) => lang === 'en' ? (en ?? englishLabels[fr] ?? fr) : lang === 'fr' ? fr : ar;
export const localizeCopy = (copy, lang) => lang === 'en' ? Object.fromEntries(Object.entries(copy.fr).map(([key, value]) => [key, englishLabels[value] ?? value])) : copy[lang] || copy.ar;
export const localeFor = lang => lang === 'en' ? 'en-MA' : lang === 'fr' ? 'fr-MA' : 'ar-MA';
export function useLabels() {
  const {
    lang
  } = useTranslation();
  return (ar, fr, en) => labelFor(lang, ar, fr, en);
}
export function statusLabel(status, lang = 'ar') {
  const labels = {
    creating: ['طلب قيد الإنشاء', 'Demande en cours de création'],
    offering: ['عرض قيد الاستكمال', 'Offre en cours de finalisation'],
    preparing: ['عرض غير جاهز بعد', 'Offre pas encore prête'],
    expired: ['منتهي الصلاحية', 'Expiré'],
    pending: ['قيد المراجعة', 'En attente'],
    investigating: ['قيد التحقيق', 'En cours d’examen', 'Under investigation'],
    unverified: ['غير موثق', 'Non vérifié'],
    verified: ['موثق', 'Vérifié'],
    approved: ['معتمد', 'Approuvé'],
    rejected: ['مرفوض', 'Refusé'],
    responded: ['تم تقديم عرض', 'Devis reçu'],
    deciding: ['قرار قيد الاستكمال', 'Décision en cours de finalisation'],
    accepted: ['مقبول', 'Accepté'],
    active: ['فعال', 'Actif'],
    superseded: ['عرض سابق', 'Offre remplacée'],
    open: ['مفتوح', 'Ouvert'],
    quoted: ['مفتوح للعروض', 'Ouverte aux offres', 'Open for offers'],
    fulfilled: ['تم اختيار عرض', 'Offre sélectionnée', 'Offer selected'],
    closed: ['مغلق', 'Fermé'],
    resolved: ['تمت المعالجة', 'Résolu'],
    dismissed: ['محفوظ', 'Classé'],
    invited: ['دعوة معلقة', 'Invitation en attente'],
    revoked: ['ملغاة', 'Révoqué'],
    completed: ['مكتمل', 'Terminé'],
    failed: ['فشل', 'Échec'],
    draft: ['مسودة', 'Brouillon']
  };
  return labels[status] ? labelFor(lang, ...labels[status]) : status || '—';
}
export function formatMoney(value, currency = 'MAD', lang = 'ar') {
  try {
    return new Intl.NumberFormat(localeFor(lang), {
      style: 'currency',
      currency
    }).format(value);
  } catch {
    return String(value) + ' ' + currency;
  }
}
export function notificationLabel(type, lang) {
  const labels = {
    rfq_created: ['طلب عرض سعر جديد', 'Nouvelle demande de devis'],
    offer_received: ['وصل عرض سعر', 'Une offre est arrivée'],
    offer_decision: ['صدر قرار على عرض السعر', 'Décision sur une offre'],
    message_received: ['رسالة جديدة في محادثة الطلب', 'Nouveau message dans la conversation'],
    sourcing_offer: ['عرض جديد على طلب التوريد', 'Nouvelle offre de sourcing'],
    sourcing_decision: ['صدر قرار على عرض التوريد', 'Décision sur une offre de sourcing']
  };
  return labels[type] ? labelFor(lang, ...labels[type]) : type;
}
