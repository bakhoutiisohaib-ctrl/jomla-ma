import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/config';
import { getSessionToken, useSessionToken } from '../../api/session';
import { mediaUrl } from '../../api/media';
import { waitForJob } from '../../api/jobs';
import { useLabels } from '../../i18n/useLabels';
import ProductWizard from './ProductWizard';

function creationKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('Secure random generation is unavailable');
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function EditorSession({
  product,
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
  const [recoveryPending, setRecoveryPending] = useState(false);
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
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!form.storeId && stores.length === 1) setForm(f => ({
      ...f,
      storeId: stores[0]._id
    }));
  }, [form.storeId, stores]);
  function update(key, value) {
    formRevision.current++;
    setForm(f => ({
      ...f,
      [key]: value
    }));
    setApproved(false);
  }
  async function imageAction(analyze = false) {
    if (savingRef.current || recoveryPending) return;
    if (slot === 'secondary' && (form.images || []).length >= 6) return setError(l('الحد الأقصى ست صور إضافية.', 'Six images supplémentaires maximum.'));
    if (!file) return setError(l('اختر صورة أولاً', 'Choisissez une image.'));
    if (!rights) return setError(l('أقر بحق استخدام الصورة أولاً', 'Confirmez vos droits sur l’image.'));
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
      if (data.imageUrl) setForm(f => imageSlot === 'main' ? { ...f, imageUrl: data.imageUrl } : { ...f, images: [...new Set([...(f.images || []), data.imageUrl])] });
      if (data.job) {
        setMessage(l('الصورة محفوظة، والتحليل جارٍ في الخلفية…', 'Image enregistrée, analyse en cours en arrière-plan…'));
        data = await waitForJob(data.job, { signal: controller.signal });
      }
      if (!mounted.current || controller.signal.aborted || requestToken !== getSessionToken()) return;
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
      if (imageSlot === 'main' && e.data?.imageUrl) update('imageUrl', e.data.imageUrl);
      setError(e.message);
    } finally {
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) setBusy(false);
    }
  }
  async function save(isDraft, recover = false) {
    if (savingRef.current || busy) return;
    // An unknown acknowledgement must be reconciled using its original payload.
    // A new key here could create a second product after the first was committed.
    if (!product && creationAttempt.current && !recover) return;
    if (recover && (!creationAttempt.current || product)) return;
    const requestToken = getSessionToken();
    const controller = new AbortController();
    if (!recover && [form.imageUrl, ...(form.images || [])].some(image => image && !mediaUrl(image))) return setError(l('ارفع الصورة داخل المنصة قبل حفظ المنتج؛ الروابط الخارجية غير متاحة ضمن حماية المسودات.', 'Importez l’image sur la plateforme avant d’enregistrer ; les liens externes sont désactivés pour protéger les brouillons.'));
    if (!recover && !isDraft && (!rights || !approved)) return setError(l('اعتمد حقوق الصورة وبيانات النشر صراحة.', 'Confirmez les droits de l’image et la publication.'));
    let body = recover ? creationAttempt.current.body : {
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
      for (const key of ['_id', '__v', 'jobId', 'supplierId', 'supplierPhone', 'createdAt', 'approvedBy', 'approvedAt', 'organizationId', 'moderationStatus', 'moderationReason', 'views']) delete body[key];
      if (!product) {
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
    if (!product && creationAttempt.current.token !== requestToken) return;
    savingRef.current = true; saveController.current = controller; setSaving(true);
    setError(''); setMessage('');
    try {
      const data = await apiRequest(product ? '/products/' + product._id : '/products', {
        method: product ? 'PUT' : 'POST',
        ...(!product ? { headers: { 'Idempotency-Key': creationAttempt.current.key } } : {}),
        body, token: requestToken, signal: controller.signal
      });
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) {
        creationAttempt.current = null;
        setRecoveryPending(false);
        onSaved(!product && typeof data.product?.isDraft === 'boolean' ? data.product.isDraft : body.isDraft);
      }
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) {
        setError(e.message); setApproved(false);
        const definitiveRejection = e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 408;
        if (!product && !definitiveRejection) {
          setRecoveryPending(true);
          setMessage(body.isDraft ? l('نتيجة حفظ المسودة غير مؤكدة؛ ربما حُفظت بالفعل. استكمل محاولة الحفظ بالبيانات الأصلية نفسها دون إنشاء نسخة ثانية. لا تغادر المحرر قبل استكمالها.', 'Le résultat du brouillon est incertain ; il est peut-être déjà enregistré. Reprenez l’enregistrement avec les mêmes informations d’origine, sans créer de doublon. Restez dans l’éditeur jusqu’à sa confirmation.') : l('نتيجة النشر غير مؤكدة؛ ربما نُشر المنتج بالفعل. استكمال محاولة الحفظ يستخدم البيانات وإقرار النشر اللذين أرسلتهما صراحة في المحاولة الأصلية، دون إنشاء نسخة ثانية. لا تغادر المحرر قبل استكمالها.', 'Le résultat de la publication est incertain ; le produit est peut-être déjà publié. La reprise utilise les informations et l’accord de publication explicitement envoyés lors de la tentative d’origine, sans créer de doublon. Restez dans l’éditeur jusqu’à sa confirmation.'));
        } else {
          creationAttempt.current = null;
          setRecoveryPending(false);
          setMessage(l('المدخلات محفوظة في هذه الصفحة. راجع الخطأ ثم أعد الحفظ صراحة.', 'Vos saisies sont conservées sur cette page. Vérifiez l’erreur, puis relancez explicitement l’enregistrement.'));
        }
      }
    } finally {
      savingRef.current = false;
      if (mounted.current && !controller.signal.aborted && requestToken === getSessionToken()) setSaving(false);
    }
  }
  return <ProductWizard {...{ product, form, update, stores, tiers, setTiers, rights, setRights, approved, setApproved,
    source, setSource, license, setLicense, file, slot, setSlot, imageAction, busy, saving, recoveryPending, error, message, save, onCancel }}
    onRecover={() => save(creationAttempt.current?.body.isDraft, true)}
    selectFile={e => { imageController.current?.abort(); formRevision.current++; setBusy(false); setFile(e.target.files?.[0] || null); setApproved(false); }} />;
}
export default function ProductEditor(props) {
  const token = useSessionToken();
  return <EditorSession key={token} {...props} />;
}
