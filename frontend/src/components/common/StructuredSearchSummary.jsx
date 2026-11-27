import { useLabels } from '../../i18n/useLabels';
import '../../styles/atlas-search-intent.css';

const KEYS=['categoryPath','terms','excludedTerms','city','excludedCities','quantity','moq','minPrice','maxPrice','budget','verified','delivery','sort'];
const strings=value=>Array.isArray(value)&&value.every(v=>typeof v==='string');
const count=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const categories={home:['المنزل','Maison','Home'],craft:['صناعة تقليدية','Artisanat','Crafts'],textile:['نسيج','Textile','Textile'],electronic:['إلكترونيات','Électronique','Electronics']};
const families={'أكواب':['أكواب','Tasses','Cups'],'قمصان':['قمصان','Chemises','Shirts'],'أحذية':['أحذية','Chaussures','Shoes'],'شاشات':['شاشات','Écrans','Screens'],'سماعات':['سماعات','Casques','Headphones'],'ملابس الأطفال':['ملابس الأطفال','Vêtements enfants','Children’s clothing'],'خزف':['خزف','Céramique','Ceramic'],'مفارش':['مفارش','Couvertures','Blankets'],'سلال':['سلال','Paniers','Baskets'],'أبواب':['أبواب','Portes','Doors'],'نوافذ':['نوافذ','Fenêtres','Windows'],'هدايا':['هدايا','Cadeaux','Gifts'],'كابلات الشحن':['كابلات الشحن','Câbles de charge','Charging cables'],'شواحن':['شواحن','Chargeurs','Chargers']};
const cities={'طنجة':'Tanger','الدار البيضاء':'Casablanca','مراكش':'Marrakech','فاس':'Fès','القنيطرة':'Kénitra','الرباط':'Rabat','أكادير':'Agadir','تطوان':'Tétouan'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validIntent(f,branch=false){
  return f&&f.version==='v49-1'&&strings(f.terms)&&strings(f.excludedTerms)&&strings(f.excludedCities)&&strings(f.issues)&&
    (f.categoryPath===null||Object.hasOwn(categories,f.categoryPath))&&(f.city===null||typeof f.city==='string')&&
    [f.quantity,f.moq].every(v=>v===null||positive(v)||(f.issues.length>0&&finite(v)))&&[f.minPrice,f.maxPrice,f.budget].every(v=>v===null||finite(v))&&
    ['strictMin','strictMax','moqStrict','delivery'].every(k=>typeof f[k]==='boolean')&&
    (f.verified===null||typeof f.verified==='boolean')&&[null,'piece','pair','set'].includes(f.unit)&&
    [null,'MAD'].includes(f.currency)&&[null,'price_asc'].includes(f.sort)&&
    (!f.branches||(!branch&&Array.isArray(f.branches)&&f.branches.length>=2&&f.branches.length<=3&&f.branches.every(b=>validIntent(b,true))));
}
function present(f,k){
  return Array.isArray(f[k])?f[k].length>0:k==='delivery'?f[k]===true:f[k]!==null&&f[k]!==undefined;
}
// Accept only the confirmed contract for the submitted phrase and removal set.
// Never reconstruct a different request from translated chips.
export function confirmStructuredSearch(data,raw,removed,page){
  const f=data?.searchIntent,p=data?.pagination,c=data?.searchPriceContext,alternatives=data?.searchAlternatives;
  if(!validIntent(f)||f.raw!==raw||!same(f.removed,removed)||!strings(f.removable)||
     new Set(f.removable).size!==f.removable.length||f.removable.some(k=>!KEYS.includes(k)||removed.includes(k)||!present(f,k))||
     !Array.isArray(data.products)||!p||p.page!==page||!count(p.total)||!count(p.pages)||p.limit!==12||
     p.pages!==Math.ceil(p.total/p.limit)||data.total!==p.total||data.products.length>p.limit||
     data.products.length>p.total||(f.issues.length&&(p.total!==0||data.products.length!==0))||
     !c||!['base','moq','quantity'].includes(c.basis)||(c.basis==='quantity'?!positive(c.quantity):c.quantity!==null)||
     !Array.isArray(alternatives)||new Set(alternatives.map(a=>a?.key)).size!==alternatives.length||
     alternatives.some(a=>!a||!f.removable.includes(a.key)||!positive(a.total))||
     (p.total>0&&alternatives.length)||(!data.sourcingOffer||typeof data.sourcingOffer.canRequestSourcing!=='boolean')||
     (f.issues.length&&data.sourcingOffer.canRequestSourcing))throw new Error('UNCONFIRMED_SEARCH');
  return {intent:f,alternatives,total:p.total,canRequestSourcing:data.sourcingOffer.canRequestSourcing,priceContext:c};
}
function chipText(key,value){
  // Preserve the inequality, numeral and currency as one LTR run inside RTL labels.
  if(!['minPrice','maxPrice','moq'].includes(key))return value;
  const match=value.match(/^(.*?)([<>≤≥]\s+\d+(?:\.\d+)?)(.*)$/u);
  if(!match)return value;
  const suffix=key==='moq'?'':match[3];
  return <>{match[1]}<bdi dir="ltr">{match[2]+suffix}</bdi>{key==='moq'?match[3]:''}</>;
}
function labels(f,l){
  const term=v=>Object.hasOwn(families,v)?l(...families[v]):v, city=v=>{const translated=Object.hasOwn(cities,v)?cities[v]:v;return l(v,translated,translated);};
  const unit=f.unit==='pair'?l('زوج','paire','pair'):f.unit==='set'?l('طقم','lot','set'):f.unit==='piece'?l('قطعة','pièce','piece'):'';
  const amount=n=>n+(unit?' '+unit:'');
  return [
    ['categoryPath',f.categoryPath?l(...categories[f.categoryPath]):''],
    ['terms',f.terms.map(term).join(' · ')],
    ['excludedTerms',f.excludedTerms.length?l('بدون ','Sans ','Without ')+f.excludedTerms.map(term).join(' · '):''],
    ['city',f.city?city(f.city):''],
    ['excludedCities',f.excludedCities.length?l('باستثناء ','Sauf ','Except ')+f.excludedCities.map(city).join(' / '):''],
    ['quantity',f.quantity!==null?l('الكمية: ','Qté : ','Quantity: ')+amount(f.quantity):''],
    ['moq',f.moq!==null?'MOQ '+(f.moqStrict?'< ':'≤ ')+amount(f.moq):''],
    ['minPrice',f.minPrice!==null?l('ثمن الوحدة ','Prix unitaire ','Unit price ')+(f.strictMin?'> ':'≥ ')+f.minPrice+' MAD':''],
    ['maxPrice',f.maxPrice!==null?l('ثمن الوحدة ','Prix unitaire ','Unit price ')+(f.strictMax?'< ':'≤ ')+f.maxPrice+' MAD':''],
    ['budget',f.budget!==null?l('ميزانية السلعة: ','Budget marchandises : ','Goods budget: ')+f.budget+' MAD':''],
    ['verified',f.verified===null?'':f.verified?l('مورد موثق','Fournisseur vérifié','Verified supplier'):l('بدون شارة توثيق','Sans badge de vérification','No verification badge')],
    ['delivery',f.delivery?l('شامل التوصيل','Livraison comprise','Shipping included'):''],
    ['sort',f.sort?l('أقل ثمن','Prix croissant','Lowest price'):'']
  ].filter(([,value])=>value);
}
export default function StructuredSearchSummary({result,onRemove,onClear}){
  const l=useLabels(),f=result.intent;
  const items=f.branches?[['branches',f.branches.map(b=>labels(b,l).map(x=>x[1]).join(' · ')).join(l(' أو ',' ou ',' or '))]]:labels(f,l);
  const byKey=Object.fromEntries(items);
  const issue=f.issues.some(k=>k!=='delivery_unknown'), hasDelivery=f.delivery||f.branches?.some(b=>b.delivery);
  const hasBudget=f.budget!==null||f.branches?.some(b=>b.budget!==null);
  return <section className="atlas-search-summary" aria-label={l('شروط البحث','Critères de recherche','Search conditions')}>
    <div className="atlas-search-summary-line"><strong aria-live="polite">{l('نتائج البحث','Résultats','Search results')} · {result.total}</strong><button type="button" className="atlas-search-chip" onClick={onClear}>{l('مسح البحث','Effacer','Clear')}</button></div>
    <div className="atlas-search-chips">{items.map(([key,value])=><button key={key} type="button" className="atlas-search-chip" disabled={key!=='branches'&&!f.removable.includes(key)} aria-label={key==='branches'?l('مسح البحث المركب','Effacer la recherche composée','Clear compound search'):l('إزالة ','Retirer ','Remove ')+value} onClick={()=>key==='branches'?onClear():onRemove(key)}>{chipText(key,value)} ×</button>)}</div>
    {f.removed.length>0&&<small>{l('أزيلت شروط باختيارك. إرسال العبارة من جديد يعيد جميع شروطها.','Critères retirés à votre demande. Relancer la phrase rétablit tous ses critères.','Conditions removed by your choice. Resubmitting the phrase restores them.')}</small>}
    {issue&&<small role="alert">{l('بعض الشروط متعارضة أو غير مفهومة. صحح عبارة البحث؛ لم يتم تخفيفها تلقائياً.','Critères ambigus ou invalides. Corrigez la recherche ; aucun assouplissement automatique.','Ambiguous or invalid criteria. Edit your query; no automatic relaxation.')}</small>}
    {hasDelivery&&<small role="alert">{l('تكلفة التوصيل غير متوفرة؛ احذف الشرط فقط إذا كنت تقبل سعر السلعة دون توصيل.','Livraison inconnue ; retirez ce critère seulement si vous acceptez le prix hors livraison.','Shipping cost unknown; remove the condition only if you accept the goods price without shipping.')}</small>}
    {hasBudget&&<small>{l('تكلفة السلعة فقط حسب شرائح السعر؛ التوصيل غير محتسب.','Marchandises uniquement, livraison non incluse.','Goods only at tier price; shipping excluded.')}</small>}
    {result.alternatives.length>0&&<div className="atlas-search-alternatives"><small>{l('لا توجد نتيجة مطابقة. يمكنك تخفيف شرط واحد باختيارك:','Aucun résultat exact. Retirez un critère si vous le souhaitez :','No exact result. You can relax one condition:')}</small>{result.alternatives.map(a=><button type="button" key={a.key} className="atlas-search-chip" onClick={()=>onRemove(a.key)}>{chipText(a.key,byKey[a.key])} · {a.total} {l('بديل','alternative(s)','alternative(s)')}</button>)}</div>}
  </section>;
}
