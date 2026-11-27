require('./helpers/pilotIsolation')
process.env.JWT_SECRET = 'catalog-integration-test-secret'
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Product = require('../models/Product')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Organization = require('../models/Organization')
const Membership = require('../models/Membership')
const { generateToken } = require('../middleware/auth')
const { mediaFixture } = require('./helpers/mediaFixture')
const app = express()
app.use(express.json())
app.use('/api/products', require('../routes/products'))
app.use('/api/ai-search', require('../routes/aiSearch'))
app.use('/api/tracking', require('../routes/tracking'))
app.use((err, req, res, next) => res.status(err.status || (err.name === 'ValidationError' ? 400 : 500)).json({ message: err.message }))

let mongo, owner, other, buyer, store, otherStore, token, otherToken, buyerToken, ownerImage, otherImage
const published = (extra = {}) => ({
  name: 'حذاء مهني', category: 'أحذية', price: 50, currency: 'MAD', country: 'MA',
  moq: 10, unit: 'زوج', city: 'فاس', description: 'وصف مؤكد من المورد لهذا المنتج',
  imageUrl: ownerImage,
  hasImageRights: true, imageRights: { source: 'owned' },
  availability: 'in_stock', availabilityConfirmed: true, inStock: true,
  isDraft: false, publishApproved: true, storeId: String(store._id), ...extra
})
const create = (body, auth = token) => request(app).post('/api/products').set('Authorization', 'Bearer ' + auth).send(body)

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  ;[owner, other, buyer] = await Supplier.create([
    { name: 'مصنع الأمل', email: 'owner@catalog.test', password: 'test', role: 'supplier', phone: '+212611111111' },
    { name: 'مورد آخر', email: 'other@catalog.test', password: 'test', role: 'supplier' },
    { name: 'مشتري', email: 'buyer@catalog.test', password: 'test', role: 'buyer' }
  ])
  store = await Store.create({ supplierId: owner._id, name: 'متجر الأمل', slug: 'owner', reviewStatus: 'approved', isActive: true })
  otherStore = await Store.create({ supplierId: other._id, name: 'متجر آخر', slug: 'other', reviewStatus: 'approved', isActive: true })
  await Organization.create({ name: 'شركة الأمل', ownerSupplierId: owner._id })
  ownerImage = await mediaFixture(owner)
  otherImage = await mediaFixture(other)
  token = generateToken(owner); otherToken = generateToken(other); buyerToken = generateToken(buyer)
}, 120000)
beforeEach(async () => { await Product.deleteMany({}) })
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

test('incomplete drafts are private and have no implicit rights or availability', async () => {
  const res = await create({ storeId: '', name: '', category: '', description: '', imageUrl: '' })
  expect(res.status).toBe(201)
  expect(res.body.product).toMatchObject({ isDraft: true, hasImageRights: false, inStock: false, availability: 'unknown', availabilityConfirmed: false })
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  expect((await request(app).get('/api/tracking/trending')).body.data).toHaveLength(0)
  expect((await request(app).get('/api/products/mine').set('Authorization', 'Bearer ' + token)).body.data).toHaveLength(1)
})

test('publishing requires explicit approval, rights, availability and an owned approved store', async () => {
  for (const override of [
    { publishApproved: false }, { hasImageRights: false }, { availabilityConfirmed: false },
    { imageUrl: '' }, { description: 'قصير' }, { storeId: String(otherStore._id) },
    { availability: 'unknown' }, { imageRights: { source: 'licensed' } }, { imageUrl: 'javascript:alert(1)' },
    { imageUrl: '/uploads/non-existent.jpg' }
  ]) expect((await create(published(override))).status).toBe(400)
  const pending = await Store.create({ supplierId: owner._id, name: 'قيد المراجعة', slug: 'pending', isActive: false })
  expect((await create(published({ storeId: String(pending._id) }))).status).toBe(400)
  const ok = await create(published({ approvedBy: other._id, supplierId: other._id, views: 999 }))
  expect(ok.status).toBe(201)
  expect(ok.body.product.supplierId).toBe(String(owner._id))
  expect(ok.body.product.approvedBy).toBe(String(owner._id))
  expect(ok.body.product.imageRights.declaredBy).toBe(String(owner._id))
  expect(ok.body.product.views).toBe(0)
  expect(ok.body.product.approvedAt).toBeTruthy()
})

test('draft/public endpoints enforce owner identity and RBAC', async () => {
  const res = await create({ name: 'مسودة' })
  const id = res.body.product._id
  expect((await create({}, buyerToken)).status).toBe(403)
  expect((await request(app).get('/api/products/mine')).status).toBe(401)
  expect((await request(app).put('/api/products/' + id).set('Authorization', 'Bearer ' + otherToken).send({ name: 'سرقة' })).status).toBe(404)
  expect((await request(app).delete('/api/products/' + id).set('Authorization', 'Bearer ' + otherToken)).status).toBe(404)
})

