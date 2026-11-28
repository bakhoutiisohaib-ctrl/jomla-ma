import { useEffect, useRef, useState } from 'react';
import ProtectedImage from '../common/ProtectedImage';
import { Field, Notice } from '../common/WorkspaceUI';
import { mediaUrl } from '../../api/media';
import { useLabels, formatMoney } from '../../i18n/useLabels';
import { useTranslation } from '../../i18n/LanguageContext';
import { useTaxonomy, TaxonomyFields, taxonomyLabel } from '../common/ProductTaxonomy';

export default function ProductWizard({ product, form, update, stores, tiers, setTiers, rights, setRights,
  approved, setApproved, source, setSource, license, setLicense, file, selectFile, slot, setSlot,
  imageAction, busy, saving, recoveryPending = false, onRecover, onCheckEdit, onReloadEdit, onFinishEdit, error, message, save, onCancel }) {
  const l = useLabels(), { lang } = useTranslation(), heading = useRef(null);
  const recoveryRef=useRef(null);
  const editingRecovery=Boolean(product&&recoveryPending);
  useEffect(()=>{if(editingRecovery){const panel=recoveryRef.current;panel?.focus({preventScroll:true});panel?.scrollIntoView?.({block:"center",behavior:"instant"});}},[editingRecovery]);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(null);
  useEffect(()=>{
    setPreview(null);
    if(!file || typeof URL.createObjectURL!=='function') return;
    const url=URL.createObjectURL(file);
    setPreview({file,url});
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const taxonomy = useTaxonomy(taxonomyOpen || Boolean(form.taxonomyPath));
  const steps = [l('الصور والبيانات', 'Images et informations'), l('السعر والكميات', 'Prix et quantités'), l('المراجعة والنشر', 'Vérifier et publier')];
  function go(next) { setStep(next); requestAnimationFrame(() => heading.current?.focus()); }
  const selectedStore = stores.find(s => s._id === form.storeId);
  const issues = [];
  if (!form.name?.trim() || !form.category?.trim() || !form.city?.trim() || (form.description?.trim().length || 0) < 10)
    issues.push([0,l('أكمل العنوان والفئة والمدينة ووصفاً من 10 أحرف على الأقل.', 'Complétez le titre, la catégorie, la ville et une description de 10 caractères minimum.')]);
  if (!form.imageUrl || !mediaUrl(form.imageUrl) || (form.images || []).some(i => !mediaUrl(i)))
    issues.push([0,l('ارفع صورة رئيسية داخل المنصة واستبدل أي رابط خارجي.', 'Importez une image principale sur la plateforme et remplacez tout lien externe.')]);
  if (!selectedStore || selectedStore.reviewStatus !== 'approved' || selectedStore.isActive === false || selectedStore.adminSuspended)
    issues.push([0,l('اختر متجراً معتمداً ونشطاً وغير معلق من الإدارة.', 'Choisissez une boutique approuvée, active et non suspendue.')]);
  if (source === 'licensed' && !license.trim()) issues.push([0,l('أدخل مرجع الترخيص.', 'Renseignez la référence de la licence.')]);
  if (!Number.isInteger(Number(form.moq)) || Number(form.moq)<1 || !form.unit?.trim() || !/^[A-Za-z]{3}$/.test(form.currency) || form.availability==='unknown' || (form.pricingMode==='fixed' && (form.price==='' || !Number.isFinite(Number(form.price)) || Number(form.price)<0)))
    issues.push([1,l('راجع السعر والعملة والوحدة وMOQ وحدد التوفر.', 'Vérifiez le prix, la devise, l’unité, le MOQ et la disponibilité.')]);
  const sorted = [...tiers].sort((a,b)=>Number(a.minQty)-Number(b.minQty));
  if (form.pricingMode==='fixed' && sorted.some((t,i)=>!Number.isInteger(Number(t.minQty)) || Number(t.minQty)<Number(form.moq) || t.price==='' || !Number.isFinite(Number(t.price)) || Number(t.price)<0 || (t.maxQty!=='' && t.maxQty!=null && (!Number.isInteger(Number(t.maxQty)) || Number(t.maxQty)<Number(t.minQty))) || (i>0 && (sorted[i-1].maxQty==='' || sorted[i-1].maxQty==null || Number(t.minQty)<=Number(sorted[i-1].maxQty)))))
    issues.push([1,l('راجع الشرائح: كميات صحيحة، دون تداخل، وبداية لا تقل عن MOQ.', 'Vérifiez les paliers : quantités entières, sans chevauchement et à partir du MOQ.')]);
  if (product?.moderationStatus==='hidden') issues.push([0,l('المنتج محجوب إشرافياً؛ الحفظ كمسودة متاح.', 'Produit masqué par la modération ; le brouillon reste disponible.')]);
  const resetApproval = setter => value => { setter(value); setApproved(false); };
  const recoveryActions=recoveryPending && <div className="actions">{onCheckEdit&&<button type="button" disabled={saving||busy} onClick={onCheckEdit}>{l('التحقق من محاولة التعديل','Vérifier la tentative de modification','Check edit attempt')}</button>}{onReloadEdit&&<button type="button" disabled={saving||busy} onClick={onReloadEdit}>{l('مراجعة النسخة الحالية دون إعادة الإرسال','Vérifier la version actuelle sans renvoi','Review current version without resending')}</button>}{onFinishEdit&&<button type="button" disabled={saving||busy} onClick={onFinishEdit}>{l('العودة إلى المنتجات مع تنبيه الفهرسة','Retour aux produits avec avertissement d’indexation','Return to products with indexing warning')}</button>}{onRecover&&<button type="button" className="primary" disabled={busy || saving} onClick={onRecover}>{saving?l('جارٍ الاستكمال…','Reprise en cours…'):l('استكمال محاولة الحفظ','Reprendre l’enregistrement')}</button>}</div>;
  return <section className="panel supplier-editor">
    <p className="supplier-eyebrow">{l('كتالوج شركتك', 'Le catalogue de votre entreprise')}</p>
    <h2>{product ? l('تحرير المنتج', 'Modifier le produit') : l('إضافة منتج جملة', 'Ajouter un produit de gros')}</h2>
    <p className="muted">{l('احفظ مسودة في أي خطوة. لا يُنشر شيء قبل مراجعتك واعتمادك الصريح.', 'Enregistrez un brouillon à chaque étape. Rien n’est publié sans votre vérification et votre accord explicite.')}</p>
    {product?.isDraft===false && <Notice>{l('المنتج الحالي منشور. حفظه كمسودة خاصة يلغي نشره؛ لا يتغير قبل إجراء حفظ صريح منك.', 'Le produit actuel est publié. L’enregistrer en brouillon privé le dépublie ; rien ne change sans votre action explicite.')}</Notice>}
    {editingRecovery&&<div className="supplier-edit-recovery" role="region" aria-label={l("استرجاع محاولة التعديل","Récupération de la modification","Edit recovery")} ref={recoveryRef} tabIndex={-1}><Notice>{message}</Notice><Notice error>{error}</Notice>{recoveryActions}</div>}
    <ol className="supplier-steps" aria-label={l('خطوات إضافة المنتج','Étapes du produit')}>{steps.map((title,i)=><li key={title}><button type="button" disabled={saving} aria-current={step===i?'step':undefined} onClick={()=>go(i)}><span>{i+1}</span>{title}</button></li>)}</ol>
    <form onSubmit={e=>e.preventDefault()}>
      <fieldset className="supplier-editor-fields" disabled={saving || recoveryPending}><legend className="supplier-sr">{steps[step]}</legend>
      <h3 ref={heading} tabIndex="-1" className="supplier-step-title">{l('الخطوة','Étape')} {step+1} / 3 — {steps[step]}</h3>
      {step===0 && <>
        <div className="supplier-editor-intro"><div><h4>{l('صورة واضحة، ثم وصف دقيق','Une image claire, des informations précises')}</h4><p>{l('صورة رئيسية وحتى ست صور إضافية. تبقى الصور محمية قبل نشر منتج مؤهل للعرض.', 'Une image principale et jusqu’à six images supplémentaires. Elles restent protégées avant la publication d’un produit éligible.')}</p></div><span className="badge">{product?.isDraft===false?l('تعديل غير محفوظ','Modification non enregistrée'):l('مسودة خاصة','Brouillon privé')}</span></div>
        <div className="form-grid"><Field label={l('مصدر حق الصورة','Droits de l’image')}><select value={source} onChange={e=>resetApproval(setSource)(e.target.value)}><option value="owned">{l('أملك الصورة','Je possède cette image')}</option><option value="licensed">{l('لدي ترخيص','Je dispose d’une licence')}</option></select></Field>{source==='licensed' && <Field label={l('مرجع الترخيص','Référence de la licence')} value={license} onChange={e=>resetApproval(setLicense)(e.target.value)} />}</div>
        <label className="check"><input type="checkbox" checked={rights} onChange={e=>resetApproval(setRights)(e.target.checked)} />{l('أقر بأنني أملك حق استخدام هذه الصورة لهذا المنتج.','Je confirme avoir le droit d’utiliser cette image pour ce produit.')}</label>
        <p className="muted">{l('يشمل الإقرار جميع الصور المرفقة. لا تستخدم صوراً دون إذن.', 'La déclaration couvre toutes les images jointes. Utilisez uniquement des images autorisées.')}</p>
        <div className="supplier-upload"><Field label={l('نوع الصورة','Usage de l’image')}><select value={slot} onChange={e=>resetApproval(setSlot)(e.target.value)}><option value="main">{l('الصورة الرئيسية','Image principale')}</option><option value="secondary">{l('صورة إضافية','Image supplémentaire')}</option></select></Field>
        <div className="supplier-photo-picker">
          {preview?.file===file && <figure><img src={preview.url} alt={l('معاينة الصورة المختارة على جهازك','Aperçu local de l’image choisie','Local preview of selected image')} /><figcaption>{l('معاينة محلية قبل الرفع','Aperçu local avant importation','Local preview before upload')}</figcaption></figure>}
          <Field label={l('التقاط صورة بالكاميرا','Prendre une photo','Take a photo')} type="file" accept="image/png,image/jpeg,image/webp,image/gif" capture="environment" onChange={selectFile} />
          <Field label={l('ملف الصورة (حتى 10MB)','Image (10 Mo maximum)')} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={selectFile} />
        </div>
        <div className="actions"><button type="button" disabled={busy || !rights || !file} onClick={()=>imageAction(false)}>{l('رفع الصورة','Importer l’image')}</button><button type="button" disabled={busy || !rights || !file || slot!=='main'} onClick={()=>imageAction(true)}>{l('اقتراح وصف من الصورة','Proposer une description visuelle')}</button></div><small>{file?.name} {busy && l('جارٍ الرفع أو المعالجة…','Importation ou analyse…')}</small></div>
        <p className="muted">{l('روابط الصور الخارجية غير متاحة. الوصف المقترح يحتاج مراجعتك ولا يحدد السعر أو التوفر.', 'Les liens externes sont désactivés. Toute description proposée doit être vérifiée et ne détermine ni prix ni disponibilité.')}</p>
        <div className="supplier-editor-images">{form.imageUrl && <figure><ProtectedImage value={form.imageUrl} alt={l('معاينة المنتج','Aperçu du produit')} /><figcaption>{l('الرئيسية','Principale')}</figcaption><button type="button" onClick={()=>update('imageUrl','')}>{l('إزالة الرئيسية','Retirer la principale')}</button></figure>}{(form.images || []).map((image,i)=><figure key={image}><ProtectedImage value={image} alt={l('صورة إضافية','Image supplémentaire')+' '+(i+1)} /><button type="button" onClick={()=>update('images',form.images.filter((_,n)=>n!==i))}>{l('إزالة الصورة','Retirer l’image')} {i+1}</button></figure>)}</div>
        <div className="form-grid"><Field label={l('المتجر','Boutique')}><select value={form.storeId} onChange={e=>update('storeId',e.target.value)}><option value="">{l('اختر متجراً','Choisir une boutique')}</option>{stores.map(s=><option key={s._id} value={s._id}>{s.name} — {s.reviewStatus==='approved' && s.isActive!==false && !s.adminSuspended?l('معتمد ونشط','Approuvée et active'):l('غير جاهز للنشر','Publication indisponible')}</option>)}</select></Field>
        {[['name',l('عنوان المنتج','Titre du produit')],['category',l('الفئة','Catégorie')],['city',l('موقع التوريد / المدينة','Ville de fourniture')]].map(([key,label])=><Field key={key} label={label} value={form[key] || ''} onChange={e=>update(key,e.target.value)} />)}
        <div className="supplier-taxonomy">
          <button type="button" aria-expanded={taxonomyOpen} onClick={() => setTaxonomyOpen(open => !open)}>{l('اختيار القطاع والفئة الفرعية (اختياري)','Choisir secteur et sous-catégorie (facultatif)','Choose sector and subcategory (optional)')}</button>
          {form.taxonomyPath && <p>{taxonomyLabel(taxonomy.sectors, form.taxonomyPath, lang)}</p>}
          {taxonomyOpen && <><TaxonomyFields value={form.taxonomyPath || ''} onChange={value => update('taxonomyPath', value)} state={taxonomy}/>
          <p className="muted">{l('يبقى اسم الفئة الأصلي محفوظاً. التصنيف الهرمي اختياري.','Le nom de catégorie d’origine est conservé. La classification hiérarchique est facultative.','The original category name is preserved. Hierarchical classification is optional.')}</p></>}
        </div>
        <Field label={l('وصف كافٍ ودقيق','Description précise')}><textarea rows="4" value={form.description || ''} onChange={e=>update('description',e.target.value)} /></Field></div>
        <p className="supplier-help">{l('اعتماد المتجر من الإدارة مطلوب للنشر. توثيق المورد التجاري اختياري ولا يشترط لفتح متجر أو نشر منتج.', 'L’approbation administrative de la boutique est requise. La vérification commerciale du fournisseur est facultative : elle n’est pas nécessaire pour ouvrir une boutique ou publier.')}</p>
      </>}
      {step===1 && <><p className="muted">{l('حدد ثمن وحدة البيع والحد الأدنى للطلب، ثم حالة التوفر.', 'Précisez le prix à l’unité, le minimum de commande et la disponibilité.')}</p><div className="form-grid">
        <Field label={l('التسعير','Tarification')}><select value={form.pricingMode} onChange={e=>update('pricingMode',e.target.value)}><option value="fixed">{l('سعر محدد','Prix fixe')}</option><option value="on_request">{l('السعر عند الطلب','Prix sur demande')}</option></select></Field>
        {form.pricingMode==='fixed' && <Field label={l('سعر الوحدة','Prix unitaire')} type="number" step="0.01" min="0" value={form.price ?? ''} onChange={e=>update('price',e.target.value)} />}
        {[['currency',l('رمز العملة','Devise (code ISO)'),'text'],['unit',l('وحدة البيع','Unité de vente'),'text'],['moq',l('الحد الأدنى للطلب MOQ','Commande minimum MOQ'),'number']].map(([key,label,type])=><Field key={key} label={label} type={type} min={key==='moq'?1:undefined} value={form[key] ?? ''} onChange={e=>update(key,e.target.value)} />)}
        <Field label={l('التوفر بحسب معلوماتي الحالية','Disponibilité confirmée par mes soins')}><select value={form.availability} onChange={e=>update('availability',e.target.value)}><option value="unknown">{l('لم أحدد بعد','À renseigner')}</option><option value="in_stock">{l('متوفر','Disponible')}</option><option value="out_of_stock">{l('غير متوفر','Indisponible')}</option></select></Field></div>
        <p className="supplier-help">{l('MOQ هو أقل عدد من وحدات البيع تقبل طلبه. حالة التوفر لا تعني عدداً محدداً من المخزون.', 'Le MOQ est le minimum d’unités par demande. La disponibilité ne représente pas une quantité de stock chiffrée.')}</p>
        {form.pricingMode==='fixed' && <section className="supplier-tiers"><h4>{l('أسعار حسب الكمية','Tarifs par quantité')}</h4><p className="muted">{l('اختياري. ابدأ من MOQ دون تداخل بين الشرائح.', 'Facultatif. Commencez au MOQ, sans chevauchement des paliers.')}</p>{tiers.map((tier,i)=><div className="supplier-tier" key={i}>{['minQty','maxQty','price'].map((key,j)=><Field key={key} label={[l('من كمية','Quantité min.'),l('إلى (فارغ: بلا حد)','Max. (vide : illimité)'),l('سعر الوحدة في الشريحة','Prix du palier')][j]} type="number" min={key==='price'?0:1} step={key==='price'?'0.01':'1'} value={tier[key] ?? ''} onChange={e=>{setTiers(t=>t.map((v,n)=>n===i?{...v,[key]:e.target.value}:v));setApproved(false);}} />)}<button type="button" onClick={()=>{setTiers(t=>t.filter((_,n)=>n!==i));setApproved(false);}}>{l('إزالة','Retirer')} {i+1}</button></div>)}<button type="button" disabled={tiers.length>=30} onClick={()=>{setTiers(t=>[...t,{minQty:form.moq,maxQty:'',price:''}]);setApproved(false);}}>{l('إضافة شريحة','Ajouter un palier')}</button></section>}
      </>}
      {step===2 && <><div className="supplier-review"><div className="supplier-editor-images">{[form.imageUrl,...(form.images || [])].filter(Boolean).map((image,i)=><figure key={image}><ProtectedImage value={image} alt={l('معاينة المراجعة','Aperçu avant publication')+' '+(i+1)} /></figure>)}</div><div><p className="supplier-eyebrow">{l('معاينة قبل النشر','Aperçu avant publication')}</p><h4>{form.name || l('عنوان غير مكتمل','Titre à compléter')}</h4><p>{form.description}</p><strong className="supplier-review-price">{form.pricingMode==='on_request'?l('السعر عند الطلب','Prix sur demande'):form.price===''?'—':formatMoney(form.price,form.currency,lang)} / {form.unit}</strong><dl><dt>MOQ</dt><dd>{form.moq} {form.unit}</dd><dt>{l('المتجر','Boutique')}</dt><dd>{selectedStore?.name || '—'}</dd><dt>{l('المدينة','Ville')}</dt><dd>{form.city || '—'}</dd><dt>{l('الفئة','Catégorie')}</dt><dd>{form.category || '—'}</dd><dt>{l('التصنيف الهرمي','Classification hiérarchique','Hierarchical classification')}</dt><dd>{taxonomyLabel(taxonomy.sectors, form.taxonomyPath, lang) || l('دون تصنيف هرمي','Sans classification hiérarchique','No hierarchical classification')}</dd><dt>{l('التوفر','Disponibilité')}</dt><dd>{form.availability==='in_stock'?l('متوفر','Disponible'):form.availability==='out_of_stock'?l('غير متوفر','Indisponible'):l('غير محدد','À renseigner')}</dd></dl></div></div>
        {form.pricingMode==='fixed' && tiers.length>0 && <div className="table-wrap"><table><caption>{l('أسعار حسب الكمية','Tarifs par quantité')}</caption><thead><tr><th>{l('من','Min.')}</th><th>{l('إلى','Max.')}</th><th>{l('سعر الوحدة','Prix unitaire')}</th></tr></thead><tbody>{tiers.map((t,i)=><tr key={i}><td>{t.minQty}</td><td>{t.maxQty || '∞'}</td><td>{t.price===''?'—':formatMoney(t.price,form.currency,lang)}</td></tr>)}</tbody></table></div>}
        {issues.length>0 && <div className="supplier-checklist"><h4>{l('قبل النشر، أكمل التالي','Avant de publier')}</h4><ul>{issues.map(([target,text])=><li key={text}>{text} <button type="button" onClick={()=>go(target)}>{l('مراجعة الخطوة','Revoir l’étape')} {target+1}</button></li>)}</ul></div>}
        {!rights && <Notice>{l('إقرار حقوق الصور غير محدد. ارجع إلى الخطوة الأولى لإقراره بنفسك.', 'Les droits ne sont pas confirmés. Retournez à la première étape pour les déclarer vous-même.')}</Notice>}
        <label className="check supplier-publish-consent"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} />{l('راجعت الصورة والوصف والسعر والكمية والتوفر وأعتمد نشر هذه البيانات.','J’ai vérifié l’image, la description, les prix, les quantités et la disponibilité et j’approuve cette publication.')}</label>
        <p className="muted">{l('أي تعديل يلغي إقرار النشر. النشر لا ينشئ طلباً أو اتفاقاً تجارياً.', 'Toute modification annule cet accord. Publier ne crée ni commande ni accord commercial.')}</p>
      </>}
      </fieldset>{!editingRecovery&&<><Notice>{message}</Notice><Notice error>{error}</Notice>{recoveryActions}</>}
      <div className="supplier-editor-actions"><div className="actions">{step>0 && <button type="button" disabled={saving} onClick={()=>go(step-1)}>{l('السابق','Précédent')}</button>}{step<2?<button type="button" className="primary" disabled={saving} onClick={()=>go(step+1)}>{l('التالي','Suivant')}</button>:<button type="button" className="primary" disabled={recoveryPending || busy || saving || !approved || !rights || issues.length>0} onClick={()=>save(false)}>{l('اعتماد ونشر','Approuver et publier')}</button>}</div><div className="actions"><button type="button" disabled={recoveryPending || busy || saving} onClick={()=>save(true)}>{saving?l('جارٍ الحفظ…','Enregistrement…'):l('حفظ مسودة خاصة','Enregistrer un brouillon privé')}</button><button type="button" disabled={saving || recoveryPending} onClick={onCancel}>{l('إلغاء','Annuler')}</button></div></div>
      <small className="muted">{l('احفظ قبل مغادرة الصفحة. المدخلات غير المحفوظة لا تُخزن على الجهاز ولا تستعاد بعد الإغلاق.', 'Enregistrez avant de quitter. Les saisies non enregistrées ne sont pas stockées sur l’appareil et ne sont pas récupérées après fermeture.')}</small>
    </form>
  </section>;
}
