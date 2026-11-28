import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { mediaUrl } from '../../api/media';
import { waitForJob } from '../../api/jobs';
import { useLabels } from '../../i18n/useLabels';
import ProductWizard from './ProductWizard';
import { validRevision, updateSlot, loadAttempt, persistAttempt, clearAttempt, updateHeaders, confirmUpdateStatus, confirmUpdateAck } from './productUpdateAttempt';

function creationKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('Secure random generation is unavailable');
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function EditorSession({
  product,
  actorId,
  onReload,
  initialDraft,
  stores = [],
  city = '',
  onSaved,
  onCancel
}) {
  const l = useLabels();
  const imageController = useRef(null);
  const formRevision = useRef(0), saveController = useRef(null), mounted = useRef(true), savingRef = useRef(false);
  const creationAttempt = useRef(null);
  const storageSlot=product&&actorId?updateSlot(actorId,product._id):null;
  const [initialAttempt]=useState(()=>{try{return storageSlot?{value:loadAttempt(storageSlot)}:{value:null};}catch{return {invalid:true};}});
  const editAttempt=useRef(initialAttempt.value||null);
  const [editPhase,setEditPhase]=useState(initialAttempt.invalid?'storage':initialAttempt.value?'unknown':'');
  const [recoveryPending, setRecoveryPending] = useState(Boolean(initialAttempt.value||initialAttempt.invalid));
  const [saving, setSaving] = useState(false), [slot, setSlot] = useState('main');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; imageController.current?.abort(); saveController.current?.abort(); }; }, []);
  const [form, setForm] = useState(() => ({
    ...{
      name: '',
      category: '',
      description: '',
      price: '',
      currency: 'MAD',
      country: 'MA',
      moq: 1,
      unit: 'قطعة',
      city,
      pricingMode: 'fixed',
      availability: 'unknown',
      imageUrl: '',
      images: [],
      storeId: ''
    },
    ...initialDraft,
    ...product,
    storeId: product?.storeId?._id || product?.storeId || initialDraft?.storeId || ''
  }));
  const [tiers, setTiers] = useState(product?.priceTiers || initialDraft?.priceTiers || []);
  const [rights, setRights] = useState(false),
    [approved, setApproved] = useState(false);
  const [source, setSource] = useState(product?.imageRights?.source || 'owned'),
    [license, setLicense] = useState(product?.imageRights?.licenseReference || '');
  const [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(()=>initialAttempt.invalid?l('تعذر قراءة سجل محاولة التعديل المحلي. الحفظ الجديد متوقف لحماية بيانات المنتج.','Impossible de lire la tentative locale. Nouvel enregistrement bloqué pour protéger le produit.','Could not read the local edit attempt. New saves are blocked to protect product data.'):'') ,
    [message, setMessage] = useState(()=>initialAttempt.value?l('هناك محاولة تعديل غير مؤكدة. تحقق منها قبل حفظ بيانات جديدة.','Une tentative de modification reste non confirmée. Vérifiez-la avant un nouvel enregistrement.','An edit attempt is unconfirmed. Check it before saving new data.'):'');
  useEffect(() => {
    if (!form.storeId && stores.length === 1) setForm(f => ({
      ...f,
      storeId: stores[0]._id
    }));
  }, [form.storeId, stores]);
  function cancelImage() {
    imageController.current?.abort();
    imageController.current = null;
    setBusy(false);
    setMessage('');
    setApproved(false);
  }
  function update(key, value) {
    if (key === 'imageUrl' || key === 'images') cancelImage();
    formRevision.current++;
    setForm(f => ({
      ...f,
      [key]: value
    }));
    setApproved(false);
  }
  async function imageAction(analyze = false) {
    if (savingRef.current || recoveryPending || imageController.current) return;
    if (slot === 'secondary' && (form.images || []).length >= 6) return setError(l('الحد الأقصى ست صور إضافية.', 'Six images supplémentaires maximum.'));
    if (!file) return setError(l('اختر صورة أولاً', 'Choisissez une image.'));
    if (!rights) return setError(l('أقر بحق استخدام الصورة أولاً', 'Confirmez vos droits sur l’image.'));
    if (source === 'licensed' && !license.trim()) return setError(l('أدخل مرجع الترخيص.', 'Renseignez la référence de la licence.', 'Enter the license reference.'));
    setBusy(true);
    setError('');
    setMessage('');
    imageController.current?.abort();
    const controller = new AbortController();
    imageController.current = controller;
    const revision = formRevision.current, imageSlot = slot;
    const requestToken = getSessionToken();
    const body = new FormData();
    body.append('image', file);
    body.append('hasImageRights', 'true');
    try {
      let data = await apiRequest(analyze ? '/product-ai/enhance' : '/product-ai/upload', {
        method: 'POST',
        body,
        token: requestToken,
        signal: controller.signal
      });
      if (!mounted.current || controller.signal.aborted || requestToken !== getSessionToken()) return;
      if (!mediaUrl(data?.imageUrl)) throw new Error(l("تعذر تأكيد الصورة المرفوعة.", "Image importée non confirmée.", "Uploaded image not confirmed."));
      setForm(f => imageSlot === 'main' ? { ...f, imageUrl: data.imageUrl } : { ...f, images: [...new Set([...(f.images || []), data.imageUrl])] });
      if (data.job) {
        setMessage(l('الصورة محفوظة، والتحليل جارٍ في الخلفية…', 'Image enregistrée, analyse en cours en arrière-plan…'));
        data = await waitForJob(data.job, { signal: controller.signal, token: requestToken });
      }
      if (!mounted.current || controller.signal.aborted || requestToken !== getSessionToken()) return;
      if (!data || (data.imageUrl && !mediaUrl(data.imageUrl))) throw new Error(l('تعذر تأكيد نتيجة الصورة.', 'Résultat de l’image non confirmé.', 'Image result not confirmed.'));
      setForm(f => ({
        ...f,
        ...(imageSlot === 'main' && data.imageUrl ? { imageUrl: data.imageUrl } : {}),
        ...(data.draft && revision === formRevision.current ? {
          name: data.draft.title,
          category: data.draft.category,
          description: data.draft.description
        } : {})
      }));
      setApproved(false);
      setMessage(analyze ? l('راجع الوصف المرئي، وأدخل الأسعار والتوفر والمواصفات بنفسك.', 'Vérifiez la description visuelle et renseignez vous-même prix, disponibilité et caractéristiques.') : l('تم رفع الصورة. راجع البيانات قبل النشر.', 'Image importée. Vérifiez les données avant publication.'));
    } catch (e) {
      if (!mounted.current || e.name === 'AbortError' || controller.signal.aborted || requestToken !== getSessionToken()) return;
      setMessage('');
      if (imageSlot === 'main' && mediaUrl(e.data?.imageUrl)) {setForm(f=>({...f,imageUrl:e.data.imageUrl}));setApproved(false);}
      setError(e.message);
    } finally {
      if (imageController.current === controller) {
        imageController.current = null;
        if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) setBusy(false);
      }
    }
  }
  const editUnknown=()=>l('نتيجة تحديث المنتج غير مؤكدة. قد يكون التعديل محفوظاً بالفعل. تحقق من المحاولة نفسها قبل أي تعديل جديد.','La mise à jour est incertaine. Elle peut déjà être enregistrée. Vérifiez la même tentative avant toute nouvelle modification.','Product update unconfirmed. It may already be saved. Check the same attempt before another edit.');
  const editMismatch=()=>l('تعذر تأكيد نتيجة حفظ المنتج.','Résultat de l’enregistrement non confirmé.','Product save result not confirmed.');
  async function checkEdit(reload=false) {
    if(!product||!actorId||!storageSlot||savingRef.current||imageController.current)return;
    const a=editAttempt.current,requestToken=getSessionToken(),controller=new AbortController();
    savingRef.current=true;saveController.current=controller;setSaving(true);setError('');
    const valid=()=>mounted.current&&!controller.signal.aborted&&requestToken===getSessionToken();
    try{
      if(!a)throw Error('UNCONFIRMED_EDIT');
      const stored=loadAttempt(storageSlot);
      if(!stored||stored.key!==a.key||stored.baseRevision!==a.baseRevision||stored.isDraft!==a.isDraft)throw Error('UNCONFIRMED_EDIT');
      const data=confirmUpdateStatus(await apiRequest('/products/'+product._id+'/update-attempt',{token:requestToken,signal:controller.signal,cache:'no-store',headers:updateHeaders(a)}),a,product._id,actorId);
      if(!valid())return;
      if(reload){
        if(data.phase==='saved')throw Error('UNCONFIRMED_EDIT');
        const current=(await apiRequest('/products/'+product._id+'/edit-state',{token:requestToken,signal:controller.signal,cache:'no-store'}))?.product;
        if(!valid())return;
        if(current?._id!==product._id||!validRevision(current.editRevision)||current.editRevision!==data.currentRevision||typeof current.isDraft!=='boolean')throw Error('UNCONFIRMED_EDIT');
        clearAttempt(storageSlot,a);editAttempt.current=null;onReload(current);return;
      }
      if(data.phase==='superseded'){
        setEditPhase('superseded');setMessage(l('تغير المنتج بعد فتحه. لا يمكن تأكيد نتيجة المحاولة السابقة أو الكتابة فوق النسخة الأحدث. راجع النسخة الحالية؛ ستُستبدل مدخلات المحرر غير المحفوظة.','Le produit a changé. Impossible de confirmer l’ancienne tentative ou d’écraser la version récente. Vérifiez la version actuelle ; les saisies non enregistrées seront remplacées.','The product changed. The earlier outcome cannot be confirmed and the newer version will not be overwritten. Review the current version; unsaved editor inputs will be replaced.'));
      }else if(data.phase==='saved'){
        const current=(await apiRequest('/products/'+product._id+'/edit-state',{token:requestToken,signal:controller.signal,cache:'no-store'}))?.product;
        if(!valid())return;
        if(current?._id!==product._id||current.editRevision!==data.currentRevision||current.isDraft!==a.isDraft)throw Error('UNCONFIRMED_EDIT');
        setEditPhase('saved');setMessage(l('حُفظت هذه المراجعة في الخادم. حالة فهرسة الصورة غير مؤكدة؛ استكمل نفس المحاولة إن كانت بياناتها متاحة.','Cette révision est enregistrée. L’indexation de l’image reste non confirmée ; reprenez la même tentative si ses données sont disponibles.','This revision is saved. Image indexing is unconfirmed; resume the same attempt if its data is available.'));
      }else{
        setEditPhase('absent');setMessage(l('لم تظهر المحاولة في الخادم بعد. هذا لا يضمن أنها لن تصل لاحقاً. مراجعة النسخة الحالية تستبدل المدخلات غير المحفوظة.','La tentative n’apparaît pas encore. Cela ne garantit pas qu’elle n’arrivera pas plus tard. Vérifier la version actuelle remplace les saisies non enregistrées.','The attempt is not visible yet. It may still arrive later. Reviewing the current version replaces unsaved inputs.'));
      }
    }catch(e){if(valid())setError(e.message==='UNCONFIRMED_EDIT'?editMismatch():e.message);}
    finally{savingRef.current=false;if(valid())setSaving(false);}
  }
  async function finishSavedEdit(){
    const a=editAttempt.current,requestToken=getSessionToken(),controller=new AbortController();
    if(!a||editPhase!=='saved'||savingRef.current)return;
    savingRef.current=true;saveController.current=controller;setSaving(true);setError('');
    const valid=()=>mounted.current&&!controller.signal.aborted&&requestToken===getSessionToken();
    try{
      const data=confirmUpdateStatus(await apiRequest('/products/'+product._id+'/update-attempt',{token:requestToken,signal:controller.signal,cache:'no-store',headers:updateHeaders(a)}),a,product._id,actorId);
      if(!valid())return;
      if(data.phase!=='saved'){setEditPhase('unknown');setMessage(editUnknown());return;}
      const current=(await apiRequest('/products/'+product._id+'/edit-state',{token:requestToken,signal:controller.signal,cache:'no-store'}))?.product;
      if(!valid())return;
      if(current?._id!==product._id||current.editRevision!==data.currentRevision||current.isDraft!==a.isDraft)throw Error('UNCONFIRMED_EDIT');
      clearAttempt(storageSlot,a);editAttempt.current=null;onSaved(a.isDraft,{indexUnavailable:true});
    }catch(e){if(valid())setError(e.message==='UNCONFIRMED_EDIT'?editMismatch():e.message);}
    finally{savingRef.current=false;if(valid())setSaving(false);}
  }
  async function save(isDraft, recover = false) {
    if (savingRef.current || busy || imageController.current) return;
    // An unknown acknowledgement must be reconciled using its original payload.
    // A new key here could create a second product after the first was committed.
    if (!product && creationAttempt.current && !recover) return;
    if (recover && (product ? !editAttempt.current?.body || editPhase==='superseded' : !creationAttempt.current)) return;
    if(product&&!recover&&(editAttempt.current||recoveryPending))return;
    const requestToken = getSessionToken();
    const controller = new AbortController();
    if (!recover && [form.imageUrl, ...(form.images || [])].some(image => image && !mediaUrl(image))) return setError(l('ارفع الصورة داخل المنصة قبل حفظ المنتج؛ الروابط الخارجية غير متاحة ضمن حماية المسودات.', 'Importez l’image sur la plateforme avant d’enregistrer ; les liens externes sont désactivés pour protéger les brouillons.'));
    if (!recover && !isDraft && (!rights || !approved)) return setError(l('اعتمد حقوق الصورة وبيانات النشر صراحة.', 'Confirmez les droits de l’image et la publication.'));
    if(product&&!recover&&(!actorId||!storageSlot||!validRevision(product.editRevision)))return setError(l('رقم مراجعة المنتج غير مؤكد. عد إلى القائمة وحدّثها قبل التعديل.','Révision du produit non confirmée. Actualisez la liste avant modification.','Product revision unconfirmed. Refresh the list before editing.'));
    let body = recover ? (product?editAttempt.current.body:creationAttempt.current.body) : {
      ...form,
      isDraft,
      publishApproved: !isDraft && approved,
      hasImageRights: rights,
      availabilityConfirmed: form.availability !== 'unknown',
      inStock: form.availability === 'in_stock',
      moq: Number(form.moq),
      priceTiers: form.pricingMode === 'on_request' ? [] : tiers.map(t => ({
        minQty: Number(t.minQty),
        maxQty: t.maxQty === '' || t.maxQty == null ? null : Number(t.maxQty),
        price: Number(t.price)
      })),
      imageRights: {
        source,
        licenseReference: license
      }
    };
    if (!recover) {
      if (!body.storeId) delete body.storeId;
      if (form.pricingMode === 'on_request' || form.price === '') delete body.price;else body.price = Number(form.price);
      for (const key of ['_id', '__v', 'jobId', 'supplierId', 'supplierPhone', 'createdAt', 'approvedBy', 'approvedAt', 'organizationId', 'moderationStatus', 'moderationReason', 'views', 'editRevision', 'updateReceipt', 'creationReceipt', 'updatedAt']) delete body[key];
      if(product){
        try{
          if(loadAttempt(storageSlot))throw Error('INVALID_EDIT_ATTEMPT');
          const a={key:creationKey(),baseRevision:product.editRevision,isDraft,body:JSON.parse(JSON.stringify(body)),token:requestToken};
          persistAttempt(storageSlot,a);editAttempt.current=a;body=a.body;
        }catch{return setError(l('تعذر حفظ معرف محاولة التعديل بأمان. لم يبدأ الحفظ.','Impossible de conserver la tentative. Aucun enregistrement lancé.','Could not store the update attempt safely. No save started.'));}
      } else {
        try {
          // The snapshot contains exactly the JSON sent over the wire. Keep it
          // in this account's mounted editor only, never in browser storage.
          creationAttempt.current = { key: creationKey(), body: JSON.parse(JSON.stringify(body)), token: requestToken };
          body = creationAttempt.current.body;
        } catch {
          return setError(l('تعذر تأمين معرف الحفظ. استخدم متصفحاً حديثاً واتصالاً آمناً ثم حاول مجدداً.', 'Impossible de sécuriser l’identifiant d’enregistrement. Utilisez un navigateur récent et une connexion sécurisée, puis réessayez.'));
        }
      }
    }
    if (product ? editAttempt.current?.token !== requestToken : creationAttempt.current.token !== requestToken) return;
    if(product){try{const a=editAttempt.current,stored=loadAttempt(storageSlot);if(!stored||stored.key!==a.key||stored.baseRevision!==a.baseRevision||stored.isDraft!==a.isDraft)throw Error('INVALID_EDIT_ATTEMPT');}catch{setRecoveryPending(true);setEditPhase('unknown');return setError(editMismatch());}}
    savingRef.current = true; saveController.current = controller; setSaving(true);
    setError(''); setMessage('');
    try {
      const data = await apiRequest(product ? '/products/' + product._id : '/products', {
        method: product ? 'PUT' : 'POST',
        headers: product?updateHeaders(editAttempt.current):{'Idempotency-Key':creationAttempt.current.key},
        body, token: requestToken, signal: controller.signal
      });
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) {
        const confirmed = data?.product;
        if (typeof confirmed?._id !== 'string' || !confirmed._id.trim() || confirmed.isDraft !== body.isDraft ||
            (product && confirmed._id !== product._id)) {
          throw new Error(l('تعذر تأكيد نتيجة حفظ المنتج.', 'Résultat de l’enregistrement non confirmé.', 'Product save result not confirmed.'));
        }
        if(product){
          const a=editAttempt.current;
          try{confirmUpdateAck(data,a,product._id);}catch{throw Error(editMismatch());}
          const status=confirmUpdateStatus(await apiRequest('/products/'+product._id+'/update-attempt',{token:requestToken,signal:controller.signal,cache:'no-store',headers:updateHeaders(a)}),a,product._id,actorId);
          if(!mounted.current||controller.signal.aborted||requestToken!==getSessionToken())return;
          if(status.phase!=='saved')throw Error(editMismatch());
          if(data.visualIndex.status==='unavailable'){
            setRecoveryPending(true);setEditPhase('saved');
            setMessage(l('حُفظ التعديل؛ تعذر جدولة فهرسة الصورة. استكمل المحاولة نفسها أو عد إلى القائمة مع التنبيه.','Modification enregistrée ; indexation non planifiée. Reprenez la même tentative ou retournez à la liste avec avertissement.','Edit saved; image indexing could not be queued. Resume the same attempt or return with a warning.'));
            return;
          }
          clearAttempt(storageSlot,a);editAttempt.current=null;
        }
        creationAttempt.current = null;
        setRecoveryPending(false);
        onSaved(confirmed.isDraft);
      }
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) {
        setError(e.message); setApproved(false);
        const definitiveRejection = e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 408;
        if(product){
          // Even a 4xx on a retry cannot disprove an earlier committed PUT.
          if(!recover&&definitiveRejection&&[400,413,422].includes(e.status)){
            try{clearAttempt(storageSlot,editAttempt.current);editAttempt.current=null;setRecoveryPending(false);setEditPhase('');}
            catch{setRecoveryPending(true);setEditPhase('unknown');}
          }else{setRecoveryPending(true);setEditPhase('unknown');setMessage(editUnknown());}
        } else if (!definitiveRejection) {
          setRecoveryPending(true);
          setMessage(body.isDraft ? l('نتيجة حفظ المسودة غير مؤكدة؛ ربما حُفظت بالفعل. استكمل محاولة الحفظ بالبيانات الأصلية نفسها دون إنشاء نسخة ثانية. لا تغادر المحرر قبل استكمالها.', 'Le résultat du brouillon est incertain ; il est peut-être déjà enregistré. Reprenez l’enregistrement avec les mêmes informations d’origine, sans créer de doublon. Restez dans l’éditeur jusqu’à sa confirmation.') : l('نتيجة النشر غير مؤكدة؛ ربما نُشر المنتج بالفعل. استكمال محاولة الحفظ يستخدم البيانات وإقرار النشر اللذين أرسلتهما صراحة في المحاولة الأصلية، دون إنشاء نسخة ثانية. لا تغادر المحرر قبل استكمالها.', 'Le résultat de la publication est incertain ; le produit est peut-être déjà publié. La reprise utilise les informations et l’accord de publication explicitement envoyés lors de la tentative d’origine, sans créer de doublon. Restez dans l’éditeur jusqu’à sa confirmation.'));
        } else {
          creationAttempt.current = null;
          setRecoveryPending(false);
          setMessage(product && !definitiveRejection
            ? l('نتيجة تحديث المنتج غير مؤكدة. قد يكون التعديل محفوظاً بالفعل. تحقق من قائمة منتجاتك قبل إعادة المحاولة.', 'La mise à jour est incertaine. Elle peut déjà être enregistrée. Vérifiez vos produits avant de réessayer.', 'The update is unconfirmed and may already be saved. Check your products before retrying.')
            : l('المدخلات محفوظة في هذه الصفحة. راجع الخطأ ثم أعد الحفظ صراحة.', 'Vos saisies sont conservées sur cette page. Vérifiez l’erreur, puis relancez explicitement l’enregistrement.'));
        }
      }
    } finally {
      savingRef.current = false;
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) setSaving(false);
    }
  }
  function selectFile(e) {
    cancelImage();formRevision.current++;
    const chosen=e.target.files?.[0] || null;
    setError('');
    if(chosen && (!['image/png','image/jpeg','image/webp','image/gif'].includes(chosen.type) || chosen.size<1 || chosen.size>10*1024*1024)) {
      setFile(null);e.target.value='';
      setError(l('اختر صورة PNG أو JPEG أو WebP أو GIF لا تتجاوز 10MB.', 'Choisissez une image PNG, JPEG, WebP ou GIF de 10 Mo maximum.', 'Choose a PNG, JPEG, WebP or GIF image up to 10 MB.'));
      return;
    }
    setFile(chosen);
  }
  const changeImageContext = setter => value => {cancelImage();formRevision.current++;setter(value);};
  return <ProductWizard {...{ product, form, update, stores, tiers, setTiers, rights, approved, setApproved,
    source, license, file, slot, imageAction, busy, saving, recoveryPending, error, message, save, onCancel }}
    setRights={changeImageContext(setRights)} setSource={changeImageContext(setSource)} setLicense={changeImageContext(setLicense)} setSlot={changeImageContext(setSlot)}
    onRecover={product?(editAttempt.current?.body&&editPhase!=='superseded'?()=>save(editAttempt.current.isDraft,true):undefined):()=>save(creationAttempt.current?.body.isDraft,true)}
    onCheckEdit={product&&editAttempt.current?()=>checkEdit():undefined}
    onReloadEdit={product&&['superseded','absent'].includes(editPhase)?()=>checkEdit(true):undefined}
    onFinishEdit={product&&editPhase==='saved'?finishSavedEdit:undefined}
    selectFile={selectFile} />;
}
export default function ProductEditor(props) {
  const token = useSessionToken();
  const [replacement,setReplacement]=useState(null);
  const current=replacement?.token===token&&replacement?.original===props.product?replacement.product:props.product;
  return <EditorSession key={token+':'+(props.actorId||'')+':'+(current?._id||'new')+':'+(replacement?.token===token&&replacement?.original===props.product?replacement.sequence:0)} {...props} product={current} onReload={product=>setReplacement(previous=>({token,original:props.product,product,sequence:(previous?.sequence||0)+1}))}/>;
}
