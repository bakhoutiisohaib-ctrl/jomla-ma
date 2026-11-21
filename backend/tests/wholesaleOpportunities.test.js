// W1 uses a disposable standalone MongoDB and real route/auth/service code.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
const fs = require('fs'), path = require('path'), os = require('os')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-w1-'))
Object.assign(process.env, { NODE_ENV:'test', JWT_SECRET:'w1-synthetic-secret-no-original-accounts',
  MONGODB_URI:'mongodb://127.0.0.1:1/original_disabled', UPLOADS_DIR:path.join(dir,'uploads'), LOG_DIR:path.join(dir,'logs'),
  DISABLE_REDIS:'1', CLAUDE_API_KEY:'', GOOGLE_APPLICATION_CREDENTIALS:'', EXTERNAL_DISCOVERY_ENABLED:'false' })
fs.mkdirSync(process.env.UPLOADS_DIR)
const mongoose = require('mongoose'), request = require('supertest'), express = require('express')
const { MongoMemoryServer } = require('mongodb-memory-server')
const fixtures = require('./helpers/tradeFixtures')
const Opportunity = require('../models/WholesaleOpportunity'), RFQ = require('../models/QuoteRequest')
const Offer = require('../models/QuoteOffer'), Thread = require('../models/MessageThread'), Notice = require('../models/Notification')
const Product = require('../models/Product'), Store = require('../models/Store'), Supplier = require('../models/Supplier'), Membership = require('../models/Membership')
const { agreementHash } = require('../services/commercialAgreement')
const app = express(); app.use(express.json({limit:'1mb',inflate:false}))
app.use('/api/wholesale-opportunities',require('../routes/wholesaleOpportunities'))
app.use('/api/rfq',require('../routes/rfq')); app.use('/api/media',require('../routes/media'))
app.use((err,_req,res,_next)=>res.status(err.status||500).json({message:err.status&&err.status<500?err.message:'Unavailable'}))
jest.setTimeout(120000)
let mongo,f,serial=0
const auth = (who='supplier')=>({Authorization:'Bearer '+f.tokens[who]})
const key = ()=> 'w1-create-attempt-'+String(++serial).padStart(16,'0')
const body = (extra={})=>({productId:String(f.product._id),title:'فرصة أحذية جملة',description:'وصف فرصة الاختبار',terms:'تعبئة حسب الاتفاق',
  price:90,currency:'MAD',unit:f.product.unit,moq:20,priceTiers:[{minQty:40,maxQty:100,price:85}],expiresAt:new Date(Date.now()+86400000).toISOString(),...extra})
const create = (data=body(),who='supplier',k=key())=>request(app).post('/api/wholesale-opportunities').set(auth(who)).set('Idempotency-Key',k).send(data)
const update = (row,extra={},who='supplier')=>request(app).put('/api/wholesale-opportunities/'+row._id).set(auth(who)).send({...body(),revision:row.revision,status:'published',...extra})
async function published(extra={}) { const draft=await create(body(extra)); expect(draft.status).toBe(201); const pub=await update(draft.body.opportunity,extra); expect(pub.status).toBe(200); return pub.body.opportunity }
beforeAll(async()=>{
  mongo=await MongoMemoryServer.create({instance:{storageEngine:'wiredTiger',dbName:'w1_isolated'}})
  await mongoose.connect(mongo.getUri('w1_isolated')); f=await fixtures()
  await Promise.all([Opportunity.init(),RFQ.init(),Offer.init(),Thread.init(),Notice.init()])
})
beforeEach(async()=>{
  jest.restoreAllMocks()
  await Promise.all([Opportunity.deleteMany({}),RFQ.deleteMany({}),Offer.deleteMany({}),Thread.deleteMany({}),Notice.deleteMany({}),
    Product.updateOne({_id:f.product._id},{$set:{isDraft:false,inStock:true,moderationStatus:'visible',moq:10,name:f.product.name,description:f.product.description,unit:'زوج',currency:'MAD',storeId:f.store._id,supplierId:f.supplier._id}}),
    Store.updateOne({_id:f.store._id},{$set:{reviewStatus:'approved',isActive:true,adminSuspended:false}}),
    Supplier.updateOne({_id:f.supplier._id},{$set:{isActive:true}}),
    Membership.updateOne({_id:f.membership._id},{$set:{permissions:['manage_rfq'],status:'active'}})])
})
afterEach(async()=>{jest.restoreAllMocks();if(f && !await Product.exists({_id:f.product._id}))await Product.create(f.product.toObject())})
afterAll(async()=>{ await mongoose.disconnect(); if(mongo)await mongo.stop({doCleanup:false}) })

