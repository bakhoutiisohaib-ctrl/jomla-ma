require('./helpers/pilotIsolation')
process.env.JWT_SECRET = 'synthetic-business-types-test-secret'
const express = require('express')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const AuditLog = require('../models/AuditLog')
const { generateToken } = require('../middleware/auth')
const { mediaFixture } = require('./helpers/mediaFixture')
const { indexProduct } = require('../services/visualIndex')
const fs = require('fs/promises')
const path = require('path')
const app = express()
app.use(express.json())
app.use('/api/suppliers',require('../routes/suppliers'))
app.use('/api/stores',require('../routes/stores'))
app.use('/api/products',require('../routes/products'))
app.use('/api/ai-search',require('../routes/aiSearch'))
app.use('/api/image-search',require('../routes/imageSearch'))
app.use((err,_req,res,_next)=>res.status(err.status || (err.name==='ValidationError'?400:500)).json({message:err.message}))
let mongo, owner, legacy, buyer, staff, admin, store, legacyStore, item, legacyItem, imageUrl
const auth = actor => ({Authorization:'Bearer '+generateToken(actor)})
const change = (actor,body) => request(app).put('/api/suppliers/me/business-types').set(auth(actor)).send(body)
const list = query => request(app).get('/api/products/search').query(query)
const ids = response => response.body.data.map(p=>p._id)
jest.setTimeout(120000)
beforeAll(async()=>{
 mongo=await MongoMemoryServer.create()
 await mongoose.connect(mongo.getUri())
 const create=role=>Supplier.create({name:'Synthetic '+role,email:role+'@types.test',password:'unused',role:role==='legacy'?'supplier':role})
 ;[owner,legacy,buyer,staff,admin]=await Promise.all(['supplier','legacy','buyer','staff','admin'].map(create))
 store=await Store.create({name:'Typed store',supplierId:owner._id,slug:'typed',reviewStatus:'approved',isActive:true})
 legacyStore=await Store.create({name:'Legacy store',supplierId:legacy._id,slug:'legacy',reviewStatus:'approved',isActive:true})
 imageUrl=await mediaFixture(owner)
 const otherImage=await mediaFixture(legacy)
 const publish=async(account,store,imageUrl)=>Product.create({name:'Synthetic shoe',category:'Synthetic footwear',description:'Synthetic published catalog description',city:'Fes',price:20,moq:1,unit:'piece',supplierId:account._id,storeId:store._id,imageUrl,isDraft:false,inStock:true,availability:'in_stock',availabilityConfirmed:true,hasImageRights:true,imageRights:{source:'owned',declaredBy:account._id,declaredAt:new Date()},approvedBy:account._id,approvedAt:new Date()})
 item=await publish(owner,store,imageUrl);legacyItem=await publish(legacy,legacyStore,otherImage)
 await Supplier.collection.updateOne({_id:legacy._id},{$unset:{businessTypes:1}})
})
beforeEach(async()=>{
 await Supplier.updateOne({_id:owner._id},{$set:{businessTypes:[],isActive:true,isVerified:false,verificationStatus:'unverified'}})
 await Store.updateOne({_id:store._id},{$set:{isActive:true}})
})
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()})
test('owner declaration supports multiple activities, returns profile, audits and does not verify account',async()=>{
 const r=await change(owner,{businessTypes:['importer','manufacturer']})
 expect(r.status).toBe(200);expect(r.body.businessTypes).toEqual(['manufacturer','importer'])
 const me=await request(app).get('/api/suppliers/me/profile').set(auth(owner))
 expect(me.body.businessTypes).toEqual(r.body.businessTypes);expect(me.body.isVerified).toBe(false)
 expect(me.body.verificationStatus).toBe('unverified')
 expect(await AuditLog.findOne({action:'SUPPLIER_BUSINESS_TYPES_UPDATED',targetId:owner._id,phase:'completed'})).toBeTruthy()
})
test('only own active supplier can declare; malformed values and injected target fail',async()=>{
 expect((await request(app).put('/api/suppliers/me/business-types').send({businessTypes:[]})).status).toBe(401)
 for(const actor of [buyer,staff,admin])expect((await change(actor,{businessTypes:['manufacturer']})).status).toBe(403)
 for(const body of [{},{businessTypes:null},{businessTypes:'manufacturer'},{businessTypes:['manufacturer','manufacturer']},{businessTypes:['fake']},{businessTypes:[{}]},{businessTypes:['importer'],supplierId:String(legacy._id)}])expect((await change(owner,body)).status).toBe(400)
 expect((await Supplier.findById(owner._id)).businessTypes).toEqual([])
 expect((await Supplier.collection.findOne({_id:legacy._id})).businessTypes).toBeUndefined()
})
test('legacy suppliers remain in general results; filter matches declared activity and can be cleared',async()=>{
 expect(ids(await list({}))).toEqual(expect.arrayContaining([String(item._id),String(legacyItem._id)]))
 await change(owner,{businessTypes:['manufacturer','importer']})
 for(const businessType of ['manufacturer','importer']){
  const r=await list({businessType});expect(r.status).toBe(200);expect(ids(r)).toEqual([String(item._id)])
  expect(r.body.data[0].supplierId).toMatchObject({_id:String(owner._id),businessTypes:['manufacturer','importer'],isVerified:false})
  expect(r.body.data[0].supplierId).not.toHaveProperty('email')
 }
 expect(ids(await list({businessType:'wholesaler'}))).toEqual([])
 expect((await change(owner,{businessTypes:[]})).status).toBe(200)
 expect(ids(await list({businessType:'manufacturer'}))).toEqual([])
 expect(ids(await list({}))).toHaveLength(2)
})
test('text search, store directory and detail share declared data; inactive stores excluded',async()=>{
 await change(owner,{businessTypes:['distributor']})
 const result=await request(app).post('/api/ai-search').send({query:'Synthetic shoe',businessType:'distributor'})
 expect(result.status).toBe(200);expect(result.body.products.map(p=>p._id)).toEqual([String(item._id)])
 const stores=await request(app).get('/api/stores').query({businessType:'distributor'})
 expect(stores.status).toBe(200);expect(ids(stores)).toEqual([String(store._id)])
 const detail=await request(app).get('/api/products/'+item._id)
 expect(detail.body.product.supplierId.businessTypes).toEqual(['distributor'])
 await Store.updateOne({_id:store._id},{$set:{isActive:false}})
 expect(ids(await list({businessType:'distributor'}))).toEqual([])
 expect(ids(await request(app).get('/api/stores').query({businessType:'distributor'}))).toEqual([])
})
test('invalid filter values are rejected rather than silently broadening searches',async()=>{
 for(const businessType of ['invalid',['manufacturer','importer'],{$ne:''}]){
  expect((await list({businessType})).status).toBe(400)
  expect((await request(app).get('/api/stores').query({businessType})).status).toBe(400)
  expect((await request(app).post('/api/ai-search').send({businessType})).status).toBe(400)
 }
})
test('image search applies the declared activity before ranking and pagination',async()=>{
 await change(owner,{businessTypes:['manufacturer']})
 await indexProduct(item._id);await indexProduct(legacyItem._id)
 const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
 const r=await request(app).post('/api/image-search').field('businessType','manufacturer').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
 expect(r.status).toBe(200);expect(r.body.products.map(p=>p._id)).toEqual([String(item._id)])
 expect(r.body.products[0].supplierId.businessTypes).toEqual(['manufacturer'])
 const none=await request(app).post('/api/image-search').field('businessType','wholesaler').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
 expect(none.status).toBe(200);expect(none.body.total).toBe(0)
})
test('registration accepts optional declaration for suppliers only, preserves unknown legacy default',async()=>{
 const payload={name:'Synthetic registered',email:'new-types@types.test',password:'SyntheticOnly123!',city:'Fes',phone:'+212611111111',role:'supplier'}
 const r=await request(app).post('/api/suppliers/register').send({...payload,businessTypes:['artisan','wholesaler','farmer']})
 expect(r.status).toBe(201);expect(r.body.supplier.businessTypes).toEqual(['wholesaler','farmer','artisan']);expect(r.body.supplier.isVerified).toBe(false)
 expect((await request(app).post('/api/suppliers/register').send({...payload,email:'bad-buyer@types.test',role:'buyer',businessTypes:['manufacturer']})).status).toBe(400)
 expect((await request(app).post('/api/suppliers/register').send({...payload,email:'invalid-types@types.test',businessTypes:['invalid']})).status).toBe(400)
})

