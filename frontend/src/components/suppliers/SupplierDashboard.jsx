import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import ProtectedImage from '../common/ProtectedImage';
import CommercialAgreement, { agreedProduct } from '../common/CommercialAgreement';
import AtlasDialog from '../common/AtlasDialog';
import { NegotiationMessages, OfferHistory } from '../common/NegotiationUI';
import { useLabels, formatMoney, statusLabel, notificationLabel } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { Field, Notice } from '../common/WorkspaceUI';
import OrganizationPanel from './OrganizationPanel';
import StoresPanel from './StoresPanel';
import ProductEditor from './ProductEditor';
import WholesaleWorkspace from '../wholesale/WholesaleWorkspace';
import SupplierVerificationPanel from './SupplierVerificationPanel';
import JobsPanel from './JobsPanel';
import { SupplierHeader, SupplierSidebar, advancedSupplierTabs } from './SupplierWorkspace';
import SupplierSetupGuide from './SupplierSetupGuide';
import SupplierOfferForm from './SupplierOfferForm';
import SourcingOfferForm from './SourcingOfferForm';
import SourcingQuoteTerms from '../common/SourcingQuoteTerms';
import useSupplierRejection from './useSupplierRejection';
import { getSessionToken, useSessionToken } from '../../api/session';
export default function SupplierDashboard({
  supplier,
  onLogout,
  onBack,
  onGoAdmin
}) {
  const l = useLabels(),
    {
      lang
    } = useTranslation();
  const [profile, setProfile] = useState(supplier),
    [tab, setTab] = useState('overview'),
    [revision, setRevision] = useState(0);
  const [advanced, setAdvanced] = useState(false), [loadedMetrics, setLoadedMetrics] = useState({}), [storeTotal, setStoreTotal] = useState(null);
  const [products, setProducts] = useState([]),
    [stores, setStores] = useState([]),
    [rfqs, setRfqs] = useState([]),
    [sourcing, setSourcing] = useState([]),
    [reviews, setReviews] = useState([]);
  const [notifications, setNotifications] = useState([]),
    [analytics, setAnalytics] = useState(null);
  const [unreadTotal, setUnreadTotal] = useState(null);
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0),
    [editing, setEditing] = useState(null);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [recoveredDraft, setRecoveredDraft] = useState(null);
  const [pendingTab, setPendingTab] = useState(null);
  const [offerCloseBlocked, setOfferCloseBlocked] = useState(false);
  const [drafts, setDrafts] = useState([]), [draftLoading, setDraftLoading] = useState(false), [draftReady, setDraftReady] = useState(false), [failedJobs, setFailedJobs] = useState(null);
  const [selected, setSelected] = useState(null),
    [thread, setThread] = useState(null),
    [text, setText] = useState('');
  const [quoteRecord, setQuoteTarget] = useState(null);
  const [sourcingSession, setSourcingSession] = useState('');
  const liveSession = useSessionToken();
  const quoteTarget = sourcingSession === liveSession ? quoteRecord : null;
  const [sourcingCloseBlocked, setSourcingCloseBlocked] = useState(false);
  const sourcingContext = useRef({ active: true, generation: 0, controller: null });
  useEffect(() => { const context = sourcingContext.current; context.active = true; return () => { context.active = false; context.generation++; context.controller?.abort(); } }, []);
  const can = useCallback(permission => ['supplier', 'admin'].includes(profile.role) || profile.permissions?.includes(permission), [profile.role, profile.permissions]);
  const conversationRevision = useRef(0);
  const conversation = useRef({id:null,read:null,write:null,uncertain:false});
  const [threadLoading,setThreadLoading] = useState(false), [threadError,setThreadError] = useState('');
  const [sendBusy,setSendBusy] = useState(false);
  const labels = useRef(l); labels.current=l;
  useEffect(()=>{
    const c=conversation.current;
    return ()=>{c.id=null;c.read?.abort();c.write?.abort();conversationRevision.current++;};
  },[liveSession]);
  const rejection = useSupplierRejection({ rfqId: selected?._id, progress: thread?.rejection, status: selected?.status,
    onUpdated: result => {
      conversationRevision.current += 1;
      setSelected(current => current?._id === result.rfq?._id ? { ...current, status: result.rfq.status, revision: result.rfq.revision } : current);
      setThread(current => current ? { ...current, rejection: result.rejection } : current);
      refresh();
    } });
  const refreshConversation = useCallback(async (id,explicit=false) => {
    const c=conversation.current;
    if (c.id!==id || c.write || (c.uncertain && !explicit)) return;
    const revision = ++conversationRevision.current, token = getSessionToken();
    c.read?.abort(); const controller=new AbortController(); c.read=controller;
    const valid=()=>c.id===id && revision===conversationRevision.current && !controller.signal.aborted && token===getSessionToken();
    setThreadLoading(true);
    try {
      const result=await apiRequest('/rfq/' + id + '/thread', {token,signal:controller.signal,cache:'no-store'});
      if(!valid())return;
      if(!result || (result.rfq && result.rfq._id!==id) || (result.thread?.rfqId && String(result.thread.rfqId)!==id))
        throw new Error(labels.current('بيانات المحادثة غير مطابقة للطلب.','Conversation non conforme à la demande.','Conversation does not match this request.'));
      if(!result.thread) throw new Error(labels.current('المحادثة غير متاحة حالياً.','Conversation indisponible.','Conversation unavailable.'));
      setThread(result);setThreadError('');c.uncertain=false;
      if(result.rfq) setSelected(current=>current?._id===id?{
        ...current,status:result.rfq.status,decision:result.rfq.decision,currentOfferId:result.rfq.currentOfferId,
        offer:result.rfq.offer,revision:result.rfq.revision
      }:current);
    }catch(error){if(valid())setThreadError(error.message);}
    finally{if(c.read===controller)c.read=null;if(valid())setThreadLoading(false);}
  }, []);
  useEffect(() => {
    const id = selected?._id;
    if (!id) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshConversation(id).catch(e => setError(e.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [selected?._id, refreshConversation]);
  const refresh = () => setRevision(n => n + 1);
  useEffect(() => {
    let active = true;
    apiRequest('/suppliers/me/profile').then(d => {
      if (active) {
        setProfile(d);
      }
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setError('');
    const tasks = [];
    const token = getSessionToken();
    setLoadedMetrics({});
    const fetchInto = (path, setter, metric) => tasks.push(apiRequest(path,{token}).then(data => {
      if (active && token === getSessionToken()) {
        setter(data);
        if (metric) setLoadedMetrics(previous => ({...previous,[metric]:true}));
      }
    }));
    if (can('manage_store') || can('manage_products')) fetchInto('/stores/mine?limit=100', d => {setStores(d.data || []);setStoreTotal(Number.isSafeInteger(d.pagination?.total) && d.pagination.total>=0 ? d.pagination.total : null);}, 'stores');
    if (can('manage_products') && tab !== 'drafts') fetchInto('/products/mine?page=' + page + '&limit=12', d => {
      if (!Array.isArray(d.data) || !Number.isSafeInteger(d.pagination?.pages) || d.pagination.pages<0) throw new Error('Invalid private product list');
      setProducts(d.data);
      setPages(d.pagination?.pages || 1);
      setTotal(Number.isSafeInteger(d.pagination?.total) && d.pagination.total>=0 ? d.pagination.total : null);
    }, 'products');
    if (tab === 'overview' && can('manage_products')) fetchInto('/jobs/mine?status=failed&limit=1', d => setFailedJobs(d.pagination?.total ?? null),'jobs');
    if (can('manage_rfq')) {
      fetchInto('/rfq/supplier', d => {if(!Array.isArray(d.data)) throw new Error('Invalid RFQ list');setRfqs(d.data);},'rfq');
      fetchInto('/sourcing?status=open', d => setSourcing(d.data || []));
    }
    fetchInto('/notifications?limit=50', d => {setNotifications(d.data || []);setUnreadTotal(Number.isSafeInteger(d.unreadCount) && d.unreadCount>=0 ? d.unreadCount : null);},'notifications');
    if (['overview', 'reviews'].includes(tab) && profile.role === 'supplier') fetchInto('/suppliers/me/reviews', d => setReviews(d.data || []));
    if (tab === 'overview' && can('manage_products')) fetchInto('/suppliers/me/analytics', setAnalytics);
    Promise.allSettled(tasks).then(results => {
      if (active) {
        const fail = results.find(r => r.status === 'rejected');
        if (fail) setError(fail.reason.message);
      }
    });
    return () => {
      active = false;
    };
  }, [can, page, tab, revision, profile.role]);
  useEffect(() => {
    if (tab !== 'notifications') return;
    let active = true, controller;
    const token = getSessionToken();
    const timer = setInterval(() => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const current = () => active && !signal.aborted && token === getSessionToken();
      apiRequest('/notifications?limit=50',{token,signal,cache:'no-store'}).then(d => {
        if (current()) {
          setNotifications(d.data || []);
          setUnreadTotal(Number.isSafeInteger(d.unreadCount) && d.unreadCount>=0 ? d.unreadCount : null);
          setLoadedMetrics(previous=>({...previous,notifications:true}));
        }
      }).catch(e => {if(current()){setUnreadTotal(null);setError(e.message);}});
    }, 30000);
    return () => {active=false;controller?.abort();clearInterval(timer);};
  }, [tab]);
  useEffect(() => {
    if (tab !== 'drafts' || !can('manage_products')) return;
    const controller = new AbortController(); let active = true;
    const token = getSessionToken();
    const current = () => active && !controller.signal.aborted && token === getSessionToken();
    setDraftLoading(true); setDraftReady(false); setDrafts([]);
    async function load() {
      const collected = []; let number = 1, count = null;
      do {
        const result = await apiRequest('/products/mine?page=' + number + '&limit=100', { token, signal: controller.signal, cache:'no-store' });
        if (!current()) return;
        const pages = result.pagination?.pages;
        if (!Array.isArray(result.data) || !Number.isSafeInteger(pages) || pages<0 || (count!==null && count!==pages))
          throw new Error('Unconfirmed private draft pagination');
        collected.push(...result.data.filter(p => p.isDraft));
        count = pages; number++;
      } while (number <= count);
      if (current()) {
        setDrafts([...new Map(collected.map(p => [p._id, p])).values()]);
        setDraftReady(true);
      }
    }
    load().catch(e => { if (current() && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (current()) setDraftLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [tab, revision, can, liveSession]);
  async function action(fn, success) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      if (success) setMessage(success);
      refresh();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openThread(rfq) {
    const c=conversation.current;
    if(c.write)return;
    c.read?.abort();c.id=rfq._id;c.uncertain=false;
    setSelected(rfq);setThread(null);setText('');setThreadError('');
    await refreshConversation(rfq._id);
  }
  async function openSourcing(id) {
    const context = sourcingContext.current, revision = ++context.generation, token = getSessionToken();
    context.controller?.abort(); context.controller = new AbortController();
    const valid = () => context.active && revision === context.generation && token === getSessionToken();
    try { const data = await apiRequest('/sourcing/'+id, { token, signal: context.controller.signal, cache: 'no-store' });
      if (valid()) { if(data?._id && data._id!==id)throw new Error(l('بيانات الطلب غير مطابقة.','Demande non conforme.','Request mismatch.')); setSourcingSession(token); setQuoteTarget({ ...data, _id: data._id || id }); setTab('sourcing'); setError(''); setMessage(''); }
    } catch(e) { if (valid() && e.name !== 'AbortError') setError(e.message); }
  }
  async function sendMessage(e) {
    e.preventDefault();
    const c=conversation.current, id=selected?._id, token=getSessionToken();
    if(!id || c.id!==id || !token || c.write || c.uncertain || busy || threadLoading || threadError || !thread?.thread ||
       thread.thread.status==='closed' || rejection.blocked || offerCloseBlocked || thread.offerSubmission ||
       !['pending','responded'].includes(selected.status) || !text.trim())return;
    const controller=new AbortController();c.write=controller;
    const valid=()=>c.id===id && !controller.signal.aborted && token===getSessionToken();
    setSendBusy(true);setError('');let acknowledged=false;
    try{
      const result=await apiRequest('/rfq/'+id+'/messages',{method:'POST',body:{content:text},token,signal:controller.signal});
      if(!valid())return;
      if(!result?.thread || String(result.thread.rfqId)!==id)throw new Error(l('لم يتأكد إرسال الرسالة. تحقق من المحادثة قبل إعادة الإرسال.','Envoi non confirmé. Vérifiez la conversation avant de renvoyer.','Message unconfirmed. Check the conversation before resending.'));
      setText('');acknowledged=true;
    }catch(error){if(valid()){c.uncertain=true;setThreadError(error.message);}}
    finally{
      if(c.write===controller)c.write=null;
      if(valid()){setSendBusy(false);if(acknowledged)await refreshConversation(id);}
    }
  }
  const unread = loadedMetrics.notifications && unreadTotal!=null ? unreadTotal : '—';
  const metric = (key,value) => loadedMetrics[key] && value!=null ? value : '—';
  const wholesaleTab = ['wholesale', l('فرص الجملة', 'Opportunités de gros'), can('manage_products')];
  const tabs = [['overview', l('نظرة عامة', 'Vue d’ensemble'), true], ['organization', l('الشركة والفريق', 'Entreprise et équipe'), true], ['stores', l('متاجري', 'Mes boutiques'), can('manage_store')], ['products', l('منتجاتي', 'Mes produits'), can('manage_products')], ['drafts', l('المسودات', 'Brouillons'), can('manage_products')], ['add', l('إضافة منتج', 'Ajouter un produit'), can('manage_products')], ['jobs', l('مهام الصور', 'Tâches des images'), can('manage_products')], ['rfq', l('طلبات الأسعار', 'Demandes de devis'), can('manage_rfq')], ['sourcing', l('فرص التوريد', 'Opportunités de sourcing'), can('manage_rfq')], ['verification', l('توثيق المورد', 'Vérification'), profile.role === 'supplier'], ['reviews', l('التقييمات', 'Avis'), profile.role === 'supplier'], ['notifications', l('الإشعارات', 'Notifications') + ' (' + unread + ')', true]];
  tabs.splice(tabs.findIndex(([key]) => key === 'drafts'), 0, wholesaleTab);
  function moveTab(key) {
    setPendingTab(null);
    if (key === 'market') { onBack?.(); return; }
    if(advancedSupplierTabs.includes(key)) setAdvanced(true);
    setTab(key); setPage(1); setError(''); setMessage('');
    if (key === 'add') { setEditing(null); setRecoveredDraft(null); }
  }
  function chooseTab(key) {
    if (key === tab) return;
    if (tab === 'add') { setPendingTab(key); return; }
    moveTab(key);
  }
  function changeMode(value) {
    setAdvanced(value);
    if (!value && advancedSupplierTabs.includes(tab)) moveTab('overview');
  }
  const listReady = tab === 'drafts' ? draftReady && !draftLoading : Boolean(loadedMetrics.products);
  const listProducts = !listReady ? [] : tab === 'drafts' ? drafts.slice((page - 1) * 12, page * 12) : products;
  const listPages = tab === 'drafts' ? Math.ceil(drafts.length / 12) : pages;
  useEffect(()=>{if (['products','drafts'].includes(tab) && listReady && page>Math.max(1,listPages)) setPage(Math.max(1,listPages));},[tab,listReady,page,listPages]);
  return <div className="atlas-supplier"><SupplierHeader profile={profile} unread={unread} onNotifications={() => chooseTab('notifications')} onBack={() => chooseTab('market')} onLogout={onLogout}>{profile.role === 'admin' && <button onClick={onGoAdmin}>{l('الإشراف', 'Administration')}</button>}</SupplierHeader>
    <div className="supplier-shell"><SupplierSidebar tabs={tabs} tab={tab} onTab={chooseTab} advanced={advanced} onModeChange={changeMode} /><main id="supplier-main" tabIndex="-1" className="supplier-content">
    <div className="supplier-page-heading"><div><p className="supplier-eyebrow">{l('Jomla.ma · مساحة عملك', 'Jomla.ma · Votre espace')}</p><h1>{tabs.find(([key])=>key===tab)?.[1]}</h1></div><div className="actions">{tab!=='add' && <button disabled={busy} onClick={refresh}>{l('تحديث مساحة العمل','Actualiser l’espace')}</button>}{can('manage_products') && tab !== 'add' && <button className="primary" onClick={()=>chooseTab('add')}>{l('إضافة منتج جديد','Créer un produit')}</button>}</div></div>
    {pendingTab && <section className="supplier-leave-warning" role="alert"><strong>{l('احفظ مسودتك قبل المغادرة','Enregistrez votre brouillon avant de quitter')}</strong><p>{l('ستفقد المدخلات غير المحفوظة إذا غادرت المحرر. يمكنك البقاء وحفظ مسودة، أو المغادرة دون حفظ.', 'Les saisies non enregistrées seront perdues. Restez pour enregistrer un brouillon, ou quittez sans enregistrer.')}</p><div className="actions"><button onClick={()=>setPendingTab(null)}>{l('البقاء في المحرر','Rester dans l’éditeur')}</button><button onClick={()=>moveTab(pendingTab)}>{l('مغادرة دون حفظ','Quitter sans enregistrer')}</button></div></section>}
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    {tab === 'wholesale' && can('manage_products') && <><h2>{wholesaleTab[1]}</h2><WholesaleWorkspace /></>}
    {tab === 'overview' && <section className="supplier-attention panel"><div><p className="supplier-eyebrow">{l('ابدأ بالأهم','Vos priorités')}</p><h2>{l('ما يحتاج متابعتك','À suivre')}</h2><p className="muted">{l('راجع الطلبات والمسودات ومهام الصور قبل النشر. لا يُنشر أي منتج تلقائياً.', 'Suivez les demandes, les brouillons et les images. Aucun produit n’est publié automatiquement.')}</p></div><div className="supplier-priorities">{can('manage_rfq') && <button onClick={()=>chooseTab('rfq')}><strong>{metric('rfq',rfqs.filter(r=>['pending','responded','offering'].includes(r.status)).length)}</strong>{l('طلبات أسعار مفتوحة','Demandes de devis ouvertes')}</button>}{can('manage_products') && <><button onClick={()=>chooseTab('drafts')}><strong>↗</strong>{l('مراجعة المسودات','Vérifier les brouillons')}</button><button onClick={()=>chooseTab('jobs')}><strong>{metric('jobs',failedJobs)}</strong>{l('مهام صور فاشلة','Tâches d’images en échec')}</button><button onClick={()=>chooseTab('products')}><strong>↗</strong>{l('مراجعة حالة المنتجات','Vérifier les produits')}</button></>}</div><p className="supplier-help">{l('اعتماد المتجر الإداري يتيح النشر. توثيق المورد اختياري ولا يضمن جودة المنتج أو الاتفاق.', 'L’approbation administrative de la boutique permet la publication. La vérification du fournisseur reste facultative et ne garantit ni produit ni accord.')}</p></section>}
    {tab === 'overview' && <section className="panel"><h2>{l('مساحة المورد', 'Espace fournisseur')}</h2><p className="muted">{l('الخطوات: ملف الشركة ← متجر ومراجعة الإدارة ← صورة وبيانات المنتج ← اعتماد النشر.', 'Parcours : entreprise → boutique et approbation → image et données produit → publication confirmée.')}</p><div className="stat-grid"><div className="stat">{l('منتجاتي', 'Mes produits')}<strong>{can('manage_products') ? metric('products',total) : '—'}</strong></div><div className="stat">{l('طلبات الأسعار', 'Demandes de devis')}<strong>{can('manage_rfq') ? metric('rfq',rfqs.length) : '—'}</strong></div><div className="stat">{l('المتاجر', 'Boutiques')}<strong>{can('manage_store') || can('manage_products') ? metric('stores',storeTotal) : '—'}</strong></div></div><p>{l('التوثيق التجاري الاختياري', 'Vérification commerciale facultative')}: {statusLabel(profile.verificationStatus, lang)}</p>{profile.role === 'staff' && !profile.organizationId && <Notice>{l('حساب الموظف يحتاج قبول دعوة من مالك الشركة قبل إدارة المنتجات أو العروض.', 'Acceptez une invitation du propriétaire avant de gérer produits et devis.')}</Notice>}{advanced && analytics?.categoryStats?.length > 0 && <details><summary>{l('إحصاءات الكتالوج حسب الفئة', 'Statistiques du catalogue par catégorie')}</summary>{analytics.categoryStats.map(s => <p key={s._id}>{s._id || l('بدون فئة','Sans catégorie')}: {s.count} · {l('متوسط السعر', 'Prix moyen')}: {s.avgPrice == null ? '—' : Number(s.avgPrice).toFixed(2)}</p>)}</details>}</section>}
    {tab === 'overview' && <SupplierSetupGuide can={can} onTab={chooseTab} />}
    {tab === 'organization'  && <OrganizationPanel profile={profile} onChanged={refresh} />}
    {tab === 'stores' && can('manage_store') && <StoresPanel stores={stores} ready={Boolean(loadedMetrics.stores)} city={profile.city} onChanged={refresh} />}
    {tab === 'jobs' && can('manage_products') && <JobsPanel onReview={draft => { setEditing(null); setRecoveredDraft(draft); setTab('add'); }} />}
    {tab === 'add' && can('manage_products') && <ProductEditor key={editing?._id || recoveredDraft?.jobId || 'new'} product={editing} initialDraft={recoveredDraft} stores={stores} city={profile.city} onCancel={() => chooseTab('products')} onSaved={draft => {
        setPendingTab(null);
        setMessage(draft ? l('حفظت المسودة الخاصة', 'Brouillon privé enregistré') : l('نشر المنتج بعد اعتمادك', 'Produit publié après confirmation'));
        setTab('products');
        refresh();
      }} />}
    {['products','drafts'].includes(tab) && can('manage_products') && <section className="panel"><h2>{tab==='drafts'?l('مسوداتك الخاصة','Vos brouillons privés'):l('منتجاتي المنشورة والمسودات', 'Mes produits publiés et brouillons')}</h2>{draftLoading && tab==='drafts' && <p role="status">{l('جارٍ جمع مسوداتك الخاصة…','Chargement de vos brouillons privés…')}</p>}<div className="product-grid">{listProducts.map(p => <article key={p._id} className="product-card"><ProtectedImage value={p.imageUrl} alt={p.name} /><div className="product-body"><h3>{p.name || l('مسودة بلا عنوان', 'Brouillon sans titre')}</h3><p><span className="badge">{p.isDraft ? l('مسودة خاصة', 'Brouillon privé') : l('منشور', 'Publié')}</span> {p.moderationStatus === 'hidden' && <span className="badge amber">{l('محجوب إشرافياً', 'Masqué par la modération')}</span>}</p><p>{p.pricingMode === 'on_request' ? l('السعر عند الطلب', 'Prix sur demande') : formatMoney(p.price, p.currency, lang)}</p><p>MOQ: {p.moq} {p.unit}</p><div className="actions"><button onClick={() => {
                  setEditing(p);
                  setTab('add');
                }}>{l('تعديل ومراجعة', 'Modifier et vérifier')}</button><button className="danger" disabled={busy} onClick={() => {
                  if (window.confirm(l('حذف هذا المنتج؟', 'Supprimer ce produit ?'))) action(() => apiRequest('/products/' + p._id, {
                    method: 'DELETE'
                  }));
                }}>{l('حذف', 'Supprimer')}</button></div></div></article>)}</div>{!listReady && !draftLoading && <p role="status">{l("قائمة المنتجات غير مؤكدة. حدّث مساحة العمل قبل التعديل.", "Liste des produits non confirmée. Actualisez avant de modifier.", "Product list unconfirmed. Refresh before editing.")}</p>}{listReady && !listProducts.length && <p className="empty">{tab==='drafts'?l('لا توجد مسودات محفوظة.','Aucun brouillon enregistré.'):l('لا توجد منتجات بعد. أنشئ متجرك ثم أضف المنتج.', 'Aucun produit. Créez une boutique puis ajoutez votre produit.')}</p>}<div className="pager"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{l('السابق', 'Précédent')}</button><span>{page}/{Math.max(1, listPages)}</span><button disabled={page >= listPages} onClick={() => setPage(p => p + 1)}>{l('التالي', 'Suivant')}</button></div></section>}
    {tab === 'rfq' && can('manage_rfq') && <section className="panel"><div className="actions"><h2>{l('طلبات الأسعار الواردة', 'Demandes de devis reçues')}</h2><button onClick={refresh}>{l('تحديث', 'Actualiser')}</button></div>{rfqs.map(r => <article className="panel" key={r._id}><h3>{agreedProduct(r)?.name}</h3><p>{r.buyerName} · {r.decision?.agreement?.quantity ?? r.quantity} {agreedProduct(r)?.unit}</p><span className="badge">{statusLabel(r.status, lang)}</span>{r.offer && <p>{formatMoney(r.decision?.agreement?.unitPrice ?? r.offer.unitPrice, r.decision?.agreement?.currency || r.currency || 'MAD', lang)} × {r.decision?.agreement?.quantity ?? r.quantity}</p>}<button disabled={!loadedMetrics.rfq} onClick={() => openThread(r)}>{l('تفاصيل ومحادثة', 'Détails et conversation')}</button></article>)}{!loadedMetrics.rfq && <p role="status">{l('قائمة الطلبات غير مؤكدة. حدّث مساحة العمل.','Demandes non confirmées. Actualisez.','Request list unconfirmed. Refresh.')}</p>}{loadedMetrics.rfq && !rfqs.length && <p className="empty">{l('لا توجد طلبات', 'Aucune demande')}</p>}</section>}
    {tab === 'sourcing' && can('manage_rfq') && <section className="panel"><h2>{l('طلبات توريد مفتوحة', 'Demandes de sourcing ouvertes')}</h2>{sourcing.map(s => <article className="panel" key={s._id}><h3>{s.productName}</h3><p>{s.quantity} {s.unit} · {s.buyerCity}</p><p>{s.notes}</p><p>{l('عدد العروض', 'Nombre d’offres')}: {s.quotesCount}</p><button onClick={() => openSourcing(s._id)}>{s.offerRecovery ? l('استكمال العرض المحفوظ', 'Reprendre l’offre enregistrée') : l('تقديم عرض محفوظ', 'Soumettre une offre')}</button></article>)}</section>}
    {tab === 'verification' && profile.role === 'supplier' && <SupplierVerificationPanel owner={profile._id || profile.id} onConfirmed={saved=>setProfile(saved)}/>}
    {tab === 'reviews' && <section className="panel"><h2>{l('تقييمات العملاء', 'Avis clients')}</h2>{reviews.map(r => <article className="panel" key={r._id}><strong>{r.userName || r.buyerName || r.name}</strong><p>{'★'.repeat(r.stars || 0)} {r.comment}</p>{r.reply?.text && <p className="notice">{r.reply.text}</p>}<form className="actions" onSubmit={e => {
            e.preventDefault();
            const input = e.currentTarget.elements.reply;
            action(() => apiRequest('/suppliers/me/reviews/' + r._id + '/reply', {
              method: 'POST',
              body: {
                text: input.value
              }
            }));
          }}><input aria-label={l('رد على التقييم', 'Réponse à l’avis')} name="reply" required /><button disabled={busy}>{l('رد', 'Répondre')}</button></form></article>)}{!reviews.length && <p>{l('لا توجد تقييمات', 'Aucun avis')}</p>}</section>}
    {tab === 'notifications' && <section className="panel"><div className="actions"><h2>{l('الإشعارات', 'Notifications')}</h2><button onClick={() => action(() => apiRequest('/notifications/read-all', {
            method: 'PUT'
          }))}>{l('تحديد الكل كمقروء', 'Tout marquer comme lu')}</button><button onClick={refresh}>{l('تحديث', 'Actualiser')}</button></div>{notifications.map(n => <article className="message" key={n._id}><p>{lang === 'en' ? n.titleEn || notificationLabel(n.type, lang) : lang === 'fr' ? n.titleFr || n.title || notificationLabel(n.type, lang) : n.titleAr || n.title || notificationLabel(n.type, lang)}</p><p>{lang === 'en' ? n.bodyEn : lang === 'fr' ? n.bodyFr || n.body || n.message : n.bodyAr || n.body || n.message}</p><button onClick={() => {
            if (n.resourceType === 'rfq') {
              const rfq = rfqs.find(r => r._id === n.resourceId);
              if (rfq) {
                setTab('rfq');
                openThread(rfq);
              }
            } else openSourcing(n.resourceId);
          }}>{l('فتح الطلب', 'Ouvrir la demande')}</button>{!n.readAt && <button onClick={() => action(() => apiRequest('/notifications/' + n._id + '/read', {
            method: 'PUT'
          }))}>{l('قرأت', 'Marquer comme lu')}</button>}</article>)}</section>}
    </main></div>
    {(selected || quoteTarget) && <AtlasDialog title={selected ? agreedProduct(selected)?.name : quoteTarget.productName} label={l('تفاصيل التفاوض', 'Détails de négociation')} busy={busy || sendBusy || offerCloseBlocked || rejection.loading || sourcingCloseBlocked} onClose={() => {
              conversation.current.id=null;conversation.current.read?.abort();conversation.current.write?.abort();conversationRevision.current += 1;
              setSelected(null);
              setQuoteTarget(null);
            }}><Notice error>{error}</Notice>
      {selected && rejection.phase !== 'idle' && <section className="trade-uncertain">
        <p role="status">{rejection.phase === 'completed' ? l('اكتمل رفض الطلب وحفظ آثاره.', 'Refus finalisé et effets enregistrés.')
          : rejection.phase === 'pending' ? l('نية الرفض محفوظة وقيد الاستكمال؛ الرفض ليس نهائياً بعد.', 'Refus enregistré, finalisation en cours ; il n’est pas encore définitif.')
          : l('نتيجة الرفض غير محسومة. استكمل الطلب نفسه للتحقق.', 'Résultat du refus incertain. Reprenez la même demande pour vérifier.')}</p>
        {rejection.error && <p role="alert">{rejection.error}</p>}
        {rejection.phase !== 'completed' && <button type="button" disabled={rejection.loading || rejection.waiting || threadLoading || Boolean(threadError)} onClick={rejection.submit}>{l('استكمال رفض الطلب', 'Reprendre le refus')}</button>}
      </section>}
      {selected && thread && <div className="trade-negotiation-grid"><aside className="trade-pane"><CommercialAgreement rfq={selected} /><OfferHistory rfq={selected} offers={thread.offers || []}/></aside><section className="trade-pane"><NegotiationMessages messages={thread.thread?.messages || []} offers={thread.offers || []} role="supplier"/>{['pending', 'responded'].includes(selected.status) && <form className="trade-compose" onSubmit={sendMessage}><Field label={l('رسالتك', 'Votre message')} value={text} disabled={sendBusy} required maxLength={4000} onChange={e => setText(e.target.value)} /><button disabled={busy || sendBusy || threadLoading || Boolean(threadError) || rejection.blocked || offerCloseBlocked || Boolean(thread.offerSubmission) || thread.thread?.status==='closed' || !text.trim()}>{l('إرسال', 'Envoyer')}</button></form>}</section></div>}
      {selected && threadError && <section><Notice error>{threadError}</Notice><button type="button" disabled={threadLoading || sendBusy} onClick={()=>refreshConversation(selected._id,true)}>{l('تحديث المحادثة','Actualiser la conversation','Refresh conversation')}</button></section>}{selected && !thread && !threadError && <p role="status">{l('تحميل تفاصيل الطلب…','Chargement de la demande…')}</p>}
      {selected && thread && (['pending', 'responded', 'offering'].includes(selected.status) || thread.offerSubmission) && <SupplierOfferForm rfq={selected} progress={thread.offerSubmission} onBlockClose={setOfferCloseBlocked} disabled={busy || sendBusy || threadLoading || Boolean(threadError) || rejection.blocked} onReject={rejection.submit} onUpdated={() => { refresh(); refreshConversation(selected._id).catch(e => setError(e.message)); }}/>}
      {quoteTarget && <section><p>{statusLabel(quoteTarget.status,lang)}</p>{quoteTarget.quotes?.map(q=><section key={q._id}><p>{statusLabel(q.status,lang)}</p><SourcingQuoteTerms quote={q} sourcing={quoteTarget}/></section>)}</section>}
      {quoteTarget && <SourcingOfferForm sourcing={quoteTarget} supplier={profile} sessionToken={sourcingSession} onBlockClose={setSourcingCloseBlocked} onUpdated={result => {
        refresh();
        if (result.processing) setQuoteTarget(result.sourcing);
        else { setQuoteTarget(null); setMessage(l('تم حفظ عرض التوريد', 'Offre enregistrée')); }
      }}/>}

    </AtlasDialog>}
  </div>;
}