test('draft -> explicit publish -> public detail/list -> pause, with no private receipt or invented discount',async()=>{
  const saved=await create(),draft=saved.body.opportunity;expect(saved.status).toBe(201);expect(draft.status).toBe('draft')
  expect((await request(app).get('/api/wholesale-opportunities/'+draft._id)).status).toBe(404)
  const pub=await update(draft);expect(pub.status).toBe(200)
  const list=await request(app).get('/api/wholesale-opportunities');expect(list.status).toBe(200);expect(list.body.total).toBe(1)
  const text=JSON.stringify(list.body);for(const field of ['creationReceipt','keyHash','inputHash','password','verificationDoc','iceNumber','discount','referencePrice'])expect(text).not.toContain(field)
  expect(list.body.data[0].supplier).toEqual({_id:String(f.supplier._id),name:f.supplier.name,city:f.supplier.city})
  expect((await request(app).get('/api/wholesale-opportunities/'+draft._id)).body.opportunity.product.name).toBe(f.product.name)
  const paused=await update(pub.body.opportunity,{status:'paused'});expect(paused.status).toBe(200)
  expect((await request(app).get('/api/wholesale-opportunities/'+draft._id)).status).toBe(404)
})
test.each(['buyer','otherBuyer','staff'])('unprivileged %s cannot create or list owner drafts',async who=>{
  expect((await create(body(),who)).status).toBe(403)
  expect((await request(app).get('/api/wholesale-opportunities/mine').set(auth(who))).status).toBe(403)
})
test('live manage_products membership allows own-store staff; revocation immediately removes access',async()=>{
  await Membership.updateOne({_id:f.membership._id},{$set:{permissions:['manage_products']}})
  const draft=await create(body(),'staff');expect(draft.status).toBe(201)
  expect((await update(draft.body.opportunity,{},'staff')).status).toBe(200)
  await Membership.updateOne({_id:f.membership._id},{$set:{status:'revoked'}})
  expect((await request(app).get('/api/wholesale-opportunities/mine').set(auth('staff'))).status).toBe(403)
})
test('foreign supplier cannot edit, publish, pause or privately read another owner opportunity',async()=>{
  const draft=(await create()).body.opportunity
  for(const status of ['published','paused','draft'])expect((await update(draft,{status},'otherSupplier')).status).toBe(404)
  expect((await request(app).get('/api/wholesale-opportunities/mine/'+draft._id).set(auth('otherSupplier'))).status).toBe(404)
  expect((await create(body(),'otherSupplier')).status).toBe(404)
  const injected=await create(body({supplierId:String(f.otherSupplier._id),storeId:new mongoose.Types.ObjectId(),status:'draft'}))
  expect(injected.body.opportunity.supplierId).toBe(String(f.supplier._id));expect(injected.body.opportunity.storeId).toBe(String(f.store._id))
})
test.each([
  {moq:9},{moq:1.5},{moq:0},{price:0},{price:-1},{price:Infinity},{currency:'EUR'},{unit:'كرتون'},
  {priceTiers:[{minQty:10,price:80}]},{priceTiers:[{minQty:20,maxQty:30,price:80},{minQty:30,price:70}]},
  {priceTiers:[{minQty:20,price:80},{minQty:40,price:70}]},{priceTiers:[{minQty:30,maxQty:20,price:70}]},
  {priceTiers:[{minQty:20,price:-1}]},{priceTiers:Array.from({length:21},(_,i)=>({minQty:20+i,maxQty:20+i,price:80}))},
  {expiresAt:'bad-date'},{title:'x'.repeat(161)},{description:'x'.repeat(2001)},{terms:{'$ne':null}}
])('rejects invalid commercial/input data %j on server',async extra=>{
  expect((await create(body(extra))).status).toBe(400);expect(await Opportunity.countDocuments()).toBe(0)
})
test('integer normalized tiers are valid; prices are filtered at requested quantity with an explicit currency',async()=>{
  const row=await published()
  const result=await request(app).get('/api/wholesale-opportunities?quantity=40&maxPrice=86&currency=MAD&category='+encodeURIComponent('أحذية'))
  expect(result.status).toBe(200);expect(result.body.data[0]._id).toBe(row._id);expect(result.body.data[0].effectivePrice).toBe(85)
  expect((await request(app).get('/api/wholesale-opportunities?quantity=19')).body.total).toBe(0)
  expect((await request(app).get('/api/wholesale-opportunities?maxPrice=86')).status).toBe(400)
  expect((await request(app).get('/api/wholesale-opportunities?currency[$ne]=MAD')).status).toBe(200)
})
test('an open-ended tier has no invented upper quantity bound in public price filtering',async()=>{
  const row=await published({priceTiers:[{minQty:40,price:85}]})
  const result=await request(app).get('/api/wholesale-opportunities?quantity=2000000000&maxPrice=86&currency=MAD')
  expect(result.status).toBe(200);expect(result.body.data[0]._id).toBe(row._id);expect(result.body.data[0].effectivePrice).toBe(85)
})
test.each(['draft','hidden','store-pending','store-suspended','supplier-disabled','deleted','ownership-changed','unit-changed'])('public detail/list/RFQ fail closed after parent becomes %s',async kind=>{
  const row=await published()
  if(kind==='draft')await Product.updateOne({_id:f.product._id},{$set:{isDraft:true}})
  if(kind==='hidden')await Product.updateOne({_id:f.product._id},{$set:{moderationStatus:'hidden'}})
  if(kind==='store-pending')await Store.updateOne({_id:f.store._id},{$set:{reviewStatus:'pending'}})
  if(kind==='store-suspended')await Store.updateOne({_id:f.store._id},{$set:{adminSuspended:true}})
  if(kind==='supplier-disabled')await Supplier.updateOne({_id:f.supplier._id},{$set:{isActive:false}})
  if(kind==='deleted')await Product.deleteOne({_id:f.product._id}) // disposable fixture only
  if(kind==='ownership-changed')await Product.updateOne({_id:f.product._id},{$set:{supplierId:f.otherSupplier._id}})
  if(kind==='unit-changed')await Product.updateOne({_id:f.product._id},{$set:{unit:'كرتون'}})
  expect((await request(app).get('/api/wholesale-opportunities/'+row._id)).status).toBe(404)
  expect((await request(app).get('/api/wholesale-opportunities')).body.total).toBe(0)
  const rfq=await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',key()).send({productId:String(f.product._id),opportunityId:row._id,quantity:40,buyerPhone:'+212600000001'})
  expect(rfq.status).toBeGreaterThanOrEqual(400);expect(await RFQ.countDocuments()).toBe(0)
})
test('expiry is enforced in reads and new RFQs, and cannot be published in past',async()=>{
  const draft=(await create(body({expiresAt:'2020-01-01T00:00:00.000Z'}))).body.opportunity
  expect((await update(draft,{expiresAt:'2020-01-01T00:00:00.000Z'})).status).toBe(400)
  const row=await published();await Opportunity.updateOne({_id:row._id},{$set:{expiresAt:new Date(0)}})
  expect((await request(app).get('/api/wholesale-opportunities/'+row._id)).status).toBe(404)
  const rfq=await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',key()).send({productId:String(f.product._id),opportunityId:row._id,quantity:40,buyerPhone:'+212600000001'})
  expect(rfq.status).toBe(404);expect(await RFQ.countDocuments()).toBe(0)
})
test('creation requires a key; same concurrent/ack-lost attempts return one current opportunity; mismatched payload conflicts',async()=>{
  const data=body(),k=key()
  expect((await request(app).post('/api/wholesale-opportunities').set(auth()).send(data)).status).toBe(400)
  const original=Opportunity.create.bind(Opportunity)
  jest.spyOn(Opportunity,'create').mockImplementationOnce(async(...args)=>{await original(...args);throw Error('Synthetic ack loss')})
  const results=await Promise.all(Array.from({length:6},()=>create(data,'supplier',k)))
  expect(results.map(r=>r.status)).toEqual(Array(6).fill(201));expect(new Set(results.map(r=>r.body.opportunity._id)).size).toBe(1)
  expect(await Opportunity.countDocuments()).toBe(1)
  const row=(await update(results[0].body.opportunity)).body.opportunity
  expect((await create(data,'supplier',k)).body.opportunity.status).toBe('published')
  expect((await create({...data,price:91},'supplier',k)).status).toBe(409)
  expect((await update(row,{revision:0})).status).toBe(409)
})
test('published product eligibility is mandatory even for saving an opportunity draft',async()=>{
  await Product.updateOne({_id:f.product._id},{$set:{isDraft:true}})
  expect((await create()).status).toBe(404)
})
test('full existing RFQ creation -> supplier offer -> buyer acceptance keeps frozen opportunity and exact-once effects',async()=>{
  let row=await published(),k=key()
  const input={productId:String(f.product._id),opportunityId:row._id,quantity:40,buyerPhone:'+212600000001',wholesaleOpportunity:{price:1,terms:'forged'}}
  const post=()=>request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',k).send(input)
  const sent=await post();expect(sent.status).toBe(201)
  const rfqId=sent.body.rfq._id,snapshot=sent.body.rfq.wholesaleOpportunity
  expect(snapshot.indicativeUnitPrice).toBe(85);expect(snapshot.terms).toBe('تعبئة حسب الاتفاق')
  expect(snapshot.quantity).toBe(40);expect(snapshot.unit).toBe('زوج')
  row=(await update(row,{price:98,terms:'شروط جديدة'})).body.opportunity
  await Opportunity.updateOne({_id:row._id},{$set:{expiresAt:new Date(0)}})
  const replay=await post();expect(replay.status).toBe(201);expect(replay.body.rfq._id).toBe(rfqId);expect(replay.body.rfq.wholesaleOpportunity).toEqual(snapshot)
  const offered=await request(app).put('/api/rfq/'+rfqId+'/respond').set(auth()).set('Idempotency-Key',key()).send({unitPrice:88,deliveryDays:3,notes:'سعر متفاوض عليه'})
  expect(offered.status).toBe(200)
  const decision=()=>request(app).put('/api/rfq/'+rfqId+'/action').set(auth('buyer')).send({action:'accept',offerId:offered.body.offer._id})
  expect((await decision()).status).toBe(200)
  const agreed=(await RFQ.findById(rfqId)).decision.agreement,beforeHash=agreementHash(agreed)
  expect(agreed.unitPrice).toBe(88);expect(agreed.totalPrice).toBe(3520);expect(agreed.wholesaleOpportunity.terms).toBe(snapshot.terms)
  const changedAgain=await update(row,{price:110,terms:'شروط بعد الاتفاق',status:'paused'});expect(changedAgain.status).toBe(200)
  expect((await decision()).status).toBe(200);expect(agreementHash((await RFQ.findById(rfqId)).decision.agreement)).toBe(beforeHash)
  expect(await RFQ.countDocuments()).toBe(1);expect(await Offer.countDocuments()).toBe(1);expect(await Thread.countDocuments()).toBe(1)
  expect(await Notice.countDocuments({type:'rfq_created'})).toBe(1);expect(await Notice.countDocuments({type:'offer_received'})).toBe(1);expect(await Notice.countDocuments({type:'offer_decision'})).toBe(1)
})
test('opportunity MOQ, product match and buyer authorization are enforced before RFQ creation',async()=>{
  const row=await published(),base={productId:String(f.product._id),opportunityId:row._id,quantity:19,buyerPhone:'+212600000001'}
  expect((await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',key()).send(base)).status).toBe(400)
  expect((await request(app).post('/api/rfq').set(auth()).set('Idempotency-Key',key()).send({...base,quantity:40})).status).toBe(403)
  expect((await request(app).post('/api/rfq').send({...base,quantity:40})).status).toBe(401)
  expect((await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',key()).send({...base,quantity:40,opportunityId:String(new mongoose.Types.ObjectId())})).status).toBe(404)
  expect(await RFQ.countDocuments()).toBe(0)
})
test('linked RFQ pending creation resumes from its original receipt after opportunity expiry without duplicate effects',async()=>{
  const row=await published(),k=key(),input={productId:String(f.product._id),opportunityId:row._id,quantity:40,buyerPhone:'+212600000001'}
  jest.spyOn(Thread,'updateOne').mockRejectedValueOnce(Error('Synthetic conversation failure'))
  const post=()=>request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',k).send(input)
  const pending=await post();expect(pending.status).toBe(202);expect(pending.body.rfq.status).toBe('creating')
  await Opportunity.updateOne({_id:row._id},{$set:{expiresAt:new Date(0),terms:'later terms'}})
  const resumed=await post();expect(resumed.status).toBe(201);expect(resumed.body.rfq._id).toBe(pending.body.rfq._id)
  expect(resumed.body.rfq.wholesaleOpportunity).toEqual(pending.body.rfq.wholesaleOpportunity)
  expect(await RFQ.countDocuments()).toBe(1);expect(await Thread.countDocuments()).toBe(1);expect(await Notice.countDocuments({type:'rfq_created'})).toBe(1)
  const conflict=await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',k).send({...input,opportunityId:String(new mongoose.Types.ObjectId())})
  expect(conflict.status).toBe(409)
})
test('public/owner projections do not reveal receipts and invalid/private/nonexistent ids have the same public result',async()=>{
  const draft=(await create()).body.opportunity
  const [invalid,missing,privateRow]=await Promise.all(['not-an-id',String(new mongoose.Types.ObjectId()),draft._id].map(value=>request(app).get('/api/wholesale-opportunities/'+value)))
  expect([invalid.status,missing.status,privateRow.status]).toEqual([404,404,404]);expect(invalid.body).toEqual(missing.body);expect(missing.body).toEqual(privateRow.body)
  const mine=await request(app).get('/api/wholesale-opportunities/mine').set(auth())
  expect(mine.headers['cache-control']).toContain('no-store');expect(JSON.stringify(mine.body)).not.toMatch(/creationReceipt|keyHash|inputHash|actorId/)
})
test('new keys permit independently identical opportunities and pagination stays stable',async()=>{
  const data=body(),a=(await create(data)).body.opportunity,b=(await create(data)).body.opportunity
  expect(a._id).not.toBe(b._id);expect(await Opportunity.countDocuments()).toBe(2)
  await update(a);await update(b)
  const first=(await request(app).get('/api/wholesale-opportunities?limit=1&page=1')).body
  const second=(await request(app).get('/api/wholesale-opportunities?limit=1&page=2')).body
  expect(first.total).toBe(2);expect(second.data).toHaveLength(1);expect(first.data[0]._id).not.toBe(second.data[0]._id)
})
test('later catalog changes cannot relabel the unit or product definition of a linked RFQ offer',async()=>{
  const row=await published()
  const sent=await request(app).post('/api/rfq').set(auth('buyer')).set('Idempotency-Key',key()).send({productId:String(f.product._id),opportunityId:row._id,quantity:40,buyerPhone:'+212600000001'})
  expect(sent.status).toBe(201)
  await Product.updateOne({_id:f.product._id},{$set:{name:'UPDATED_CATALOG',unit:'كرتون',description:'وصف تغير بعد الطلب'}})
  const offer=await request(app).put('/api/rfq/'+sent.body.rfq._id+'/respond').set(auth()).set('Idempotency-Key',key()).send({unitPrice:88,deliveryDays:3})
  expect(offer.status).toBe(200);expect(offer.body.offer.productSnapshot.name).toBe(f.product.name);expect(offer.body.offer.productSnapshot.unit).toBe('زوج')
})
