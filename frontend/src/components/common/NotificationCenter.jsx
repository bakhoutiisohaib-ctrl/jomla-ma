import {useState} from 'react';
import {useLabels,notificationLabel} from '../../i18n/useLabels';
import {useTranslation} from '../../i18n/LanguageContext';
import {TradeTime} from './NegotiationUI';
import {isDirectNotice} from './DirectConversation';

// Presentational only: the workspace owns loading/polling and account isolation.
export default function NotificationCenter({items,unread,busy,onRead,onReadAll,onOpen,loading,error}) {
  const l=useLabels(),{lang}=useTranslation(),[filter,setFilter]=useState('all');
  const visible=filter==='unread'?items.filter(n=>!n.readAt):items;
  return <section className="buyer-notifications"><div className="buyer-section-heading"><div><h2>{l('مركز الإشعارات','Centre de notifications')}</h2><p className="muted">{l('تنبيهات طلباتك وعروض الموردين، حسب البيانات المسجلة.','Les mises à jour enregistrées de vos demandes et offres.')}</p></div><button disabled={busy || !unread} onClick={onReadAll}>{l('تعليم الكل كمقروء','Tout marquer comme lu')}</button></div>
    <div className="actions"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>{l('الكل','Toutes')}</button><button aria-pressed={filter==='unread'} onClick={()=>setFilter('unread')}>{l('غير مقروء','Non lues')}</button></div>
    {loading && <p role="status">{l('جاري التحميل…','Chargement…')}</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && !visible.length && <p className="buyer-empty">{l('لا توجد إشعارات في هذه القائمة.','Aucune notification dans cette liste.')}</p>}
    {visible.map(n=><article key={n._id} className={'buyer-notification '+(!n.readAt?'unread':'')}><div className="buyer-notification-top"><h3>{lang==='en'?n.titleEn || notificationLabel(n.type,lang):lang==='fr'?n.titleFr || notificationLabel(n.type,lang):n.titleAr || notificationLabel(n.type,lang)}</h3><span className="trade-status">{n.readAt?l('مقروء','Lue'):l('غير مقروء','Non lue')}</span></div><TradeTime value={n.createdAt}/>
      {(lang==='en'?n.bodyEn:lang==='fr'?n.bodyFr:n.bodyAr) && <p>{lang==='en'?n.bodyEn:lang==='fr'?n.bodyFr:n.bodyAr}</p>}<small>{l('النوع','Type')}: {notificationLabel(n.type,lang)}</small>
      <div className="actions"><button disabled={busy || (!['rfq','sourcing'].includes(n.resourceType)&&!isDirectNotice(n))} onClick={()=>onOpen(n)}>{isDirectNotice(n)?l('فتح المحادثة','Ouvrir la conversation','Open conversation'):l('فتح الطلب','Ouvrir la demande')}</button>{!n.readAt && <button disabled={busy} onClick={()=>onRead(n)}>{l('تعليم كمقروء','Marquer comme lu')}</button>}</div>
    </article>)}
    {items.length>=100 && <p className="muted">{l('تعرض الخدمة أحدث 100 إشعار. العداد من الخادم وقد يشمل إشعارات أقدم.','Le service affiche les 100 dernières notifications. Le compteur serveur peut inclure des notifications plus anciennes.')}</p>}
  </section>;
}
