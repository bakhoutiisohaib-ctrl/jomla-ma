import {useState} from 'react';
import AtlasDialog from './AtlasDialog';
import {MarketIcon} from './MarketLayout';
import {useLabels} from '../../i18n/useLabels';
import '../../styles/atlas-visual-search.css';

const ACCEPT='image/jpeg,image/png,image/webp,image/gif';
const types=ACCEPT.split(',');
const MAX=10*1024*1024;
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function confirmVisualSearch(data,page){
  const p=data?.pagination,v=data?.visualSearch,items=data?.products;
  if(data?.visualVersion!=='v49-1'||data.queryQuality!=='sufficient_detail'||
    data.visualIdentityVerified!==false||data.analysisMode!=='local_visual_vectors'||
    data.externalDiscovery?.enabled!==false||!Array.isArray(items)||!p||p.page!==page||p.limit!==12||
    !count(p.total)||p.total!==data.total||p.pages!==Math.ceil(p.total/12)||
    items.length!==Math.min(12,Math.max(0,p.total-(page-1)*12))||
    !count(data.exactCount)||!count(data.similarCount)||data.exactCount+data.similarCount!==p.total||
    !v||v.adapter!=='local_feature_vectors'||v.version!=='local-color-spatial-edge-v1'||
    v.exactMeaning!=='same_image_bytes_not_verified_product_identity'||
    v.scoreMeaning!=='feature_vector_cosine_similarity_not_probability'||
    ![v.indexedCandidates,v.unindexedCount,v.staleCount].every(count)||
    typeof v.minScore!=='number'||!Number.isFinite(v.minScore)||v.minScore<0.5||v.minScore>1||
    new Set(items.map(x=>x?._id)).size!==items.length||
    items.some(x=>!x||typeof x._id!=='string'||!x._id||
      !Number.isFinite(x.similarityScore)||x.similarityScore<0||x.similarityScore>1||
      !((x.matchBasis==='exact_image'&&x.matchType==='exact'&&x.similarityScore===1)||
        (x.matchBasis==='similar_image'&&x.matchType==='similar'&&x.similarityScore>=v.minScore-0.0000005)))||
    items.filter(x=>x.matchBasis==='exact_image').length>data.exactCount||
    items.filter(x=>x.matchBasis==='similar_image').length>data.similarCount||
    typeof data.sourcingOffer?.canRequestSourcing!=='boolean'||
    data.sourcingOffer.canRequestSourcing!==(p.total===0))throw Error('UNCONFIRMED_VISUAL');
  return {total:p.total,exact:data.exactCount,similar:data.similarCount,unindexed:v.unindexedCount,stale:v.staleCount,canRequestSourcing:data.sourcingOffer.canRequestSourcing};
}
export function VisualSearchControl({onSelect}){
 const l=useLabels(),[open,setOpen]=useState(false),[error,setError]=useState('');
 function select(e){
   const file=e.target.files?.[0];e.target.value='';
   if(!file)return;
   if(!types.includes(file.type)||!file.size||file.size>MAX){
     setError(l('اختر صورة JPEG أو PNG أو WebP أو GIF لا تتجاوز 10 MB.','Choisissez une image JPEG, PNG, WebP ou GIF de 10 Mo maximum.','Choose a JPEG, PNG, WebP or GIF image up to 10 MB.'));
     return;
   }
   setOpen(false);setError('');onSelect(file);
 }
 return <><button type="button" className="atlas-image-search" aria-label={l('بحث بالصورة','Recherche par image','Search by image')} title={l('بحث بالصورة','Recherche par image','Search by image')} onClick={()=>{setError('');setOpen(true)}}><MarketIcon name="camera"/></button>
 {open&&<AtlasDialog title={l('البحث بالصورة','Recherche par image','Search by image')} subtitle="Jomla.ma" onClose={()=>setOpen(false)}>
   <p>{l('اختر صورة من هاتفك أو التقط صورة. ترسل الصورة إلى محرك البحث في كتالوج المنصة للمقارنة حسب الألوان وتوزيعها والحواف، وليس للتعرف الدلالي على المنتج.','Choisissez ou prenez une photo. L’image est envoyée au moteur du catalogue pour comparer couleurs, disposition et contours, sans reconnaissance sémantique.','Choose or take a photo. The image is sent to the catalog search engine to compare colors, layout and edges, not for semantic recognition.')}</p>
   <p className="muted">{l('الحد الأقصى 10 MB. البحث بالصورة يستبدل البحث النصي السابق مع الاحتفاظ بالفلاتر المختارة.','10 Mo maximum. La recherche par image remplace le texte précédent et conserve vos filtres.','10 MB maximum. Image search replaces the previous text search and keeps selected filters.')}</p>
   <div className="atlas-visual-upload-list">
   <label className="atlas-visual-upload"><MarketIcon name="camera"/><span>{l('اختر صورة','Choisir une image','Choose image')}</span><input type="file" accept={ACCEPT} aria-label={l('صورة البحث','Image de recherche','Search image')} onChange={select}/></label>
   <label className="atlas-visual-upload"><MarketIcon name="camera"/><span>{l('التقط صورة','Prendre une photo','Take a photo')}</span><input type="file" accept={ACCEPT} capture="environment" aria-label={l('التقط صورة','Prendre une photo','Take a photo')} onChange={select}/></label>
   </div>{error&&<p role="alert">{error}</p>}
 </AtlasDialog>}</>;
}
export function VisualSearchSummary({result,onClear}){
 const l=useLabels();
 return <section className="atlas-search-summary" aria-label={l('نتائج البحث بالصورة','Résultats visuels','Image search results')}>
   <div className="atlas-search-summary-line"><strong aria-live="polite">{l('نتائج البحث بالصورة','Résultats visuels','Image search results')} · {result.total}</strong><button type="button" className="atlas-search-chip" onClick={onClear}>{l('مسح الصورة','Retirer l’image','Remove image')}</button></div>
   <div className="atlas-search-chips"><span className="atlas-search-chip">{l('الملف نفسه','Même fichier','Same image file')} · {result.exact}</span><span className="atlas-search-chip">{l('تشابه بصري','Similarité visuelle','Visual similarity')} · {result.similar}</span></div>
   <small>{l('الصورة نفسها تعني تطابق الملف فقط. النتائج المشابهة تحتاج مراجعة هوية المنتج ومواصفاته.','Même image signifie uniquement le même fichier. Vérifiez l’identité et les caractéristiques des résultats similaires.','Same image means identical file bytes only. Check product identity and specifications for similar results.')}</small>
   {(result.unindexed>0||result.stale>0)&&<small>{l('البحث لا يشمل بعض الصور غير المفهرسة أو غير المتاحة: ','Certaines images non indexées ou indisponibles sont exclues : ','Some unindexed or unavailable images are excluded: ')}{result.unindexed+result.stale}</small>}
   {!result.total&&<small>{l('لم نجد تشابهاً بصرياً كافياً ضمن الصور المفهرسة المطابقة للفلاتر.','Aucune similarité suffisante dans les images indexées correspondant aux filtres.','No sufficient visual similarity among indexed images matching the filters.')}</small>}
 </section>;
}