test('visual search exact category excludes a partial-name match while contains stays compatible',async()=>{
 await Product.updateOne({_id:legacyItem._id},{$set:{category:'Synthetic footwear accessories'}})
 try{
  await indexProduct(item._id);await indexProduct(legacyItem._id)
  const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
  const exact=await request(app).post('/api/image-search').field('category','Synthetic footwear').field('categoryMode','exact').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  expect(exact.status).toBe(200);expect(exact.body.products.map(p=>p._id)).toEqual([String(item._id)])
  const noMatch=await request(app).post('/api/image-search').field('category','Synthetic').field('categoryMode','exact').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  expect(noMatch.status).toBe(200);expect(noMatch.body.total).toBe(0)
  const partial=await request(app).post('/api/image-search').field('category','Synthetic').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  expect(partial.status).toBe(200);expect(partial.body.products.map(p=>p._id)).toContain(String(item._id))
 }finally{await Product.updateOne({_id:legacyItem._id},{$set:{category:'Synthetic footwear'}})}
})

test('new reference groups preserve all six declarations and public search scopes',async()=>{
 const all=['manufacturer','importer','distributor','wholesaler','farmer','artisan']
 const r=await change(owner,{businessTypes:[...all].reverse()})
 expect(r.status).toBe(200);expect(r.body.businessTypes).toEqual(all)
 expect((await Supplier.findById(owner._id)).isVerified).toBe(false)
 await indexProduct(item._id);await indexProduct(legacyItem._id)
 const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
 for(const type of ['farmer','artisan']){
  const p=await list({businessType:type})
  expect(p.status).toBe(200);expect(ids(p)).toEqual([String(item._id)])
  expect(p.body.data[0].supplierId.businessTypes).toEqual(all)
  const categories=await request(app).get('/api/products/categories').query({businessType:type})
  expect(categories.status).toBe(200);expect(categories.body.data).toEqual([{category:'Synthetic footwear',count:1}])
  const stores=await request(app).get('/api/stores').query({businessType:type})
  expect(stores.status).toBe(200);expect(ids(stores)).toEqual([String(store._id)])
  const result=await request(app).post('/api/ai-search').send({query:'Synthetic shoe',businessType:type})
  expect(result.status).toBe(200);expect(result.body.products.map(p=>p._id)).toEqual([String(item._id)])
  const visual=await request(app).post('/api/image-search').field('businessType',type).attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  expect(visual.status).toBe(200);expect(visual.body.products.map(p=>p._id)).toEqual([String(item._id)])
 }
 expect((await change(owner,{businessTypes:[...all,'farmer']})).status).toBe(400)
 expect((await change(buyer,{businessTypes:['artisan']})).status).toBe(403)
 expect((await change(owner,{businessTypes:['farmer']})).status).toBe(200)
 expect(ids(await list({businessType:'artisan'}))).toEqual([])
 expect(ids(await list({}))).toHaveLength(2)
 expect((await Supplier.collection.findOne({_id:legacy._id})).businessTypes).toBeUndefined()
})