test('active staff with membership manage owner products without taking ownership', async () => {
  const staff = await Supplier.create({ name: 'موظف', email: 'staff@catalog.test', password: 'test', role: 'staff' })
  const org = await Organization.findOne({ ownerSupplierId: owner._id })
  await Membership.create({ userId: staff._id, organizationId: org._id, invitedEmail: staff.email, invitedBy: owner._id, role: 'staff', status: 'active', permissions: ['manage_products'] })
  const res = await create(published(), generateToken(staff))
  expect(res.status).toBe(201)
  expect(res.body.product.supplierId).toBe(String(owner._id))
  expect(res.body.product.approvedBy).toBe(String(staff._id))
})

test('rejects reversed, overlapping, fractional and below-MOQ price tiers', async () => {
  for (const tiers of [
    [{ minQty: 20, maxQty: 10, price: 50 }],
    [{ minQty: 10, maxQty: 30, price: 50 }, { minQty: 20, price: 45 }],
    [{ minQty: 1, price: 40 }],
    [{ minQty: 10.5, price: 40 }]
  ]) expect((await create(published({ priceTiers: tiers }))).status).toBe(400)
})

test('on-request pricing has no fabricated numeric price', async () => {
  const res = await create(published({ pricingMode: 'on_request', price: null }))
  expect(res.status).toBe(201)
  expect(res.body.product.pricingMode).toBe('on_request')
  expect(res.body.product.price).toBeUndefined()
  const list = await request(app).get('/api/products')
  expect(list.body.data[0].currency).toBe('MAD')
  expect(list.body.data[0].pricingMode).toBe('on_request')
})

test('published update needs renewed explicit approval and rights', async () => {
  const res = await create(published())
  const edit = await request(app).put('/api/products/' + res.body.product._id).set('Authorization', 'Bearer ' + token).send({ name: 'تعديل' })
  expect(edit.status).toBe(400)
})

test('public catalog and tracking exclude drafts, unavailable, moderated, and closed-store products', async () => {
  const visible = await create(published())
  const hidden = await create(published({ name: 'محجوب' }))
  await Product.updateOne({ _id: hidden.body.product._id }, { $set: { moderationStatus: 'hidden' } })
  await create(published({ name: 'غير متوفر', availability: 'out_of_stock', inStock: false }))
  await create({ name: 'مسودة خاصة', imageUrl: ownerImage })
  const inactive = await create(published({ storeId: String(otherStore._id), name: 'متجر مغلق', imageUrl: otherImage }), otherToken)
  await Store.updateOne({ _id: otherStore._id }, { $set: { isActive: false } })
  const list = await request(app).get('/api/products')
  expect(list.status).toBe(200)
  expect(list.body.data.map(p => p._id)).toEqual([visible.body.product._id])
  expect((await request(app).post('/api/tracking/view/' + hidden.body.product._id)).status).toBe(404)
  expect((await request(app).post('/api/tracking/view/' + inactive.body.product._id)).status).toBe(404)
  await Store.updateOne({ _id: otherStore._id }, { $set: { isActive: true } })
})

test('filters use confirmed catalog data, quantity price tiers and supplier names', async () => {
  await create(published({ name: 'حذاء عادي', price: 100, priceTiers: [{ minQty: 10, maxQty: 49, price: 100 }, { minQty: 50, price: 60 }] }))
  await create(published({ name: 'حذاء بعيد', city: 'طنجة', moq: 100, price: 40 }))
  const res = await request(app).get('/api/products/search').query({ q: 'حذاء', city: 'فاس', quantity: 60, minPrice: 55, maxPrice: 65, supplier: 'الأمل', currency: 'MAD', order: 'price_asc' })
  expect(res.status).toBe(200)
  expect(res.body.data).toHaveLength(1)
  expect(res.body.data[0].effectiveUnitPrice).toBe(60)
  for (const query of [{ quantity: -1 }, { minPrice: 100, maxPrice: 1 }, { city: ['a', 'b'] }, { order: 'unsafe' }]) {
    expect((await request(app).get('/api/products/search').query(query)).status).toBe(400)
  }
})

test('pagination and totals include all matches, exact title text comes before similar words', async () => {
  for (let i = 0; i < 7; i++) await create(published({ name: 'حذاء موديل ' + i }))
  await create(published({ name: 'حذاء' }))
  const res = await request(app).post('/api/ai-search').send({ query: 'حذاء', limit: 3, page: 1 })
  expect(res.status).toBe(200)
  expect(res.body.total).toBe(8)
  expect(res.body.exactCount).toBe(1)
  expect(res.body.products[0].name).toBe('حذاء')
  expect(res.body.products[0].matchBasis).toBe('title_text')
  const second = await request(app).post('/api/ai-search').send({ query: 'حذاء', limit: 3, page: 2 })
  expect(second.body.products).toHaveLength(3)
  expect(second.body.products.some(p => res.body.products.map(x => x._id).includes(p._id))).toBe(false)
  const mine = await request(app).get('/api/products/mine?page=2&limit=3').set('Authorization', 'Bearer ' + token)
  expect(mine.body.pagination.total).toBe(8)
  expect(mine.body.data).toHaveLength(3)
})

