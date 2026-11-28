// Product taxonomy copied from V4.9 industryDefinitions and subtypesV25.
// Demo product IDs are intentionally excluded. Labels: AR, FR, EN.
const SECTORS = [
 {key:'home',legacyLabel:'المنزل',labels:['المنزل والديكور','Maison et décoration','Home & decor'],children:[{key:'decor',labels:['الديكور والمستلزمات المنزلية','Décoration et maison','Home decor']},{key:'fixtures',labels:['الأبواب والنوافذ','Portes et fenêtres','Doors & windows']},{key:'kitchen',labels:['أدوات المطبخ','Cuisine et ustensiles','Kitchenware']},{key:'garden',labels:['الحديقة والمنزل','Jardin et maison','Garden & home']}]},
 {key:'textile',legacyLabel:'نسيج',labels:['النسيج والملابس','Textile et mode','Textiles & apparel'],children:[{key:'fabric',labels:['الأقمشة والمفارش','Tissus et couvertures','Fabric & blankets']},{key:'ready',labels:['الملابس الجاهزة','Prêt-à-porter','Ready-to-wear']},{key:'sports',labels:['الملابس الرياضية','Vêtements de sport','Sportswear']},{key:'kids',labels:['ملابس الأطفال','Vêtements enfants','Kids’ clothes']},{key:'shoes',labels:['الأحذية والحقائب','Chaussures et sacs','Shoes & bags']},{key:'beauty',labels:['إكسسوارات الموضة','Accessoires de mode','Fashion accessories']}]},
 {key:'electronic',legacyLabel:'إلكترونيات',labels:['الإلكترونيات','Électronique','Electronics'],children:[{key:'computing',labels:['الحواسيب والشاشات','Ordinateurs et écrans','Computers & screens']},{key:'mobile',labels:['الهواتف والإكسسوارات','Téléphones et accessoires','Phones & accessories']},{key:'lights',labels:['الإنارة والكهرباء','Éclairage et électrique','Lighting & electrical']},{key:'security',labels:['الكاميرات والمراقبة','Caméras et sécurité','Cameras & security']}]},
 {key:'industry',legacyLabel:'صناعة وآلات',labels:['الصناعة والآلات','Industrie et machines','Industry & machinery'],children:[{key:'machines',labels:['الآلات الصناعية','Machines industrielles','Industrial machines']},{key:'workshop',labels:['معدات الورش','Équipement d’atelier','Workshop equipment']},{key:'parts',labels:['قطع وآليات','Pièces mécaniques','Machinery parts']}]},
 {key:'agri',legacyLabel:'فلاحة وغذاء',labels:['الفلاحة والمواد الغذائية','Agriculture et alimentation','Farming & food'],children:[{key:'produce',labels:['الخضر والفواكه','Fruits et légumes','Fruit & vegetables']},{key:'oil',labels:['زيت الزيتون والمنتجات المحلية','Huile d’olive et terroir','Olive oil & local produce']},{key:'crops',labels:['البذور والأعلاف','Semences et aliments','Seeds & feed']},{key:'tools',labels:['معدات فلاحية','Matériel agricole','Farm equipment']}]},
 {key:'craft',legacyLabel:'صناعة تقليدية',labels:['الحرف والصناعة التقليدية','Artisanat','Crafts & handmade'],children:[{key:'basket',labels:['السلال ومنتجات القش','Paniers et fibres naturelles','Baskets & fibers']},{key:'gifts',labels:['الهدايا والمنتجات التقليدية','Cadeaux artisanaux','Artisan gifts']},{key:'pottery',labels:['الفخار والخزف','Poterie et céramique','Pottery & ceramics']}]},
 {key:'packaging',legacyLabel:'تغليف',labels:['التغليف والتجارة','Emballages et commerce','Packaging & trade'],children:[{key:'boxes',labels:['الصناديق والتغليف','Boîtes et emballages','Boxes & packaging']},{key:'labels',labels:['الأكياس والملصقات','Sacs et étiquettes','Bags & labels']},{key:'logistics',labels:['مستلزمات الشحن','Matériel d’expédition','Shipping supplies']}]},
 {key:'auto',legacyLabel:'سيارات',labels:['السيارات وقطع الغيار','Auto et pièces','Automotive & parts'],children:[{key:'spares',labels:['قطع غيار السيارات','Pièces automobiles','Auto parts']},{key:'moto',labels:['الدراجات ومستلزماتها','Motos et accessoires','Motorcycles & accessories']},{key:'tools',labels:['معدات الصيانة','Matériel d’entretien','Maintenance tools']}]},
 {key:'building',legacyLabel:'بناء',labels:['البناء والتجهيز','Bâtiment et équipements','Construction & tools'],children:[{key:'fixtures',labels:['الأبواب والنوافذ','Portes et fenêtres','Doors & windows']},{key:'materials',labels:['مواد البناء','Matériaux de construction','Building materials']},{key:'tools',labels:['الأدوات والتجهيزات','Outils et équipements','Tools & equipment']}]},
 {key:'beauty',legacyLabel:'تجميل',labels:['الجمال والعناية','Beauté et soins','Beauty & care'],children:[{key:'care',labels:['العناية بالبشرة','Soins de la peau','Skincare']},{key:'hair',labels:['منتجات الشعر','Soins capillaires','Hair products']},{key:'perfume',labels:['العطور والجمال','Parfums et beauté','Fragrance & beauty']}]}
]
const PATHS = Object.freeze(SECTORS.flatMap(s => [s.key, ...s.children.map(c => s.key + '/' + c.key)]))
const validTaxonomyPath = value => typeof value === 'string' && (value === '' || PATHS.includes(value))
function parseTaxonomyPath(input = {}) {
  if (Object.keys(input).some(key => /^taxonomyPath(?:\[|\.)/.test(key)) ||
      (input.taxonomyPath !== undefined && !validTaxonomyPath(input.taxonomyPath))) {
    throw Object.assign(new Error('تصنيف المنتج غير صالح'), { status: 400 })
  }
  return input.taxonomyPath || ''
}
function taxonomyDirectory() {
  return { version: 'v49-1', sectors: SECTORS.map(s => ({ key: s.key, labels: s.labels, children: s.children.map(c => ({ path: s.key + '/' + c.key, labels: c.labels })) })) }
}
// No inference at leaf level. Exact legacy reference labels remain visible
// at their parent only when no explicit classification was supplied.
function applyTaxonomyFilter(filter, path) {
  if (!path) return
  const sector = SECTORS.find(s => s.key === path)
  const expression = sector ? { $or: [
    { $in: ['$taxonomyPath', [sector.key, ...sector.children.map(c => sector.key + '/' + c.key)]] },
    { $and: [{ $eq: [{ $ifNull: ['$taxonomyPath', ''] }, ''] }, { $eq: ['$category', sector.legacyLabel] }] }
  ] } : { $eq: ['$taxonomyPath', path] }
  filter.$and = [...(filter.$and || []), { $expr: expression }]
}
module.exports = { PATHS, validTaxonomyPath, parseTaxonomyPath, taxonomyDirectory, applyTaxonomyFilter }