test('visual taxonomy scope combines with supplier and activity and never infers a leaf from a legacy category',async()=>{
 await change(owner,{businessTypes:['farmer']})
 await Product.updateOne({_id:item._id},{$set:{taxonomyPath:'textile/shoes'}})
 await Product.updateOne({_id:legacyItem._id},{$set:{category:'نسيج'}})
 try {
  await indexProduct(item._id);await indexProduct(legacyItem._id)
  const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
  const image=(scope,type='',supplier='')=>request(app).post('/api/image-search').field('taxonomyPath',scope).field('businessType',type).field('supplier',supplier).attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  const exact=await image('textile/shoes','farmer',String(owner._id))
  expect(exact.status).toBe(200);expect(exact.body.products.map(p=>p._id)).toEqual([String(item._id)])
  expect(exact.body.externalDiscovery).toMatchObject({enabled:false,reason:'taxonomy_scope'})
  const none=await image('textile/kids')
  expect(none.status).toBe(200);expect(none.body.total).toBe(0)
  const wrong=await image('textile/shoes','farmer',String(legacy._id))
  expect(wrong.status).toBe(200);expect(wrong.body.total).toBe(0)
 }finally{
  await Product.updateOne({_id:item._id},{$unset:{taxonomyPath:1}})
  await Product.updateOne({_id:legacyItem._id},{$set:{category:'Synthetic footwear'}})
 }
})