test('special regex input cannot change query structure or throw', async () => {
  for (const q of ['[a-z', '(', '(a+)+', '*+', '??', '{\\']) {
    const res = await request(app).get('/api/products/search').query({ q })
    expect(res.status).toBe(200)
    expect(res.body.pagination.total).toBe(0)
  }
})

test('deactivated supplier catalog disappears immediately and deletion records completed audit', async () => {
  const res = await create(published())
  await Supplier.updateOne({ _id: owner._id }, { $set: { isActive: false } })
  expect((await request(app).get('/api/products')).body.data).toHaveLength(0)
  await Supplier.updateOne({ _id: owner._id }, { $set: { isActive: true } })
  expect((await request(app).delete('/api/products/' + res.body.product._id).set('Authorization', 'Bearer ' + token)).status).toBe(200)
  const event = await require('../models/AuditLog').findOne({ action: 'PRODUCT_DELETED', targetId: res.body.product._id })
  expect(event.phase).toBe('completed')
  expect(String(event.performedBy.id)).toBe(String(owner._id))
})

test('category directory groups all public products independently of product page and paginates categories', async () => {
  const first = await create(published({ name: 'First synthetic item', category: 'Textile' }))
  expect(first.status).toBe(201)
  const source = await Product.collection.findOne({ _id: new mongoose.Types.ObjectId(first.body.product._id) })
  const copies = []
  for(let i=0;i<14;i++) { const {_id,...rest}=source; copies.push({...rest, name:'Synthetic textile '+i, category:'Textile', views:100+i}) }
  const {_id,...rest}=source
  copies.push({...rest, name:'Late category synthetic', category:'Textile accessories', views:0})
  copies.push({...rest, name:'Third category synthetic', category:'Electronics', views:0})
  await Product.collection.insertMany(copies)
  const firstPage=await request(app).get('/api/products/search?limit=12')
  expect(firstPage.body.data).toHaveLength(12)
  expect(firstPage.body.data.every(p=>p.category==='Textile')).toBe(true)
  const all=await request(app).get('/api/products/categories')
  expect(all.status).toBe(200)
  expect(all.headers['cache-control']).toBe('no-store')
  expect(all.body.data).toEqual([{category:'Textile',count:15},{category:'Electronics',count:1},{category:'Textile accessories',count:1}])
  expect(all.body.pagination.total).toBe(3)
  const page=await request(app).get('/api/products/categories?page=2&limit=1')
  expect(page.body.data).toEqual([{category:'Electronics',count:1}])
  expect(page.body.pagination).toMatchObject({page:2,pages:3,hasNextPage:true,hasPrevPage:true})
  expect((await request(app).get('/api/products/search').query({category:'Textile'})).body.pagination.total).toBe(16)
  expect((await request(app).get('/api/products/search').query({category:'Textile',categoryMode:'exact'})).body.pagination.total).toBe(15)
  const text=await request(app).post('/api/ai-search').send({query:'Synthetic',category:'Textile accessories',categoryMode:'exact'})
  expect(text.status).toBe(200);expect(text.body.total).toBe(1)
})
test('category directory and catalog exclude private, invalid ownership, inactive and malformed legacy data', async()=>{
  const r=await create(published({category:'Public category'}));expect(r.status).toBe(201)
  const {_id,...source}=await Product.collection.findOne({_id:new mongoose.Types.ObjectId(r.body.product._id)})
  const otherProduct=await create(published({storeId:String(otherStore._id),imageUrl:otherImage,category:'Other public'}),otherToken)
  expect(otherProduct.status).toBe(201)
  await Supplier.updateOne({_id:owner._id},{$set:{businessTypes:['manufacturer']}})
  await Product.collection.insertMany([
    {...source,category:'Private category',isDraft:true},
    {...source,category:'Hidden category',moderationStatus:'hidden'},
    {...source,category:'Unavailable category',inStock:false},
    {...source,category:'Foreign store category',storeId:otherStore._id},
    {...source,category:'Foreign supplier category',supplierId:other._id},
    {...source,category:['Malformed legacy category']},
    {...source,category:'   '},
    {...source,category:' padded '}
  ])
  try {
    const general=await request(app).get('/api/products/categories')
    expect(general.status).toBe(200);expect(general.body.data).toEqual([{category:'Other public',count:1},{category:'Public category',count:1}])
    const typed=await request(app).get('/api/products/categories?businessType=manufacturer')
    expect(typed.body.data).toEqual([{category:'Public category',count:1}])
    expect((await request(app).get('/api/products/categories?businessType=importer')).body.data).toEqual([])
    const list=await request(app).get('/api/products/search')
    expect(list.body.data.some(p=>String(p.storeId)===String(otherStore._id)&&String(p.supplierId?._id)===String(owner._id))).toBe(false)
    expect(list.body.data.some(p=>p.category==='Foreign supplier category')).toBe(false)
    const foreign=await Product.findOne({category:'Foreign store category'})
    expect((await request(app).get('/api/products/'+foreign._id)).status).toBe(404)
    expect((await request(app).post('/api/tracking/view/'+foreign._id)).status).toBe(404)
    await Store.updateOne({_id:store._id},{$set:{isActive:false}})
    expect((await request(app).get('/api/products/categories?businessType=manufacturer')).body.data).toEqual([])
    expect((await Supplier.updateOne({_id:other._id},{$set:{isActive:false}})).matchedCount).toBe(1)
    expect((await request(app).get('/api/products/categories')).body.data).toEqual([])
  } finally {
    await Store.updateOne({_id:store._id},{$set:{isActive:true}})
    await Supplier.updateOne({_id:owner._id},{$set:{businessTypes:[]}})
    await Supplier.updateOne({_id:other._id},{$set:{isActive:true}})
  }
})
test('category directory and exact category option reject invalid query shapes',async()=>{
  for(const suffix of ['?businessType=invalid','?page=0','?limit=-1','?category=private','?businessType%5B%24ne%5D=x','?page=1&page=2']){
    expect((await request(app).get('/api/products/categories'+suffix)).status).toBe(400)
  }
  for(const suffix of ['?categoryMode=invalid','?categoryMode=exact&categoryMode=contains','?category%5B%24ne%5D=x','?categoryMode%5B%24ne%5D=x']){
    expect((await request(app).get('/api/products/search'+suffix)).status).toBe(400)
  }
})

