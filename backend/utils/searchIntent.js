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
  ['خزف','خزف|ceramique|céramique|ceramic']
]
const units = [
  ['piece','قطعة|قطعه|قطع|بياسة|بياس|بيصات|بيصة|وحدة|وحدات|pieces?|pièces?|pcs|units?','قطعة|قطعه|قطع|piece|pieces|pièce|pièces|unit|units'],
  ['pair','زوج|ازواج|أزواج|pairs?|paires?','زوج|ازواج|أزواج|pair|pairs|paire|paires'],
  ['set','طقم|اطقم|أطقم|sets?|lots?','طقم|اطقم|أطقم|set|sets|lot|lots']
]
const N='([0-9]+(?:[.,][0-9]{1,2})?)'
const money='(?:درهم|د\\.م\\.?|mad|dhs?|dirhams?)'
const lower='(?:اقل من|تحت|moins de|less than|under|below|<(?![=]))'
const lowerEq='(?:على الاكثر|بحد اقصي|حد اقصي|ما يفوتش|مايفوتش|au maximum|at most|max(?:imum)?|<=|≤)'
const upper='(?:اكثر من|فوق|plus de|more than|over|above|>(?![=]))'
const upperEq='(?:على الاقل|au moins|at least|>=|≥|ابتداء من)'
const unitPattern=units.map(x=>x[1]).join('|')
const stop=new Set('بغيت بغينا كنقلب تنقلب كنبحث نبحث ابحث عن على عند ف في من ديال بالجملة جملة مورد موردين تاجر تجار شراء نشري اريد نريد طلب لبيع للبيع بكمية ب ثمن السعر درهم mad dh d م avec en gros grossiste fournisseur fournisseurs cherche recherche je des du de la le les a au pour un une par prix acheter wholesale supplier suppliers want looking for find in at the an to buy unit price per please products product سلع سلعة منتجات منتج و and et'.split(' '))
const bad = message=>Object.assign(new Error(message),{status:400})
function parseIntent(raw) {
  if(typeof raw!=='string'||raw.length>120)throw bad('Invalid search phrase')
  let q=norm(raw)
  const f={version:VERSION,raw,terms:[],groups:[],city:null,cityAliases:[],quantity:null,unit:null,unitAliases:[],moq:null,moqStrict:false,minPrice:null,maxPrice:null,strictMin:false,strictMax:false,budget:null,currency:null,sort:null,verified:false,delivery:false,issues:[]}
  const issue=k=>{if(!f.issues.includes(k))f.issues.push(k)}
  const set=(k,v)=>{if(f[k]!==null&&f[k]!==v)issue('conflict');else f[k]=v}
  const get=(pattern,fn)=>{let m;const r=boundary(pattern);let n=0;while((m=q.match(r))&&n++<12){fn(m);q=q.replace(m[0],' ').replace(/\s+/g,' ').trim()}if(n>1)issue('repeated_condition')}
  const number=v=>Number(v.replace(',','.'))
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
  get('مورد غير موثوق|مورد غير موثق|متجر غير موثق|non verifie|unverified',()=>issue('unsupported_trust'))
  get('مورد موثوق|مورد موثق|متجر موثق|متجر موثوق|fournisseur verifie|verified supplier|verified store',()=>{f.verified=true})
  get('ارخص|رخيص|رخيصة|cheapest|cheap|moins cher|pas cher|lowest',()=>{f.sort='price_asc';set('currency','MAD')})
  // Negation and mixed scope are not silently approximated in this first slice.
  if(boundary('بدون|بلا|ماشي|ليس|غير|الا|باستثناء|sans|without|not|except|excluding|sauf|hors').test(q))issue('unsupported_negation')
  if(boundary('او|ou|or').test(q))issue('ambiguous_or')
  for(const [label,aliases] of cities){get('(?:ف|ب)?(?:'+aliases+')',()=>{set('city',label);f.cityAliases=aliases.split('|')})}
  for(const [label,aliases] of families){const r=boundary(aliases);if(r.test(q)){f.terms.push(label);f.groups.push(aliases.split('|'));q=q.replace(new RegExp(r.source,'gu'),' ')}}
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
function regexes(values,exact=false) {
  return values.map(value=>new RegExp((exact?'^':'(?<![\\p{L}\\p{N}])')+escapeRegex(value)+(exact?'$':'(?![\\p{L}\\p{N}])'),'iu'))
}
module.exports={VERSION,parseIntent,regexes}