test('verified supplier scope is applied before paging across catalog, categories, stores, text and image search', async()=>{
 await change(owner,{businessTypes:['manufacturer']})
 await Product.updateOne({_id:item._id},{$set:{taxonomyPath:'textile/shoes'}})
 await Product.updateOne({_id:legacyItem._id},{$set:{taxonomyPath:'textile/shoes'}})
 await Supplier.updateOne({_id:owner._id},{$set:{isVerified:true,verificationStatus:'verified'}})
 await Supplier.updateOne({_id:legacy._id},{$set:{isVerified:true,verificationStatus:'pending',businessTypes:['manufacturer']}})
 try {
  const verified={supplierTrust:'verified'}, scoped={...verified,businessType:'manufacturer',taxonomyPath:'textile/shoes'}
  expect(ids(await list({}))).toHaveLength(2)
  const filtered=await list({...scoped,limit:1,page:1})
  expect(filtered.status).toBe(200);expect(ids(filtered)).toEqual([String(item._id)])
  expect(filtered.body.pagination).toMatchObject({total:1,pages:1})
  expect(ids(await list({...scoped,page:2,limit:1}))).toEqual([])
  const categories=await request(app).get('/api/products/categories').query(scoped)
  expect(categories.status).toBe(200);expect(categories.body.data).toEqual([{category:'Synthetic footwear',count:1}])
  const stores=await request(app).get('/api/stores').query({...verified,businessType:'manufacturer',limit:1})
  expect(stores.status).toBe(200);expect(ids(stores)).toEqual([String(store._id)])
  expect(stores.body.pagination.total).toBe(1)
  const text=await request(app).post('/api/ai-search').send({...verified,query:'Synthetic shoe'})
  expect(text.status).toBe(200);expect(text.body.products.map(p=>p._id)).toEqual([String(item._id)])
  expect(text.body.externalDiscovery).toMatchObject({enabled:false,reason:'supplier_trust_scope'})
  await indexProduct(item._id);await indexProduct(legacyItem._id)
  const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
  const visual=await request(app).post('/api/image-search').field('supplierTrust','verified').field('businessType','manufacturer').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})
  expect(visual.status).toBe(200);expect(visual.body.products.map(p=>p._id)).toEqual([String(item._id)])
  expect(visual.body.externalDiscovery).toMatchObject({enabled:false,reason:'supplier_trust_scope'})
  for(const flags of [{isVerified:false,verificationStatus:'verified'},{isVerified:true,verificationStatus:'pending'},{isVerified:true,verificationStatus:'rejected'},{isVerified:true,verificationStatus:'verified',isActive:false}]){
   await Supplier.updateOne({_id:owner._id},{$set:{isActive:true,...flags}})
   expect(ids(await list(verified))).toEqual([])
   expect(ids(await request(app).get('/api/stores').query(verified))).toEqual([])
  }
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:true,isVerified:true,verificationStatus:'verified'}})
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:true}})
  expect(ids(await list(verified))).toEqual([])
  expect(ids(await request(app).get('/api/stores').query(verified))).toEqual([])
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:false}})
  expect(ids(await list({supplierTrust:''}))).toHaveLength(2)
 }finally{
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:true,isVerified:false,verificationStatus:'unverified'}})
  await Supplier.updateOne({_id:legacy._id},{$set:{isVerified:false,verificationStatus:'unverified'},$unset:{businessTypes:1}})
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:false}})
  await Product.updateMany({_id:{$in:[item._id,legacyItem._id]}},{$unset:{taxonomyPath:1}})
 }
})
test('unsupported trust claims and malformed trust scope are rejected, not broadened',async()=>{
 for(const value of ['top','fast','local','true','unknown',['verified','verified'],{$ne:''}]){
  expect((await list({supplierTrust:value})).status).toBe(400)
  expect((await request(app).get('/api/stores').query({supplierTrust:value})).status).toBe(400)
  expect((await request(app).get('/api/products/categories').query({supplierTrust:value})).status).toBe(400)
  expect((await request(app).post('/api/ai-search').send({supplierTrust:value})).status).toBe(400)
 }
 for(const route of ['/api/products/search','/api/stores','/api/products/categories']){
  expect((await request(app).get(route+'?supplierTrust%5B%24ne%5D=verified')).status).toBe(400)
  expect((await request(app).get(route+'?supplierTrust=verified&supplierTrust=verified')).status).toBe(400)
 }
 const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)))
 expect((await request(app).post('/api/image-search').field('supplierTrust','fast').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'})).status).toBe(400)
})