test('reference taxonomy directory exposes all 10 sectors and 36 scoped leaves, not demo inventory',async()=>{
 const r=await request(app).get('/api/products/taxonomy')
 expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store')
 expect(r.body.version).toBe('v49-1');expect(r.body.sectors).toHaveLength(10)
 const leaves=r.body.sectors.flatMap(s=>s.children)
 expect(leaves).toHaveLength(36);expect(new Set(leaves.map(c=>c.path)).size).toBe(36)
 expect(leaves.map(c=>c.path)).toEqual(expect.arrayContaining(['home/fixtures','building/fixtures','agri/tools','auto/tools','building/tools','textile/kids']))
 expect(leaves.every(c=>c.labels.length===3&&Object.keys(c).length===2)).toBe(true)
})
test('taxonomy filters use explicit paths and only exact reference legacy labels at sector level',async()=>{
 const a=await create(published({category:'Custom textiles',taxonomyPath:'textile/kids'}))
 const b=await create(published({category:'نسيج'}))
 const c=await create(published({category:'نسيج',taxonomyPath:'home/decor'}))
 const d=await create(published({category:'نسيج إضافي'}))
 const e=await create(published({category:'Doors',taxonomyPath:'building/fixtures'}))
 const f=await create(published({category:'Doors',taxonomyPath:'home/fixtures'}))
 expect([a,b,c,d,e,f].map(x=>x.status)).toEqual([201,201,201,201,201,201])
 await create({category:'Private',taxonomyPath:'textile/kids',isDraft:true})
 const { _id,...copy }=await Product.collection.findOne({_id:new mongoose.Types.ObjectId(a.body.product._id)})
 await Product.collection.insertOne({...copy,category:'Invalid owner',storeId:otherStore._id})
 const find=async taxonomyPath=>{const r=await request(app).get('/api/products/search').query({taxonomyPath});expect(r.status).toBe(200);return r.body.data.map(x=>x._id).sort()}
 expect(await find('textile')).toEqual([a.body.product._id,b.body.product._id].sort())
 expect(await find('textile/kids')).toEqual([a.body.product._id])
 expect(await find('building/fixtures')).toEqual([e.body.product._id])
 expect(await find('home/fixtures')).toEqual([f.body.product._id])
 expect(await find('agri')).toEqual([])
 expect(await find('')).toHaveLength(6)
 const cats=await request(app).get('/api/products/categories').query({taxonomyPath:'textile/kids'})
 expect(cats.status).toBe(200);expect(cats.body.data).toEqual([{category:'Custom textiles',count:1}])
 const combined=await request(app).post('/api/ai-search').send({query:'حذاء',taxonomyPath:'textile/kids',category:'Custom textiles',categoryMode:'exact',quantity:10,supplier:String(owner._id)})
 expect(combined.status).toBe(200);expect(combined.body.products.map(p=>p._id)).toEqual([a.body.product._id])
 expect(combined.body.externalDiscovery).toMatchObject({enabled:false,reason:'taxonomy_scope'})
 expect((await request(app).get('/api/products/'+a.body.product._id)).body.product.taxonomyPath).toBe('textile/kids')
 expect((await Product.collection.findOne({_id:new mongoose.Types.ObjectId(b.body.product._id)})).taxonomyPath).toBeUndefined()
})
test('taxonomy assignment validates shapes, supports clearing and is included in save identity',async()=>{
 for(const invalid of ['textile/fixtures','unknown',' textile','textile/','constructor',null,['textile'],{}]){
  expect((await create({taxonomyPath:invalid})).status).toBe(400)
  expect((await request(app).post('/api/ai-search').send({taxonomyPath:invalid})).status).toBe(400)
 }
 expect((await request(app).get('/api/products/search?taxonomyPath=textile&taxonomyPath=home')).status).toBe(400)
 expect((await request(app).get('/api/products/search?taxonomyPath%5B%24ne%5D=x')).status).toBe(400)
 const key='taxonomy-test-receipt-001'
 const save=body=>request(app).post('/api/products').set('Authorization','Bearer '+token).set('Idempotency-Key',key).send(body)
 const first=await save({name:'Draft',taxonomyPath:'textile/kids'})
 expect(first.status).toBe(201);expect(first.body.product.taxonomyPath).toBe('textile/kids')
 expect((await save({name:'Draft',taxonomyPath:'textile/kids'})).body.creation.replayed).toBe(true)
 expect((await save({name:'Draft',taxonomyPath:'textile/shoes'})).status).toBe(409)
 const id=first.body.product._id
 const update=body=>request(app).put('/api/products/'+id).set('Authorization','Bearer '+token).send(body)
 expect((await update({name:'Edited draft'})).body.product.taxonomyPath).toBe('textile/kids')
 expect((await update({taxonomyPath:'home/fixtures'})).body.product.taxonomyPath).toBe('home/fixtures')
 expect((await update({taxonomyPath:''})).body.product.taxonomyPath).toBe('')
 expect((await request(app).get('/api/products/'+id)).status).toBe(404)
})

