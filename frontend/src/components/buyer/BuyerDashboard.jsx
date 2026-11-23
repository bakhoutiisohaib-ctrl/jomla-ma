import BrandHomeLink from '../common/BrandHomeLink';
import LanguageSwitch from '../../i18n/LanguageSwitch';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { useSessionToken } from '../../api/session';
import { useTranslation } from '../../i18n/LanguageContext';
import { useLabels, formatMoney, localizeCopy } from '../../i18n/useLabels';
import SourcingModal from '../products/SourcingModal';
import SourcingDecisionCard from './SourcingDecisionCard';
import CommercialAgreement, { agreedProduct } from '../common/CommercialAgreement';
import AtlasDialog from '../common/AtlasDialog';
import { NegotiationMessages, OfferHistory } from '../common/NegotiationUI';
import NotificationCenter from '../common/NotificationCenter';
import { Notice } from '../common/WorkspaceUI';
import { MarketIcon } from '../common/MarketLayout';
import useBuyerWorkspace from './useBuyerWorkspace';
import RfqCreationRecovery from './RfqCreationRecovery';
import '../../styles/atlas-buyer.css';
const copy = {
  ar: {
    title: 'طلباتي وعروض الموردين', back: 'العودة للسوق', refresh: 'تحديث', rfqs: 'طلبات عروض الأسعار', sourcing: 'طلبات التوريد', notifications: 'الإشعارات',
    noRequests: 'لا توجد طلبات بعد. اختر منتجاً من السوق أو أنشئ طلب توريد.', noNotifications: 'لا توجد إشعارات.', newSourcing: 'طلب توريد جديد',
    supplier: 'المورد', quantity: 'الكمية', status: 'الحالة', view: 'العروض والمحادثة', offers: 'سجل العروض', noOffers: 'لم يقدم المورد عرضاً بعد.',
    price: 'سعر الوحدة', total: 'الإجمالي', days: 'التسليم بالأيام', terms: 'شروط الدفع', unspecified: 'لم يحدد المورد', notes: 'الملاحظات',
    accept: 'قبول العرض', reject: 'رفض العرض', messages: 'المحادثة', message: 'رسالتك للمورد', send: 'إرسال', noMessages: 'لا توجد رسائل.',
    closed: 'أغلقت المحادثة بعد اتخاذ القرار.', read: 'تعليم كمقروء', readAll: 'تعليم الكل كمقروء', unread: 'غير مقروء', waiting: 'جاري التحميل…',
    saved: 'تم حفظ التغيير.', processing: 'حُفظ قرارك وجارٍ استكماله.', offering: 'عرض قيد الاستكمال', deciding: 'قرار قيد الاستكمال', pending: 'بانتظار المورد', responded: 'وصل عرض سعر', accepted: 'مقبول', rejected: 'مرفوض', active: 'فعال', superseded: 'عرض سابق', expired: 'منتهي',
    open: 'مفتوح للعروض', quoted: 'مفتوح للعروض', fulfilled: 'تم اختيار عرض', buyer: 'المشتري', error: 'تعذر تحميل البيانات.',
    rfq_created: 'طلب عرض سعر جديد', offer_received: 'وصل عرض سعر', offer_decision: 'تم تحديث قرار العرض', message_received: 'وصلت رسالة جديدة', sourcing_offer: 'وصل عرض توريد', sourcing_decision: 'تم تحديث قرار عرض التوريد',
    reference: 'رقم الطلب', currency: 'العملة', original: 'بيانات الطلب', chosen: 'هذا العرض الحالي الذي سيطبق قرارك عليه.', catalog: 'التصفح والبحث'
  },
  fr: {
    title: 'Mes demandes et offres', back: 'Retour au marché', refresh: 'Actualiser', rfqs: 'Demandes de devis', sourcing: 'Approvisionnement', notifications: 'Notifications',
    noRequests: 'Aucune demande. Choisissez un produit ou créez une demande d’approvisionnement.', noNotifications: 'Aucune notification.', newSourcing: 'Nouvelle demande',
    supplier: 'Fournisseur', quantity: 'Quantité', status: 'État', view: 'Offres et conversation', offers: 'Historique des offres', noOffers: 'Le fournisseur n’a pas encore proposé de prix.',
    price: 'Prix unitaire', total: 'Total', days: 'Délai en jours', terms: 'Conditions de paiement', unspecified: 'Non précisé par le fournisseur', notes: 'Remarques',
    accept: 'Accepter l’offre', reject: 'Refuser l’offre', messages: 'Conversation', message: 'Votre message au fournisseur', send: 'Envoyer', noMessages: 'Aucun message.',
    closed: 'La conversation est fermée après la décision.', read: 'Marquer comme lu', readAll: 'Tout marquer comme lu', unread: 'Non lu', waiting: 'Chargement…',
    saved: 'Modification enregistrée.', processing: 'Décision enregistrée, finalisation en cours.', offering: 'Offre en cours de finalisation', deciding: 'Décision en cours de finalisation', pending: 'En attente du fournisseur', responded: 'Offre reçue', accepted: 'Acceptée', rejected: 'Refusée', active: 'Active', superseded: 'Offre antérieure', expired: 'Expirée',
    open: 'Ouverte aux offres', quoted: 'Ouverte aux offres', fulfilled: 'Offre sélectionnée', buyer: 'Acheteur', error: 'Impossible de charger les données.',
    rfq_created: 'Nouvelle demande de devis', offer_received: 'Nouvelle offre de prix', offer_decision: 'Décision sur une offre', message_received: 'Nouveau message', sourcing_offer: 'Nouvelle offre d’approvisionnement', sourcing_decision: 'Décision sur l’approvisionnement',
    reference: 'Référence', currency: 'Devise', original: 'Détails de la demande', chosen: 'Votre décision porte sur cette offre actuelle.', catalog: 'Parcourir et rechercher'
  }
}