test('declared Morocco scope excludes default and stale declarations across catalog and directory',async()=>{
 const Organization=require('../models/Organization');
 const update=(actor,body)=>request(app).put('/api/suppliers/me/organization').set(auth(actor)).send(body);
 const scope={supplierTrust:'declared_ma'};
 await Organization.create({ownerSupplierId:legacy._id,name:'Synthetic default company'});
 try{
  expect((await update(owner,{name:'Synthetic company',country:'MA'})).status).toBe(200);
  expect((await list(scope)).status).toBe(200);
  expect(ids(await list(scope))).toEqual([]);
  for(const actor of [staff,buyer,admin])expect((await update(actor,{country:'MA',declareCountry:true})).status).toBe(403);
  for(const body of [{declareCountry:true},{country:'MA',declareCountry:'true'},{country:'ZZZ',declareCountry:true},{country:'MA',declaredCountry:'MA'}])expect((await update(owner,body)).status).toBe(400);
  const saved=await update(owner,{country:'ma',declareCountry:true});expect(saved.status).toBe(200);
  expect(saved.body.organization.declaredCountry).toBe('MA');
  expect((await Supplier.findById(owner._id)).isVerified).toBe(false);
  await change(owner,{businessTypes:['manufacturer']});
  const filtered=await list({...scope,businessType:'manufacturer',limit:1});
  expect(filtered.status).toBe(200);expect(ids(filtered)).toEqual([String(item._id)]);expect(filtered.body.pagination.total).toBe(1);
  expect(ids(await list({...scope,page:2,limit:1}))).toEqual([]);
  expect(ids(await request(app).get('/api/stores').query(scope))).toEqual([String(store._id)]);
  expect((await request(app).get('/api/products/categories').query(scope)).body.data).toEqual([{category:'Synthetic footwear',count:1}]);
  const text=await request(app).post('/api/ai-search').send({...scope,query:'Synthetic shoe'});
  expect(text.status).toBe(200);expect(text.body.products.map(p=>p._id)).toEqual([String(item._id)]);
  expect(text.body.externalDiscovery).toMatchObject({enabled:false,reason:'supplier_trust_scope'});
  await indexProduct(item._id);await indexProduct(legacyItem._id);
  const bytes=await fs.readFile(path.join(process.env.UPLOADS_DIR,path.basename(imageUrl)));
  const visual=await request(app).post('/api/image-search').field('supplierTrust','declared_ma').attach('image',bytes,{filename:'synthetic.png',contentType:'image/png'});
  expect(visual.status).toBe(200);expect(visual.body.products.map(p=>p._id)).toEqual([String(item._id)]);
  expect(visual.body.externalDiscovery).toMatchObject({enabled:false,reason:'supplier_trust_scope'});
  expect((await update(owner,{name:'Synthetic renamed company',country:'MA'})).status).toBe(200);
  expect(ids(await list(scope))).toEqual([String(item._id)]);
  expect((await update(owner,{country:'FR'})).status).toBe(200);
  expect(ids(await list(scope))).toEqual([]);
  expect((await update(owner,{country:'MA'})).status).toBe(200);
  expect(ids(await list(scope))).toEqual([]);
  expect((await update(owner,{country:'MA',declareCountry:true})).status).toBe(200);
  await Organization.collection.updateOne({ownerSupplierId:owner._id},{$set:{country:'FR'}});
  expect(ids(await list(scope))).toEqual([]);
  await Organization.collection.updateOne({ownerSupplierId:owner._id},{$set:{country:'MA'}});
  expect((await update(owner,{declareCountry:false})).status).toBe(200);
  expect(ids(await list(scope))).toEqual([]);
  expect(ids(await list({}))).toHaveLength(2);
 }finally{
  await require('../models/Membership').deleteMany({userId:owner._id});
  await Organization.deleteMany({ownerSupplierId:{$in:[owner._id,legacy._id]}});
  await Supplier.updateOne({_id:owner._id},{$unset:{organizationId:1}});
 }
});

