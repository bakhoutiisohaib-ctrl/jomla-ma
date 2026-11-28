// V4.9 structured search, deliberately bounded. No demo inventory or AI provider.
const { escapeRegex } = require('./constants')
const VERSION = 'v49-1'
const norm = value => value.normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ـ/g,'').replace(/[٠-٩۰-۹]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.includes(c)?'٠١٢٣٤٥٦٧٨٩'.indexOf(c):'۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).toLowerCase().replace(/\s+/g,' ').trim()
const boundary = pattern => new RegExp('(?<![\\p{L}\\p{N}])(?:'+pattern+')(?![\\p{L}\\p{N}])','u')
const cities = [
  ['طنجة','طنجة|طنجه|tanger|tangier'],['الدار البيضاء','الدار البيضاء|كازابلانكا|كازا|casablanca|casa'],
  ['مراكش','مراكش|marrakech|marrakesh'],['فاس','فاس|fes|fez|fès'],['القنيطرة','القنيطرة|kenitra|kénitra'],
  ['الرباط','الرباط|rabat'],['أكادير','اكادير|agadir|أكادير'],['تطوان','تطوان|tetouan|tétouan']
]
const families = [
  ['أكواب','كيسان|كاس|كؤوس|اكواب|أكواب|tasses|tasse|cups|cup|verres|verre'],
  ['قمصان','تيشرت|تي شيرت|تيشورت|تي شورت|قمصان|قميص|t-shirts|t-shirt|tshirts|tshirt|shirts|shirt'],
  ['أحذية','صباط|سباط|شوز|سبرديلات|سبرديلة|احذية|أحذية|حذاء|chaussures|chaussure|shoes|shoe|sneakers'],
  ['شاشات','شاشات|شاشة|ecrans|ecran|écrans|écran|monitors|monitor|screens|screen'],
  ['سماعات','سماعات|سماعة|casques|casque|headphones|earbuds'],
  ['ملابس الأطفال','ملابس الاطفال|ملابس الأطفال|حوايج الدراري|vetements enfants|vêtements enfants|kids clothing|children clothing'],
  ['خزف','خزف|ceramique|céramique|ceramic'],
  ['مفارش','مفارش|مفرش|غطاء|couvertures|couverture|blankets|blanket'],
  ['سلال','قش|سلال|سلة|paniers|panier|baskets|basket'],
  ['أبواب','ابواب|أبواب|باب|portes|porte|doors|door'],
  ['نوافذ','نوافذ|نافذة|fenetres|fenetre|fenêtres|fenêtre|windows|window'],
  ['هدايا','هدايا|هدية|coffrets|coffret|gifts|gift'],
  ['كابلات الشحن','كابلات الشحن|كابل شحن|charging cables|charging cable|cables de charge|câbles de charge'],
  ['شواحن','شارجور|شاحن|شواحن|chargeurs|chargeur|chargers|charger']
]
const units = [
  ['piece','قطعة|قطعه|قطع|بياسة|بياس|بيصات|بيصة|وحدة|وحدات|pieces?|pièces?|pcs|units?','قطعة|قطعه|قطع|piece|pieces|pièce|pièces|unit|units'],
  ['pair','زوج|ازواج|أزواج|pairs?|paires?','زوج|ازواج|أزواج|pair|pairs|paire|paires'],
  ['set','طقم|اطقم|أطقم|sets?|lots?','طقم|اطقم|أطقم|set|sets|lot|lots']
]
const N='((?:[0-9]{1,3}(?:[ ,.][0-9]{3})+|[0-9]+)(?:[.,][0-9]{1,2})?)'
const money='(?:درهم|د\\.م\\.?|mad|dhs?|dirhams?)'
const lower='(?:اقل من|تحت|moins de|less than|under|below|<(?![=]))'
const lowerEq='(?:على الاكثر|بحد اقصي|حد اقصي|ما يفوتش|مايفوتش|au maximum|at most|max(?:imum)?|<=|≤)'
const upper='(?:اكثر من|فوق|plus de|more than|over|above|>(?![=]))'
const upperEq='(?:على الاقل|au moins|at least|>=|≥|ابتداء من)'
const unitPattern=units.map(x=>x[1]).join('|')
const stop=new Set('بغيت بغينا كنقلب تنقلب كنبحث نبحث ابحث عن على عند ف في من ديال بالجملة جملة مورد موردين تاجر تجار شراء نشري اريد نريد طلب لبيع للبيع بكمية ب ثمن السعر درهم mad dh d م avec en gros grossiste fournisseur fournisseurs cherche recherche je des du de la le les a au pour un une par prix acheter wholesale supplier suppliers want looking for find in at the an to buy unit price per please products product سلع سلعة منتجات منتج و and et'.split(' '))
const bad = message=>Object.assign(new Error(message),{status:400})
function parseSingle(raw) {
  if(typeof raw!=='string'||raw.length>120)throw bad('Invalid search phrase')
  let q=norm(raw)
  const f={version:VERSION,raw,terms:[],groups:[],city:null,cityAliases:[],excludedCities:[],excludedCityAliases:[],excludedTerms:[],excludedGroups:[],subjects:0,categoryPath:null,quantity:null,unit:null,unitAliases:[],moq:null,moqStrict:false,minPrice:null,maxPrice:null,strictMin:false,strictMax:false,budget:null,currency:null,sort:null,verified:null,delivery:false,issues:[]}
  const issue=k=>{if(!f.issues.includes(k))f.issues.push(k)}
  const set=(k,v)=>{if(f[k]!==null&&f[k]!==v)issue('conflict');else f[k]=v}
  const get=(pattern,fn)=>{let m;const r=boundary(pattern);let n=0;while((m=q.match(r))&&n++<12){fn(m);q=q.replace(m[0],' ').replace(/\s+/g,' ').trim()}if(n>1)issue('repeated_condition')}
  const number=v=>Number(v.replace(/\s/g,'').replace(/[.,](?=\d{3}(?:[.,]|$))/g,'').replace(',','.'))
  const setMoney=(k,v)=>{set(k,number(v));set('currency','MAD')}
  const setQty=(k,v,u)=>{const n=number(v);if(!Number.isSafeInteger(n)||n<1)issue('quantity');set(k,n);if(u){const row=units.find(x=>boundary(x[1]).test(u));if(row){set('unit',row[0]);f.unitAliases=row[2].split('|')}}}
  const unsignedRanges=q.replace(new RegExp(N+'\\s*[-–]\\s*'+N+'\\s*'+money,'gu'),' ')
  if(/(?:^|[^\p{L}\p{N}])[-−]\s*\d/u.test(unsignedRanges))issue('negative')
  get('مع التوصيل|شامل التوصيل|بالتوصيل|مع الشحن|شامل الشحن|livraison comprise|livraison incluse|avec livraison|including shipping|with shipping|with delivery|delivery included|shipping included',()=>{f.delivery=true;issue('delivery_unknown')})
  get('(?:ميزانية(?: اجمالية)?|راس المال|budget(?: total)?|capital)\\s*(?:ديال|de|of|:)?\\s*'+N+'\\s*'+money,m=>setMoney('budget',m[1]))
  get('(?:(?:من|بين|entre|from|between)\\s*)?'+N+'\\s*(?:'+money+')?\\s*(?:حتى|حتي|الي|و|a|et|to|and|[-–])\\s*'+N+'\\s*'+money,m=>{setMoney('minPrice',m[1]);setMoney('maxPrice',m[2])})
  get('('+lowerEq+'|'+lower+')\\s*'+N+'\\s*'+money,m=>{setMoney('maxPrice',m[2]);f.strictMax=boundary(lower).test(m[1])})
  get('('+upperEq+'|'+upper+')\\s*'+N+'\\s*'+money,m=>{setMoney('minPrice',m[2]);f.strictMin=boundary(upper).test(m[1])})
  get('(?:اقل طلب|الحد الادني للطلب|moq|minimum de commande|minimum order(?: quantity)?)\\s*(?:ديال|de|of|:)?\\s*('+lowerEq+'|'+lower+')?\\s*'+N+'(?:\\s*('+unitPattern+'))?',m=>{setQty('moq',m[2],m[3]);f.moqStrict=Boolean(m[1]&&boundary(lower).test(m[1]))})
  get('('+lowerEq+'|'+lower+')\\s*'+N+'\\s*('+unitPattern+')',m=>{setQty('moq',m[2],m[3]);f.moqStrict=boundary(lower).test(m[1])})
  get('(?:كمية|بكمية|quantite|quantity|qty)\\s*[:=]?\\s*'+N+'(?:\\s*('+unitPattern+'))?',m=>setQty('quantity',m[1],m[2]))
  get(N+'\\s*('+unitPattern+')',m=>setQty('quantity',m[1],m[2]))
  get('(?:ثمن|السعر|prix|price)\\s*'+N+'\\s*'+money,m=>setMoney('maxPrice',m[1]))
  get(N+'\\s*'+money,m=>setMoney('maxPrice',m[1]))
  get('مورد غير موثوق|مورد غير موثق|متجر غير موثق|non verifie|unverified',()=>set('verified',false))
  get('مورد موثوق|مورد موثق|متجر موثق|متجر موثوق|fournisseur verifie|verified supplier|verified store',()=>set('verified',true))
  get('ارخص|رخيص|رخيصة|cheapest|cheap|moins cher|pas cher|lowest',()=>{f.sort='price_asc';set('currency','MAD')})
  // Exclusions are lexical constraints, not proof of composition.
  const neg='(?:بدون|بلا|ماشي|ليس|غير|الا|باستثناء|sans|without|not|except|excluding|sauf|hors)'
  const tail='(?=\\s*(?:$|[,،;؛]|(?:و|and|et)(?:\\s|$)|'+neg+'\\s))'
  for(const [label,aliases] of cities){
    get(neg+'\\s+(?:ف|ب)?(?:'+aliases+')'+tail,()=>{f.excludedCities.push(label);f.excludedCityAliases.push(...aliases.split('|'))})
  }
  for(const [label,aliases] of families){
    get(neg+'\\s+(?:'+aliases+')'+tail,()=>{f.excludedTerms.push(label);f.excludedGroups.push(aliases.split('|'))})
  }
  if(boundary(neg).test(q))issue('unsupported_negation')
  if(boundary('او|ou|or').test(q))issue('ambiguous_or')
  for(const [label,aliases] of cities){get('(?:ف|ب)?(?:'+aliases+')',()=>{set('city',label);f.cityAliases=aliases.split('|')})}
  for(const [label,aliases] of families){const rr=boundary(aliases);if(rr.test(q)){f.subjects++;f.terms.push(label);f.groups.push(aliases.split('|'));q=q.replace(new RegExp(rr.source,'gu'),' ')}}
  const sectors=[
    ['home','المنزل|منزل|ديكور|home|maison'],
    ['craft','صناعة تقليدية|صناعه تقليديه|حرف|artisanat|crafts|craft'],
    ['textile','نسيج|ملابس|حوايج|textiles|textile|vetements|clothing'],
    ['electronic','الكترونيات|electronique|electronics']
  ]
  for(const [path,aliases] of sectors){
    const rr=boundary(aliases)
    if(rr.test(q)){set('categoryPath',path);q=q.replace(new RegExp(rr.source,'gu'),' ')}
  }
  if(f.categoryPath)f.subjects++
  if(f.city&&f.excludedCities.includes(f.city))issue('city_conflict')
  if(f.terms.some(term=>f.excludedTerms.includes(term)))issue('term_conflict')
  // Unknown residual numeric/comparison conditions require clarification, not partial matching.
  if(/[0-9<>≤≥=]/u.test(q))issue('unparsed_number')
  if((f.quantity!==null||f.moq!==null)&&boundary('kg|kilograms?|kilogrammes?|كيلو|كيلوغرام|grammes?|grams?|غرام|litres?|liters?|لتر|meters?|metres?|متر|dozens?|douzaines?|دزينة').test(q))issue('unsupported_unit')
  if(boundary('اقل من|اكثر من|على الاكثر|على الاقل|moins de|plus de|under|below|budget|ميزانية|livraison|delivery|shipping|توصيل|شحن|eur|usd|euro|dollar').test(q))issue('unparsed_condition')
  const words=q.split(/[\s,;،؛.!?؟]+/u).filter(w=>w&&!stop.has(w))
  if(words.length>10)issue('too_many_terms')
  for(const word of words){if(!/^[\p{L}\p{M}][\p{L}\p{M}-]*$/u.test(word)){issue('unparsed_term');continue}f.terms.push(word);f.groups.push([word])}
  if(f.minPrice!==null&&f.maxPrice!==null&&(f.minPrice>f.maxPrice||(f.minPrice===f.maxPrice&&(f.strictMin||f.strictMax))))issue('price_conflict')
  return f
}
function hasCondition(f) {
  return Boolean(f.city||f.excludedCities.length||f.excludedTerms.length||f.quantity!==null||f.unit||f.moq!==null||
    f.minPrice!==null||f.maxPrice!==null||f.budget!==null||f.verified!==null||f.delivery||f.sort)
}
function parseIntent(raw) {
  if(typeof raw!=='string'||raw.length>120)throw bad('Invalid search phrase')
  const pieces=norm(raw).split(/\s+(?:او|ou|or)\s+/u)
  if(pieces.length===1){
    const f=parseSingle(raw)
    if(raw.trim()&&!f.groups.length&&!f.categoryPath&&!hasCondition(f)&&!f.issues.length)f.issues.push('empty_intent')
    return f
  }
  const result=parseSingle('')
  result.raw=raw
  const invalid=code=>{result.issues=[code];return result}
  if(pieces.length>3||pieces.some(x=>!x.trim()))return invalid('ambiguous_or')
  const branches=pieces.map(parseSingle)
  const first=branches[0]
  const cityOnly=f=>f.city&&!f.groups.length&&!f.categoryPath&&!f.issues.length&&!f.excludedCities.length&&!f.excludedTerms.length&&
    f.quantity===null&&f.moq===null&&f.minPrice===null&&f.maxPrice===null&&f.budget===null&&f.verified===null&&!f.delivery&&!f.sort
  if(first.subjects>0&&first.city&&branches.slice(1).every(cityOnly)){
    if(first.quantity!==null||first.moq!==null||first.minPrice!==null||first.maxPrice!==null||first.budget!==null||
      first.verified!==null||first.delivery||first.sort||first.excludedCities.length||first.excludedTerms.length||first.issues.length)return invalid('ambiguous_scope')
    for(let i=1;i<branches.length;i++)branches[i]={...first,raw:pieces[i],city:branches[i].city,cityAliases:branches[i].cityAliases}
  }else{
    if(branches.some(f=>!f.subjects||f.terms.length!==f.subjects-(f.categoryPath?1:0)))return invalid('ambiguous_or')
    if(branches.some((f,i)=>i>0&&!hasCondition(branches[i-1])&&hasCondition(f)))return invalid('ambiguous_scope')
    if(pieces.some(part=>boundary('و|and|et').test(part))&&branches.some(f=>f.subjects>1))return invalid('mixed_logic')
  }
  // One displayed price context per result. Never silently merge distinct quantities.
  if(branches.some(f=>f.quantity!==first.quantity||f.sort!==first.sort||(first.sort&&f.unit!==first.unit)))return invalid('branch_price_context')
  result.branches=branches
  result.quantity=first.quantity
  result.sort=first.sort
  result.issues=[...new Set(branches.flatMap(f=>f.issues))]
  return result
}
function regexes(values,exact=false) {
  return values.map(value=>new RegExp((exact?'^':'(?<![\\p{L}\\p{N}])')+escapeRegex(value)+(exact?'$':'(?![\\p{L}\\p{N}])'),'iu'))
}

// A removal is an explicit user action against the original parsed phrase.
// Never accept arbitrary predicates or reconstruct the query from translated labels.
const REMOVABLE = ['categoryPath','terms','excludedTerms','city','excludedCities','quantity','moq','minPrice','maxPrice','budget','verified','delivery','sort']
const ALTERNATIVES = ['city','quantity','moq','minPrice','maxPrice','budget','verified','delivery']
function removable(intent) {
  if(intent.branches || intent.issues.some(x=>x!=='delivery_unknown'))return []
  return REMOVABLE.filter(k=>Array.isArray(intent[k])?intent[k].length>0: k==='delivery'?intent[k]===true:intent[k]!==null)
}
function withRemovals(raw,removed=[]) {
  const f=parseIntent(raw)
  if(!Array.isArray(removed)||removed.length>REMOVABLE.length||new Set(removed).size!==removed.length||
    removed.some(k=>typeof k!=='string'||!REMOVABLE.includes(k)||!removable(f).includes(k)))
    throw bad('Invalid search condition removal')
  for(const k of removed){
    if(k==='terms'){f.terms=[];f.groups=[]}
    else if(k==='excludedTerms'){f.excludedTerms=[];f.excludedGroups=[]}
    else if(k==='city'){f.city=null;f.cityAliases=[]}
    else if(k==='excludedCities'){f.excludedCities=[];f.excludedCityAliases=[]}
    else if(k==='delivery'){f.delivery=false;f.issues=f.issues.filter(x=>x!=='delivery_unknown')}
    else {
      f[k]=null
      if(k==='minPrice')f.strictMin=false
      if(k==='maxPrice')f.strictMax=false
      if(k==='moq')f.moqStrict=false
    }
  }
  // The shared unit belongs to the surviving quantity/MOQ constraints.
  if(removed.some(k=>k==='quantity'||k==='moq')&&f.quantity===null&&f.moq===null){f.unit=null;f.unitAliases=[]}
  if(removed.some(k=>['minPrice','maxPrice','budget','sort'].includes(k))&&f.minPrice===null&&f.maxPrice===null&&f.budget===null&&!f.sort)f.currency=null
  return f
}
function alternativeKeys(intent) {
  return removable(intent).filter(k=>ALTERNATIVES.includes(k))
}

// Use the existing lexical family vocabulary, only on the product title.
// Material alone (ceramic) is not a product family.
function comparisonFamilies(name){
  if(typeof name!=='string')return []
  const title=norm(name)
  return families.filter(([label,aliases])=>label!=='خزف'&&boundary(aliases).test(title)).map(([label])=>label)
}
module.exports={VERSION,parseIntent,regexes,withRemovals,removable,alternativeKeys,comparisonFamilies}