test('V4.9 opt-in structured search uses city aliases, conjunction, quantity tier and strict price before pagination',async()=>{
  const a=await create(published({name:'Ceramic cups',category:'Kitchen',city:'Tanger',unit:'piece',price:40,priceTiers:[{minQty:50,price:29}]}))
  await create(published({name:'Ceramic cups',category:'Kitchen',city:'طنجة',unit:'piece',price:30}))
  await create(published({name:'Plastic cups',category:'Kitchen',city:'طنجة',unit:'piece',price:20}))
  await create(published({name:'Ceramic plates',category:'Kitchen',city:'طنجة',unit:'piece',price:20}))
  await create(published({name:'Ceramic cups',category:'Kitchen',city:'فاس',unit:'piece',price:20}))
  await create(published({name:'Ceramic cups',category:'Kitchen',city:'طنجة',unit:'pair',price:20}))
  await create(published({name:'Ceramic cups',category:'Kitchen',city:'طنجة',unit:'piece',price:20,currency:'EUR'}))
  await create(published({name:'Ceramic cups',category:'Kitchen',city:'طنجة',unit:'piece',moq:100,price:20}))
  const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'أكواب خزف في طنجة أقل من ٣٠ درهم كمية ٥٠ قطعة',limit:1})
  expect(r.status).toBe(200);expect(r.body.searchIntent).toMatchObject({city:'طنجة',quantity:50,maxPrice:30,strictMax:true,currency:'MAD',issues:[]})
  expect(r.body.total).toBe(1);expect(r.body.products.map(x=>x._id)).toEqual([a.body.product._id]);expect(r.body.products[0].effectiveUnitPrice).toBe(29)
  const inc=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'tasses céramique à Tanger au maximum 30 MAD quantité 50 pièces'})
  expect(inc.status).toBe(200);expect(inc.body.total).toBe(2)
})
test('structured budget uses goods quantity tiers and never includes unknown prices or currencies',async()=>{
  const a=await create(published({name:'Shoes',unit:'pair',price:80,priceTiers:[{minQty:50,price:40}]}))
  await create(published({name:'Shoes',unit:'pair',price:41}))
  await create(published({name:'Shoes',unit:'pair',pricingMode:'on_request',price:null}))
  await create(published({name:'Shoes',unit:'pair',price:1,currency:'USD'}))
  const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'shoes quantity 50 pairs budget 2000 MAD'})
  expect(r.status).toBe(200);expect(r.body.total).toBe(1);expect(r.body.products[0]._id).toBe(a.body.product._id)
})
test('structured unsupported conditions and explicit conflicting filters fail closed without external discovery',async()=>{
  await create(published({name:'Shoes',price:1}))
  for(const [query,extra,issue] of [
    ['shoes or shirts under 30 MAD',{},'ambiguous_scope'],['shoes with delivery',{},'delivery_unknown'],
    ['shoes under 30 MAD',{currency:'USD'},'currency_conflict'],['shoes quantity 20',{quantity:30},'quantity_conflict'],
    ['shoes under 10 EUR',{},'unparsed_number'],['shoes without leather',{},'unsupported_negation']
  ]){
    const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,...extra})
    expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toContain(issue);expect(r.body.total).toBe(0);expect(r.body.externalDiscovery.enabled).toBe(false);expect(r.body.sourcingOffer.canRequestSourcing).toBe(false)
  }
})