export default function BuyerDashboard(props) {
  const token=useSessionToken();
  return <BuyerContent key={token+':'+(props.user?._id || props.user?.id || '')} {...props} sessionToken={token}/>;
}
function BuyerContent({user,onBack,onLogout,sessionToken}) {
  const {lang}=useTranslation(),l=useLabels();
  const c={...localizeCopy(copy, lang),creating:l('طلب قيد الإنشاء','Demande en cours de création'),unavailable:l('الطلب غير متاح لهذا الحساب.','Demande indisponible pour ce compte.')};
  const w=useBuyerWorkspace(c);
  const [tab,setTab]=useState('rfqs'),[filter,setFilter]=useState('all'),[message,setMessage]=useState(''),[showSourcing,setShowSourcing]=useState(false);
  const [choice,setChoice]=useState(null),[pane,setPane]=useState('offers'),[sourcingTarget,setSourcingTarget]=useState(null);
  const confirmTitle=useRef(null),messageRevision=useRef(0);
  useEffect(()=>{setChoice(null);setMessage('');setPane('offers');messageRevision.current++;},[w.selectedId]);
  useEffect(()=>{if(choice)confirmTitle.current?.focus();},[choice]);
  useEffect(()=>{if(sourcingTarget && tab==='sourcing')document.getElementById('sourcing-'+sourcingTarget)?.scrollIntoView?.({block:'center'});},[sourcingTarget,tab]);
  const selected=w.selected, money=(value,currency)=>value==null?'—':currency?formatMoney(value,currency,lang):value+' '+l('عملة غير محددة','Devise non précisée');
  const statuses=['creating','pending','responded','offering','deciding','accepted','rejected'];
  const shown=w.rfqs.filter(r=>filter==='all' || (filter==='review'?['creating','responded','offering','deciding'].includes(r.status):r.status===filter));
  function closeTrade(){setChoice(null);w.chooseRequest(null);}
  function choose(id){setMessage('');setChoice(null);messageRevision.current++;w.chooseRequest(id);}
  const choiceReady=choice && selected && selected.status==='responded' && String(selected.currentOfferId)===String(choice.offer._id) && w.offers.some(o=>o._id===choice.offer._id && o.status==='active');
  async function confirmDecision(){
    if(!choiceReady || w.busy || w.threadLoading || w.threadError || w.uncertainId===selected._id)return;
    const id=selected._id,offerId=choice.offer._id,action=choice.action;
    await w.run(options=>apiRequest('/rfq/'+id+'/action',{...options,method:'PUT',body:{action,offerId}}),{target:id,decision:true});
    setChoice(null);
  }
  async function send(e){
    e.preventDefault();if(!message.trim() || !selected || w.busy)return;
    const id=selected._id,text=message,revision=messageRevision.current;
    await w.run(async options=>{const result=await apiRequest('/rfq/'+id+'/messages',{...options,method:'POST',body:{content:text}});if(w.valid({signal:options.signal}) && revision===messageRevision.current)setMessage(current=>current===text?'':current);return result;},{target:id});
  }
  async function openNotice(n){
    const type=await w.verifiedNotificationTarget(n);if(!type)return;
    setTab(type==='rfq'?'rfqs':'sourcing');if(type==='sourcing')setSourcingTarget(n.resourceId);
    if(!n.readAt)await w.run(options=>apiRequest('/notifications/'+n._id+'/read',{...options,method:'PUT'}));
  }
  const retry=()=>w.run(options=>apiRequest('/rfq/'+selected._id+'/action',{...options,method:'PUT',body:{action:selected.decision.action,offerId:selected.decision.offerId}}),{target:selected._id,decision:true});
  const errors=Object.values(w.loadErrors).join(' · ');
  return <div className="atlas-buyer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <a className="buyer-skip" href="#buyer-main">{l('تجاوز إلى المحتوى','Aller au contenu')}</a>
    <header className="buyer-header"><BrandHomeLink className="buyer-brand"><span>ج</span><div><strong dir="ltr">jomla.ma</strong><small>{l('مساحة المشتري','Espace acheteur')}</small></div></BrandHomeLink><nav aria-label={l('الحساب واللغة','Compte et langue')}><button onClick={onBack}>{l('السوق','Catalogue')}</button><LanguageSwitch /><button onClick={()=>setTab('notifications')} aria-label={l('تنبيهات الحساب','Alertes du compte')+': '+(w.unread ?? l('غير مؤكد','Non confirmé'))}><MarketIcon name="bell"/>{w.unread>0 && <span className="buyer-bell-count">{w.unread>99?'99+':w.unread}</span>}</button>{onLogout && <button onClick={onLogout}>{l('خروج','Déconnexion')}</button>}</nav><p>{user?.name}</p></header>
    <div className="buyer-shell"><aside className="buyer-sidebar"><p className="buyer-eyebrow">{l('احتياجات تجارتك','Les besoins de votre activité')}</p><nav aria-label={c.title}>{['rfqs','sourcing','notifications'].map(key=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{c[key]}{key==='notifications'?' ('+(w.unread ?? '—')+')':''}</button>)}</nav><p className="muted">{l('قبول عرض لا يعني دفعاً أو شحناً أو تسليماً مكتملًا.','Accepter une offre ne signifie pas qu’un paiement, un envoi ou une livraison a eu lieu.')}</p></aside>
    <main id="buyer-main" tabIndex="-1"><div className="buyer-page-heading"><div><p className="buyer-eyebrow">{l('Jomla.ma · مساحة عملك','Jomla.ma · Votre espace')}</p><h1>{c.title}</h1></div><button disabled={w.busy} onClick={()=>{w.setError('');w.refresh();if(w.selectedId)w.loadThread(w.selectedId);}}>{c.refresh}</button></div>
    {!selected && <><Notice error>{w.error || errors}</Notice><Notice>{w.feedback}</Notice></>}
    {w.loading && <p role="status">{c.waiting}</p>}
    {tab==='rfqs' && <><div className="buyer-stat-grid"><div><span>{l('تحتاج مراجعتك','À examiner')}</span><strong>{w.loading?'—':w.rfqs.filter(r=>['creating','responded','offering','deciding'].includes(r.status)).length}</strong></div><div><span>{c.pending}</span><strong>{w.loading?'—':w.rfqs.filter(r=>r.status==='pending').length}</strong></div><div><span>{l('اتفاقات مقبولة','Accords acceptés')}</span><strong>{w.loading?'—':w.rfqs.filter(r=>r.status==='accepted').length}</strong></div></div>
      <div className="buyer-section-heading"><h2>{c.rfqs}</h2><label>{l('تصفية الحالة','Filtrer par état')}<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">{l('كل الحالات','Tous les états')}</option><option value="review">{l('تحتاج مراجعة أو استكمال','À examiner ou finaliser')}</option>{statuses.map(s=><option key={s} value={s}>{c[s]}</option>)}</select></label></div>
      {!w.loading && !shown.length && <section className="buyer-empty"><h3>{l('لا توجد طلبات بهذه الحالة','Aucune demande dans cet état')}</h3><p>{c.noRequests}</p><button onClick={onBack}>{c.catalog}</button></section>}
      <section className="buyer-request-grid" aria-label={c.rfqs}>{shown.map(r=>{const values=r.decision?.agreement || r.offer;return <article key={r._id} className={'buyer-request status-'+r.status}><div className="buyer-request-heading"><span className="trade-status">{c[r.status] || r.status}</span>{['responded','deciding'].includes(r.status) && <small>{l('يحتاج متابعتك','À suivre')}</small>}</div><h2>{agreedProduct(r)?.name || c.original}</h2><p>{c.supplier}: {r.decision?.agreement?.supplier?.name || r.supplierId?.name || '—'}</p><p>{c.quantity}: {r.decision?.agreement?.quantity ?? r.quantity} {agreedProduct(r)?.unit}</p>{values && <div className="buyer-quote-amount"><strong>{money(values.unitPrice,values.currency || r.currency)}</strong><small>/ {r.decision?.agreement?.unit || agreedProduct(r)?.unit}</small><p>{c.total}: {money(values.totalPrice,values.currency || r.currency)}</p></div>}{r.status==='accepted' && <p className="trade-help">{l('اتفاق تجاري؛ لا توجد حالة دفع أو تسليم في هذا المسار.','Accord commercial ; aucun état de paiement ou de livraison dans ce parcours.')}</p>}{r.status==='creating'?<RfqCreationRecovery id={r._id} onRefresh={w.refresh}/>:<button className={['responded','deciding'].includes(r.status)?'primary':''} disabled={w.busy} onClick={()=>choose(r._id)}>{c.view}</button>}</article>;})}</section>
    </>}
    {tab==='sourcing' && <section className="buyer-sourcing"><div className="buyer-section-heading"><h2>{c.sourcing}</h2><button className="primary" onClick={()=>setShowSourcing(true)}>{c.newSourcing}</button></div>{!w.loading && !w.sourcing.length && <p className="buyer-empty">{c.noRequests}</p>}{w.sourcing.map(s=><SourcingDecisionCard key={s._id} sourcing={s} user={user} sessionToken={sessionToken} busy={w.busy} onUpdated={()=>w.refresh()}/>)}</section>}
    {tab==='notifications' && <NotificationCenter items={w.notifications} unread={w.unread} loading={w.loading} error={w.loadErrors['/notifications']} busy={w.busy || w.opening} onOpen={openNotice} onRead={n=>w.run(options=>apiRequest('/notifications/'+n._id+'/read',{...options,method:'PUT'}))} onReadAll={()=>w.run(options=>apiRequest('/notifications/read-all',{...options,method:'PUT'}))}/>}
    </main></div>
    {selected && <AtlasDialog key={selected._id} title={agreedProduct(selected)?.name || c.original} label={l('العروض والمحادثة','Offres et conversation')} busy={w.busy} onClose={closeTrade}>
      <div className="trade-request-context"><span className="trade-status">{c[selected.status] || selected.status}</span><p>{c.reference}: {selected._id}</p><p>{l('قبول العرض يثبت الاتفاق التجاري فقط؛ لا يؤكد دفعاً أو تسليماً.','Accepter fixe uniquement l’accord commercial ; cela ne confirme ni paiement ni livraison.')}</p></div>
      <Notice error>{w.error || w.threadError || errors}</Notice><Notice>{w.feedback}</Notice>
      {w.uncertainId===selected._id && <div className="trade-uncertain" role="status"><p>{l('تعذر تأكيد نتيجة الطلب. حدّث الحالة قبل اتخاذ قرار آخر. لا نعرض اتفاقاً مكتملاً دون تأكيد الخادم.','Résultat non confirmé. Actualisez l’état avant une autre décision. Aucun accord final n’est affiché sans confirmation du serveur.')}</p><button disabled={w.busy} onClick={()=>{w.refresh();w.loadThread(selected._id);}}>{l('تحديث حالة الطلب','Actualiser la demande')}</button></div>}
      <nav className="trade-mobile-tabs" aria-label={l('أجزاء التفاوض','Sections de négociation')}><button aria-pressed={pane==='offers'} onClick={()=>setPane('offers')}>{l('العرض والاتفاق','Offre et accord')}</button><button aria-pressed={pane==='messages'} onClick={()=>setPane('messages')}>{l('المراسلات','Messages')}</button></nav>
      <div className="trade-negotiation-grid"><aside className="trade-pane" data-active={pane==='offers'}><CommercialAgreement rfq={selected} busy={w.busy} onRetry={retry}/>
        {w.threadLoading && !w.offers.length && <p role="status">{c.waiting}</p>}
        <OfferHistory rfq={selected} offers={w.offers} busy={w.busy} disabled={w.threadLoading || Boolean(w.threadError) || w.uncertainId===selected._id} onChoose={(offer,action)=>setChoice({offer,action})}/>
        {choice && <section className="trade-confirm" role="group" aria-label={l('تأكيد القرار','Confirmer la décision')}><h3 ref={confirmTitle} tabIndex="-1">{choice.action==='accept'?l('تأكيد قبول العرض','Confirmer l’acceptation'):l('تأكيد رفض العرض','Confirmer le refus')}</h3><p>{money(choice.offer.unitPrice,choice.offer.currency)} × {choice.offer.quantity ?? selected.quantity} {choice.offer.productSnapshot?.unit || agreedProduct(selected)?.unit} · {c.total}: {money(choice.offer.totalPrice,choice.offer.currency)}</p><p>{l('هذا قرار نهائي لهذا العرض. راجع الشروط والكمية والعملة قبل التأكيد.','Cette décision est définitive pour cette offre. Vérifiez les conditions, la quantité et la devise.')}</p>{!choiceReady && <Notice error>{l('تغير العرض أو حالة الطلب. حدّث البيانات قبل القرار.','L’offre ou l’état a changé. Actualisez avant de décider.')}</Notice>}<div className="actions"><button className="primary" disabled={!choiceReady || w.busy || w.threadLoading || Boolean(w.threadError) || w.uncertainId===selected._id} onClick={confirmDecision}>{choice.action==='accept'?l('تأكيد قبول العرض','Confirmer l’acceptation'):l('تأكيد رفض العرض','Confirmer le refus')}</button><button disabled={w.busy} onClick={()=>setChoice(null)}>{l('إلغاء القرار','Annuler la décision')}</button></div></section>}
      </aside><section className="trade-pane" data-active={pane==='messages'}>{w.threadLoading && !w.thread && <p role="status">{c.waiting}</p>}<NegotiationMessages messages={w.thread?.messages || []} offers={w.offers} role="buyer"/>
        {['pending','responded'].includes(selected.status) && w.thread?.status!=='closed'?<form className="trade-compose" onSubmit={send}><label htmlFor="buyer-message">{c.message}</label><textarea id="buyer-message" rows="3" required maxLength={5000} value={message} onChange={e=>setMessage(e.target.value)}/><button className="primary" disabled={w.busy || !message.trim() || !w.thread || Boolean(w.threadError)}>{c.send}</button></form>:<p className="trade-help">{selected.status==='offering'?l('عرض المورد قيد الاستكمال؛ انتظر قبل اتخاذ قرار.','L’offre du fournisseur est en cours de finalisation ; patientez avant toute décision.'):selected.status==='deciding'?c.processing:c.closed}</p>}
      </section></div>
    </AtlasDialog>}
    {showSourcing && <SourcingModal sessionToken={sessionToken} user={user} onClose={()=>setShowSourcing(false)} onSuccess={()=>w.refresh()}/>}
  </div>;
}