test('declared country scope fails closed for malformed history and preserves owner/store visibility',async()=>{
 const Organization=require('../models/Organization');
 const update=body=>request(app).put('/api/suppliers/me/organization').set(auth(owner)).send(body);
 const scope={supplierTrust:'declared_ma'};
 try{
  const saved=await update({country:'MA',declareCountry:true});
  expect(saved.status).toBe(200);expect(saved.headers['cache-control']).toBe('private, no-store');
  expect((await request(app).get('/api/suppliers/me/organization').set(auth(owner))).headers['cache-control']).toBe('private, no-store');
  const r=await list(scope);expect(r.headers['cache-control']).toBe('no-store');expect(ids(r)).toEqual([String(item._id)]);
  expect(ids(await list({...scope,supplier:String(legacy._id)}))).toEqual([]);
  const foreign=await request(app).get('/api/stores/'+legacyStore._id).query(scope);
  expect(foreign.status).toBe(200);expect(foreign.body.products).toEqual([]);
  for(const bad of [{country:['MA','FR'],declaredCountry:'MA'},{country:'MA',declaredCountry:['MA']},{country:'MA',declaredCountry:null}]){
   await Organization.collection.updateOne({ownerSupplierId:owner._id},{$set:bad});
   expect(ids(await list(scope))).toEqual([]);
   expect(ids(await request(app).get('/api/stores').query(scope))).toEqual([]);
  }
  await Organization.collection.updateOne({ownerSupplierId:owner._id},{$set:{country:'MA',declaredCountry:'MA'}});
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:false}});
  expect(ids(await list(scope))).toEqual([]);
  expect(ids(await request(app).get('/api/stores').query(scope))).toEqual([]);
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:true}});
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:true}});
  expect(ids(await list(scope))).toEqual([]);
  expect(ids(await request(app).get('/api/stores').query(scope))).toEqual([]);
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:false}});
  expect(ids(await list(scope))).toEqual([String(item._id)]);
  expect((await update({country:'MA',declareCountry:false})).status).toBe(200);
  expect(ids(await list(scope))).toEqual([]);
 }finally{
  await require('../models/Membership').deleteMany({userId:owner._id});
  await Organization.deleteMany({ownerSupplierId:owner._id});
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:true},$unset:{organizationId:1}});
  await Store.updateOne({_id:store._id},{$set:{adminSuspended:false}});
 }
});