test('structured ranges, strict lower bounds, full token matches and MOQ-based prices remain accurate',async()=>{
  const rows=[];
  for(const fixture of [
    {name:'Ceramic cups',price:40,priceTiers:[{minQty:10,price:20,maxQty:19},{minQty:20,price:19}]},
    {name:'Ceramic cups',price:30},
    {name:'Ceramic cupboard',price:25},
    {name:'Ceramic cups',price:10},
  ]){const r=await create(published({...fixture,category:'Kitchen',unit:'piece'}));expect(r.status).toBe(201);rows.push(r.body.product._id)}
  const run=async query=>{const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query});expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toEqual([]);return r.body}
  const range=await run('ceramic cups 20 - 30 MAD');
  expect(range.total).toBe(2);expect(range.products.map(p=>p._id).sort()).toEqual(rows.slice(0,2).sort())
  const lower=await run('ceramic cups more than 20 MAD');expect(lower.products.map(p=>p._id)).toEqual([rows[1]])
  const qty=await run('ceramic cups under 20 MAD quantity 20 pieces');expect(qty.products.map(p=>p._id).sort()).toEqual([rows[0],rows[3]].sort())
  const budget=await run('ceramic cups budget 200 MAD');expect(budget.products.map(p=>p._id).sort()).toEqual([rows[0],rows[3]].sort())
})
test('structured decimal merchandise budget includes exact amount without floating rounding exclusions',async()=>{
  const a=await create(published({name:'Ceramic cups',category:'Kitchen',unit:'piece',moq:1,price:0.1}));expect(a.status).toBe(201)
  const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'ceramic cups quantity 3 pieces budget 0.30 MAD'});
  expect(r.status).toBe(200);expect(r.body.total).toBe(1);expect(r.body.products[0]._id).toBe(a.body.product._id)
})
test('unsupported units, negative limits and unrecognized versions cannot silently broaden results',async()=>{
  for(const [query,issue] of [['cups quantity 20 kilograms','unsupported_unit'],['cups under -5 MAD','negative'],['cups between 30 and 20 MAD','price_conflict']]){
    const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query});expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toContain(issue);expect(r.body.total).toBe(0)
  }
  expect((await request(app).post('/api/ai-search').send({intentVersion:'unknown',query:'cups'})).status).toBe(400)
})

test('structured OR preserves each subject and its own city/price constraints before pagination',async()=>{
  const fixtures=[
    {name:'Shoes',city:'Tanger',price:24},{name:'Shoes',city:'Tanger',price:30},
    {name:'Shirts',city:'Fes',price:40},{name:'Shirts',city:'Fes',price:50},
    {name:'Shoes',city:'Fes',price:20},{name:'Shirts',city:'Tanger',price:20}
  ];
  const ids=[];
  for(const f of fixtures){const r=await create(published({...f,category:'Wholesale',unit:'piece'}));expect(r.status).toBe(201);ids.push(r.body.product._id)}
  const query='shoes in Tanger under 30 MAD or shirts in Fes under 50 MAD';
  const search=async page=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,limit:1,page});
  const a=await search(1),b=await search(2);
  expect(a.status).toBe(200);expect(a.body.searchIntent.issues).toEqual([]);
  expect(a.body.searchIntent.branches).toHaveLength(2);
  expect(a.body.total).toBe(2);expect(b.body.total).toBe(2);
  expect([...a.body.products,...b.body.products].map(x=>x._id).sort()).toEqual([ids[0],ids[2]].sort());
  const plain=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'shoes or shirts'});
  expect(plain.body.total).toBe(6);
  const restricted=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,city:'Tanger'});
  expect(restricted.body.products.map(x=>x._id)).toEqual([ids[0]]);
});
test('structured OR deduplicates overlapping alternatives and supports explicit city alternatives',async()=>{
  const fixtures=[{name:'Ceramic cups',city:'طنجة'},{name:'Ceramic cups',city:'Casablanca'},{name:'Ceramic cups',city:'Fes'},{name:'Shirts shoes',city:'Fes'}];
  const ids=[];
  for(const f of fixtures){const r=await create(published({...f,category:'Wholesale'}));expect(r.status).toBe(201);ids.push(r.body.product._id)}
  const run=async query=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query});
  const r=await run('أكواب في طنجة أو كازابلانكا');
  expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toEqual([]);
  expect(r.body.products.map(p=>p._id).sort()).toEqual(ids.slice(0,2).sort());
  const both=await run('shoes or shirts');expect(both.body.total).toBe(1);expect(both.body.products[0]._id).toBe(ids[3]);
});
test('explicit lexical and city exclusions apply without weakening publication visibility',async()=>{
  const fixtures=[{name:'Plastic cups',city:'Tanger'},{name:'Ceramic cups',city:'Tanger'},{name:'Plastic cups',city:'Fes'},{name:'Plastic cups',city:'Casablanca'}];
  const ids=[];
  for(const f of fixtures){const r=await create(published({...f,category:'Wholesale'}));expect(r.status).toBe(201);ids.push(r.body.product._id)}
  await Product.updateOne({_id:ids[3]},{$set:{moderationStatus:'hidden'}});
  const run=async query=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query});
  const r=await run('cups without ceramic and except Fes');expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toEqual([]);
  expect(r.body.products.map(x=>x._id)).toEqual([ids[0]]);
  const conflict=await run('ceramic cups without ceramic');expect(conflict.body.searchIntent.issues).toContain('term_conflict');expect(conflict.body.total).toBe(0);
  const partial=await run('cups without ceramic coating');expect(partial.body.searchIntent.issues).toContain('unsupported_negation');expect(partial.body.total).toBe(0);
});
test('verification alternatives refer to canonical administrative status, not a quality guarantee',async()=>{
  const verified=await create(published({name:'Shoes',category:'Wholesale'}));expect(verified.status).toBe(201);
  const plain=await create(published({name:'Shoes',category:'Wholesale',storeId:String(otherStore._id),imageUrl:otherImage}),otherToken);expect(plain.status).toBe(201);
  await Supplier.updateOne({_id:owner._id},{$set:{isVerified:true,verificationStatus:'verified'}});
  await Supplier.updateOne({_id:other._id},{$set:{isVerified:true,verificationStatus:'pending'}});
  try {
    const run=async(query,extra={})=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,...extra});
    const yes=await run('shoes verified supplier');expect(yes.status).toBe(200);expect(yes.body.products.map(p=>p._id)).toEqual([verified.body.product._id]);
    const no=await run('shoes unverified');expect(no.status).toBe(200);expect(no.body.products.map(p=>p._id)).toEqual([plain.body.product._id]);
    const conflict=await run('shoes unverified',{supplierTrust:'verified'});expect(conflict.body.searchIntent.issues).toContain('trust_conflict');expect(conflict.body.total).toBe(0);
  } finally {await Supplier.updateMany({_id:{$in:[owner._id,other._id]}},{$set:{isVerified:false,verificationStatus:'unverified'}})}
});
test('unsupported or ambiguous branch scope fails closed, never returns a partial union',async()=>{
  for(const [query,code] of [
    ['shoes or shirts under 30 MAD','ambiguous_scope'],
    ['shoes quantity 20 or shirts quantity 30','branch_price_context'],
    ['shoes and shirts or cups','mixed_logic'],
    ['shoes or unknownmodel','ambiguous_or'],
    ['shoes in Tanger or Fes under 30 MAD','ambiguous_or'],
    ['shoes in Tanger except Tanger','city_conflict'],
    ['shoes with delivery or shirts','delivery_unknown'],
    ['shoes verified supplier unverified','conflict']
  ]){
    const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query});expect(r.status).toBe(200);
    expect(r.body.searchIntent.issues).toContain(code);expect(r.body.total).toBe(0);expect(r.body.sourcingOffer.canRequestSourcing).toBe(false);
  }
});

test('structured sector aliases use the reference taxonomy, retaining scoped legacy categories and filters',async()=>{
  const a=await create(published({name:'Synthetic goods',category:'Custom category',taxonomyPath:'textile/kids'}))
  const b=await create(published({name:'Synthetic goods',category:'نسيج'}))
  const c=await create(published({name:'Synthetic goods',category:'نسيج',taxonomyPath:'home/decor'}))
  const d=await create(published({name:'Synthetic goods',category:'Textile accessories'}))
  expect([a,b,c,d].map(x=>x.status)).toEqual([201,201,201,201])
  const run=async(query,extra={})=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,...extra})
  const r=await run('textile');expect(r.status).toBe(200);expect(r.body.searchIntent.categoryPath).toBe('textile')
  expect(r.body.products.map(x=>x._id).sort()).toEqual([a.body.product._id,b.body.product._id].sort())
  const or=await run('textile or home');expect(or.status).toBe(200);expect(or.body.searchIntent.issues).toEqual([])
  expect(or.body.products.map(x=>x._id).sort()).toEqual([a,b,c].map(x=>x.body.product._id).sort())
  const narrowed=await run('textile',{taxonomyPath:'textile/kids'});expect(narrowed.body.products.map(x=>x._id)).toEqual([a.body.product._id])
});
test('grouped numbers, common quantity, and authoritative price context are explicit',async()=>{
  const a=await create(published({name:'Shoes',price:80,moq:10,unit:'pair',priceTiers:[{minQty:50,price:40}]}))
  expect(a.status).toBe(201)
  const run=async(query,extra={})=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,...extra})
  const r=await run('shoes quantity 50 pairs budget 2 000 MAD')
  expect(r.status).toBe(200);expect(r.body.total).toBe(1);expect(r.body.searchIntent.budget).toBe(2000)
  expect(r.body.searchPriceContext).toEqual({quantity:50,basis:'quantity'})
  const moq=await run('shoes budget 1.000,00 MAD');expect(moq.status).toBe(200);expect(moq.body.total).toBe(1)
  expect(moq.body.searchIntent.budget).toBe(1000);expect(moq.body.searchPriceContext).toEqual({quantity:null,basis:'moq'})
  const manual=await run('shoes',{quantity:50});expect(manual.body.searchPriceContext).toEqual({quantity:50,basis:'quantity'})
  const ambiguous=await run('بغيت بالجملة');expect(ambiguous.body.searchIntent.issues).toContain('empty_intent');expect(ambiguous.body.total).toBe(0)
});

test('V4.9 explicit condition removal preserves original query, visibility, other filters and exact totals',async()=>{
  const fixtures=[{name:'Ceramic cups',city:'Tanger',price:40},{name:'Ceramic cups',city:'Fes',price:20},{name:'Plastic cups',city:'Tanger',price:20},{name:'Ceramic cups',city:'Tanger',price:25}];
  const ids=[];
  for(const f of fixtures){const r=await create(published({...f,category:'Kitchen',unit:'piece'}));expect(r.status).toBe(201);ids.push(r.body.product._id)}
  await Product.updateOne({_id:ids[3]},{$set:{moderationStatus:'hidden'}});
  const query='ceramic cups in Tanger under 30 MAD';
  const run=async(extra={})=>request(app).post('/api/ai-search').send({query,intentVersion:'v49-1',...extra});
  const initial=await run({includeAlternatives:true,limit:1});expect(initial.status).toBe(200);expect(initial.body.total).toBe(0);
  expect(initial.body.searchIntent.raw).toBe(query);expect(initial.body.searchIntent.removed).toEqual([]);
  expect(initial.body.searchAlternatives).toEqual([{key:'city',total:1},{key:'maxPrice',total:1}]);
  const selected=await run({intentRemovals:['maxPrice'],includeAlternatives:true});expect(selected.status).toBe(200);
  expect(selected.body.products.map(p=>p._id)).toEqual([ids[0]]);expect(selected.body.searchIntent.removed).toEqual(['maxPrice']);
  expect(selected.body.searchIntent.city).toBe('طنجة');expect(selected.body.searchIntent.maxPrice).toBeNull();
  expect(selected.body.searchAlternatives).toEqual([]);
  const manual=await run({intentRemovals:['city'],city:'Tanger'});expect(manual.body.total).toBe(0);
  const both=await run({intentRemovals:['city','maxPrice']});expect(both.body.products.map(p=>p._id).sort()).toEqual(ids.slice(0,2).sort());
  const untouched=await run();expect(untouched.body.total).toBe(0);expect(untouched.body.searchAlternatives).toEqual([]);
});
test('shipping condition cannot be relaxed without explicit choice; alternative counts do not expose products',async()=>{
  const r=await create(published({name:'Shoes',price:20,unit:'pair'}));expect(r.status).toBe(201);
  const query='shoes under 30 MAD with delivery';
  const run=async(extra={})=>request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,...extra});
  const a=await run({includeAlternatives:true});expect(a.status).toBe(200);expect(a.body.total).toBe(0);
  expect(a.body.searchIntent.issues).toEqual(['delivery_unknown']);
  expect(a.body.searchAlternatives).toEqual([{key:'delivery',total:1}]);
  expect(a.body.sourcingOffer.canRequestSourcing).toBe(false);
  const b=await run({intentRemovals:['delivery']});expect(b.status).toBe(200);expect(b.body.searchIntent.issues).toEqual([]);
  expect(b.body.products.map(p=>p._id)).toEqual([r.body.product._id]);
});
test('search removal contract rejects invented keys, duplicate keys, invalid scopes and legacy requests',async()=>{
  for(const extra of [
    {intentRemovals:['supplierId']},{intentRemovals:['city']},{intentRemovals:['maxPrice','maxPrice']},
    {intentRemovals:'maxPrice'},{intentRemovals:[{key:'maxPrice'}]},{includeAlternatives:'true'},
    {intentVersion:undefined,intentRemovals:['maxPrice']},
    {query:'shoes or shirts',intentRemovals:['terms']},
    {query:'shoes without leather',intentRemovals:['terms']}
  ]){
    const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query:'shoes under 30 MAD',...extra});expect(r.status).toBe(400)
  }
  const r=await request(app).post('/api/ai-search?intentRemovals=maxPrice').send({intentVersion:'v49-1',query:'shoes under 30 MAD'});expect(r.status).toBe(400)
});

test('invalid structured quantity returns clarification with no usable price context',async()=>{
 for(const query of ['cups quantity 0','cups quantity 1.5']){
  const r=await request(app).post('/api/ai-search').send({intentVersion:'v49-1',query,includeAlternatives:true});
  expect(r.status).toBe(200);expect(r.body.searchIntent.issues).toContain('quantity');expect(r.body.total).toBe(0);
  expect(r.body.searchPriceContext).toEqual({quantity:null,basis:'base'});expect(r.body.sourcingOffer.canRequestSourcing).toBe(false);
 }
});
