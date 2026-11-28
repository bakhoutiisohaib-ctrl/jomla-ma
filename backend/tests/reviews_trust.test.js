require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Review = require('../models/Review')
const Product = require('../models/Product')
const AuditLog = require('../models/AuditLog')
const Analytics = require('../models/Analytics')
const { generateToken } = require('../middleware/auth')
const crypto=require('crypto')
const Confirmation=require('../models/TradeConfirmation')
const Sourcing=require('../models/SourcingRequest')
const RFQ=require('../models/QuoteRequest')
const {definition}=require('../services/sourcingCreationIndex')
async function acceptSourcing(buyer,owner){
  const r=await request(app).post('/api/sourcing').set(auth(buyer.token)).set('Idempotency-Key',crypto.randomUUID()).send({productName:'طلب تجريبي',buyerPhone:'+212655443322',quantity:100,unit:'زوج'});
  expect(r.status).toBe(201);const id=r.body.sourcing._id;
  const q=await request(app).post('/api/sourcing/'+id+'/quote').set(auth(owner.token)).set('Idempotency-Key',crypto.randomUUID()).send({unitPrice:12,deliveryDays:3});
  expect(q.status).toBe(200);const offerId=q.body.quote._id;
  expect((await request(app).put('/api/sourcing/'+id+'/quotes/'+offerId+'/action').set(auth(buyer.token)).send({action:'accept'})).status).toBe(200);
  return '/api/trade-confirmations/sourcing/'+id+'/'+offerId;
}
const confirm=(url,who,body={confirmed:true})=>request(app).post(url).set(auth(who.token)).send(body);
async function completed(buyer,owner){const url=await acceptSourcing(buyer,owner);expect((await confirm(url,buyer)).body.trade.completed).toBe(false);const r=await confirm(url,owner);expect(r.status).toBe(200);expect(r.body.trade.completed).toBe(true);return url;}

let server
let sequence = 0
const auth = token => ({ Authorization: 'Bearer ' + token })
async function account(role = 'buyer') {
  const user = await Supplier.create({ name: 'مستخدم موثوق ' + ++sequence, email: 'trust-' + sequence + '@test.ma', password: 'fixture-hash', role, city:'الرباط',phone:'+212655443322',profilePending:false })
  return { user, token: generateToken(user) }
}
beforeAll(async () => {
  server = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(server.getUri())
  await Review.init()
  await Confirmation.init()
  await Sourcing.collection.createIndex(definition.key,definition.options)
})
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(c => c.deleteMany({})))
})
afterAll(async () => {
  await mongoose.disconnect()
  if (server) await server.stop()
})

test('reviews require buyer identity and mutual confirmation and refuse forged names, supplier replies and dates', async () => {
  const owner = await account('supplier')
  const buyer = await account()
  const body = { supplierId: String(owner.user._id), stars: 4, comment: 'تقييم قائم على تجربتي' }
  expect((await request(app).post('/api/reviews').send(body)).status).toBe(401)
  expect((await request(app).post('/api/reviews').set(auth(owner.token)).send(body)).status).toBe(403)
  for (const extra of [{ userName: 'شخص آخر' }, { reply: { text: 'رد مورد مزور' } }, { date: '2000-01-01' }]) {
    expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ ...body, ...extra })).status).toBe(400)
  }
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)).status).toBe(403)
  const url=await acceptSourcing(buyer,owner)
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)).status).toBe(403)
  expect((await confirm(url,buyer)).status).toBe(200)
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)).status).toBe(403)
  const admin=await account('admin');expect((await request(app).post('/api/reviews').set(auth(admin.token)).send(body)).status).toBe(403)
  expect((await confirm(url,owner)).status).toBe(200)
  const result = await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)
  expect(result.status).toBe(201)
  expect(result.body.review.userName).toBe(buyer.user.name)
  expect(result.body.review.buyerId).toBe(String(buyer.user._id))
  expect(result.body.review.reply?.text).toBeUndefined()
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send(body)).status).toBe(409)
  expect(await Review.countDocuments()).toBe(1)
})

test('supplier existence, active status and optional product relationship are enforced', async () => {
  const owner = await account('supplier')
  const other = await account('supplier')
  const buyer = await account()
  const draft = await Product.create({ supplierId: other.user._id, name: 'منتج خاص', isDraft: true })
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), productId: String(draft._id), stars: 5 })).status).toBe(400)
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(new mongoose.Types.ObjectId()), stars: 5 })).status).toBe(404)
  await Supplier.updateOne({ _id: owner.user._id }, { $set: { isActive: false } })
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 5 })).status).toBe(404)
  expect(await Review.countDocuments()).toBe(0)
})

test('rating stats aggregate all reviews regardless of page and hide internal buyer ids', async () => {
  const owner = await account('supplier')
  for (const stars of [1, 3, 5]) {
    const buyer = await account()
    await completed(buyer,owner)
    const result = await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars })
    expect(result.status).toBe(201)
  }
  await Review.create({supplierId:owner.user._id,userName:'Legacy',stars:1,comment:'Historical'})
  const response = await request(app).get('/api/reviews/' + owner.user._id + '?page=2&limit=1')
  expect(response.status).toBe(200)
  expect(response.body.data).toHaveLength(1)
  expect(response.body.stats).toEqual({ avg: 3, total: 3 })
  expect(response.body.pagination.total).toBe(4)
  expect(response.body.legacyTotal).toBe(1)
  expect(response.body.data[0]).not.toHaveProperty('tradeConfirmationId')
  expect(response.body.data[0]).not.toHaveProperty('buyerId')
})

test('only the owning supplier can reply and only an admin can remove a review with an audit', async () => {
  const owner = await account('supplier')
  const other = await account('supplier')
  const buyer = await account()
  const admin = await account('admin')
  await completed(buyer,owner)
  const created = await request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 1, comment: 'تجربة تحتاج تحسيناً' })
  const id = created.body.review._id
  expect((await request(app).post('/api/suppliers/me/reviews/' + id + '/reply').set(auth(other.token)).send({ text: 'رد منتحل' })).status).toBe(404)
  const reply = await request(app).post('/api/suppliers/me/reviews/' + id + '/reply').set(auth(owner.token)).send({ text: 'شكراً، سنتواصل لمعالجة المشكلة' })
  expect(reply.status).toBe(200)
  expect(await AuditLog.countDocuments({ action: 'REVIEW_REPLIED', targetId: id, phase: 'completed' })).toBe(1)
  expect((await request(app).delete('/api/suppliers/me/reviews/' + id).set(auth(owner.token))).status).toBe(403)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(owner.token)).send({ reason: 'حذف التقييم السلبي' })).status).toBe(403)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(admin.token)).send({})).status).toBe(400)
  expect((await request(app).delete('/api/reviews/' + id).set(auth(admin.token)).send({ reason: 'تقييم مخالف بعد المراجعة' })).status).toBe(200)
  expect(await Review.findById(id)).toBeNull()
  expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:5})).status).toBe(409)
  expect(await AuditLog.countDocuments({ action: 'REVIEW_DELETED', targetId: id, phase: 'completed', 'performedBy.id': admin.user._id })).toBe(1)
})

test('concurrent reviews from one account create at most one rating', async () => {
  const owner = await account('supplier')
  const buyer = await account()
  await completed(buyer,owner)
  const submit = () => request(app).post('/api/reviews').set(auth(buyer.token)).send({ supplierId: String(owner.user._id), stars: 3 })
  const results = await Promise.all([submit(), submit()])
  expect(results.map(result => result.status).sort()).toEqual([201, 409])
  expect(await Review.countDocuments({ buyerId: buyer.user._id, supplierId: owner.user._id })).toBe(1)
})

test('analytics requires authentication, restricts event metadata and protects summaries to admins', async () => {
  const buyer = await account()
  const admin = await account('admin')
  const event = { event: 'search', meta: { query: 'منتج' } }
  expect((await request(app).post('/api/analytics').send(event)).status).toBe(401)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send(event)).status).toBe(201)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send({ event: 'rfq_created', meta: {} })).status).toBe(400)
  expect((await request(app).post('/api/analytics').set(auth(buyer.token)).send({ event: 'search', meta: { email: 'private@test.ma' } })).status).toBe(400)
  expect((await request(app).get('/api/analytics/summary')).status).toBe(401)
  expect((await request(app).get('/api/analytics/summary').set(auth(buyer.token))).status).toBe(403)
  const summary = await request(app).get('/api/analytics/summary').set(auth(admin.token))
  expect(summary.status).toBe(200)
  expect(summary.body.total).toBe(1)
  expect(await Analytics.countDocuments()).toBe(1)
})


test('actual RFQ receipt, both independent role confirmations, replay, isolation and public privacy', async()=>{
 const f=await require('./helpers/tradeFixtures')()
 const buyer={user:f.buyer,token:f.tokens.buyer},owner={user:f.supplier,token:f.tokens.supplier}
 const body={supplierId:String(f.supplier._id),stars:5,comment:'تعامل فعلي'}
 const eligibility=()=>request(app).get('/api/reviews/eligibility/'+f.supplier._id).set(auth(buyer.token))
 const created=await request(app).post('/api/rfq').set(auth(buyer.token)).set('Idempotency-Key',crypto.randomUUID()).send({productId:String(f.product._id),quantity:40,buyerPhone:f.buyer.phone})
 expect(created.status).toBe(201);const id=created.body.rfq._id
 const offered=await request(app).put('/api/rfq/'+id+'/respond').set(auth(owner.token)).set('Idempotency-Key',crypto.randomUUID()).send({unitPrice:88,deliveryDays:3,notes:'عرض تجريبي'})
 expect(offered.status).toBe(200);const offerId=offered.body.offer._id
 const url='/api/trade-confirmations/rfq/'+id+'/'+offerId
 expect((await confirm(url,buyer)).status).toBe(409)
 const accepted=await request(app).put('/api/rfq/'+id+'/action').set(auth(buyer.token)).send({action:'accept',offerId})
 expect(accepted.status).toBe(200)
 expect((await eligibility()).body.eligible).toBe(false)
 expect((await confirm(url,{token:f.tokens.otherBuyer})).status).toBe(404)
 expect((await confirm(url,{token:f.tokens.otherSupplier})).status).toBe(404)
 expect((await confirm(url,{token:f.tokens.staff})).status).toBe(403)
 expect((await confirm(url,buyer,{confirmed:true,supplierId:String(f.supplier._id)})).status).toBe(400)
 const list=await request(app).get('/api/trade-confirmations?kind=rfq').set(auth(buyer.token))
 expect(list.status).toBe(200);expect(list.body.data[0].sourceId).toBe(id)
 expect((await request(app).get('/api/trade-confirmations?kind=rfq').set(auth(f.tokens.otherBuyer))).body.data).toEqual([])
 const replies=await Promise.all([confirm(url,buyer),confirm(url,owner),confirm(url,buyer)])
 expect(replies.map(x=>x.status)).toEqual([200,200,200])
 expect(await Confirmation.countDocuments()).toBe(1)
 const saved=await Confirmation.findOne().lean();expect(saved.buyerConfirmedAt).toBeInstanceOf(Date);expect(saved.supplierConfirmedAt).toBeInstanceOf(Date)
 expect((await confirm(url,buyer)).body.trade.completed).toBe(true)
 const replayed=await Confirmation.findById(saved._id).lean();expect(replayed.buyerConfirmedAt).toEqual(saved.buyerConfirmedAt)
 expect((await eligibility()).body.eligible).toBe(true)
 expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({...body,basis:'mutual_confirmation'})).status).toBe(400)
 const review=await request(app).post('/api/reviews').set(auth(buyer.token)).send({...body,productId:String(f.product._id)})
 expect(review.status).toBe(201);expect(review.body.review.basis).toBe('mutual_confirmation');expect(review.body.review.tradeConfirmationId).toBeUndefined()
 expect((await eligibility()).body.reason).toBe('already_reviewed')
 const pub=await request(app).get('/api/reviews/'+f.supplier._id)
 expect(pub.body.stats).toEqual({avg:5,total:1});expect(pub.body.data[0].buyerId).toBeUndefined();expect(pub.body.data[0].tradeConfirmationId).toBeUndefined()
 expect((await RFQ.findById(id)).status).toBe('accepted')
})
test('legacy accepted without immutable receipt cannot be confirmed or rated',async()=>{
 const f=await require('./helpers/tradeFixtures')()
 const id=new mongoose.Types.ObjectId(),offerId=new mongoose.Types.ObjectId()
 await RFQ.create({_id:id,buyerId:f.buyer._id,supplierId:f.supplier._id,productId:f.product._id,buyerName:f.buyer.name,buyerPhone:f.buyer.phone,quantity:40,status:'accepted',currentOfferId:offerId})
 expect((await confirm('/api/trade-confirmations/rfq/'+id+'/'+offerId,{token:f.tokens.buyer})).status).toBe(409)
 expect(await Confirmation.countDocuments()).toBe(0)
})


test('orphaned or mismatched confirmation cannot authorize a new review',async()=>{
 const owner=await account('supplier'),buyer=await account();
 const url=await completed(buyer,owner),saved=await Confirmation.findOne().lean();
 const eligibility=()=>request(app).get('/api/reviews/eligibility/'+owner.user._id).set(auth(buyer.token));
 const submit=()=>request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:4});
 expect((await eligibility()).body.eligible).toBe(true);
 await Confirmation.collection.updateOne({_id:saved._id},{$set:{decisionHash:'0'.repeat(64)}});
 expect((await eligibility()).body).toMatchObject({eligible:false,reason:'no_confirmation'});
 expect((await submit()).status).toBe(403);
 await Confirmation.collection.updateOne({_id:saved._id},{$set:{decisionHash:saved.decisionHash}});
 await Sourcing.collection.deleteOne({_id:saved.sourceId});
 expect((await eligibility()).body).toMatchObject({eligible:false,reason:'no_confirmation'});
 expect((await submit()).status).toBe(403);
 expect(await Review.countDocuments()).toBe(0);
 expect(await Confirmation.countDocuments()).toBe(1);
});

test('eligibility skips invalid historical candidates but permits an independently valid confirmation',async()=>{
 const owner=await account('supplier'),buyer=await account();
 await completed(buyer,owner);const invalid=await Confirmation.findOne().lean();
 await Confirmation.collection.updateOne({_id:invalid._id},{$set:{decisionId:new mongoose.Types.ObjectId()}});
 await completed(buyer,owner);
 const valid=await Confirmation.findOne({_id:{$ne:invalid._id}}).lean();
 const result=await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:4});
 expect(result.status).toBe(201);
 const review=await Review.findById(result.body.review._id).select('+tradeConfirmationId').lean();
 expect(String(review.tradeConfirmationId)).toBe(String(valid._id));
 expect(await Confirmation.countDocuments()).toBe(2);
});

test('noncanonical copied confirmation does not qualify even with matching agreement and timestamps',async()=>{
 const owner=await account('supplier'),buyer=await account();await completed(buyer,owner);
 const saved=await Confirmation.findOne().lean();
 await Confirmation.collection.insertOne({...saved,_id:new mongoose.Types.ObjectId()});
 await Confirmation.collection.deleteOne({_id:saved._id});
 const response=await request(app).get('/api/reviews/eligibility/'+owner.user._id).set(auth(buyer.token));
 expect(response.status).toBe(200);expect(response.body.eligible).toBe(false);
 expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:5})).status).toBe(403);
 expect(await Review.countDocuments()).toBe(0);
});

test('private trade dispute is scoped, repeat safe, and never grants review eligibility',async()=>{
 const Report=require('../models/Report'),owner=await account('supplier'),buyer=await account(),outsider=await account(),admin=await account('admin');
 const url=await acceptSourcing(buyer,owner),endpoint=url+'/dispute',details='Synthetic confirmation dispute';
 const send=(who,body={details})=>request(app).post(endpoint).set(auth(who.token)).send(body);
 const get=who=>request(app).get(endpoint).set(auth(who.token));
 expect((await request(app).post(endpoint).send({details})).status).toBe(401);
 expect((await send(outsider)).status).toBe(404);
 expect((await send(admin)).status).toBe(403);
 expect((await send(buyer)).status).toBe(409);
 expect((await confirm(url,buyer)).status).toBe(200);
 expect((await send(owner)).status).toBe(409);
 expect((await send(buyer,{details,reporterId:String(owner.user._id)})).status).toBe(400);
 expect((await send(buyer,{details:'  '})).status).toBe(400);
 expect((await request(app).post('/api/reports').send({targetType:'trade_confirmation',targetId:String(new mongoose.Types.ObjectId()),reason:'confirmation_dispute',details})).status).toBe(400);
 const results=await Promise.all([send(buyer),send(buyer),send(buyer)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,200,201]);
 const id=results[0].body.dispute._id;
 expect(results.every(r=>r.body.dispute._id===id)).toBe(true);
 expect((await send(buyer,{details:'Different claim'})).status).toBe(409);
 expect(await Report.countDocuments({targetType:'trade_confirmation'})).toBe(1);
 expect(await AuditLog.countDocuments({action:'REPORT_SUBMITTED',targetId:id,phase:'completed','performedBy.id':buyer.user._id})).toBe(1);
 const own=await get(buyer),other=await get(owner);
 expect(own.headers['cache-control']).toBe('private, no-store');
 expect(own.body.dispute).toEqual({_id:id,status:'pending'});
 expect(other.body.dispute).toBeNull();
 expect((await get(outsider)).status).toBe(404);
 const list=await request(app).get('/api/reports').set(auth(admin.token));
 expect(list.body.data.find(r=>r._id===id)).toMatchObject({details,reporterId:String(buyer.user._id),tradeDispute:{kind:'sourcing',role:'buyer'}});
 expect((await request(app).get('/api/reports').set(auth(owner.token))).status).toBe(403);
 const decision=body=>request(app).put('/api/reports/'+id+'/resolve').set(auth(admin.token)).send(body);
 expect((await decision({action:'resolved',resolutionNotes:'Admin examined',moderationAction:'suspend_supplier'})).status).toBe(400);
 expect((await decision({action:'resolved',resolutionNotes:'Admin examined',moderationAction:'none'})).status).toBe(200);
 expect((await get(buyer)).body.dispute).toEqual({_id:id,status:'resolved'});
 expect((await send(buyer)).body.dispute.status).toBe('resolved');
 expect((await request(app).get('/api/reviews/eligibility/'+owner.user._id).set(auth(buyer.token))).body.eligible).toBe(false);
 expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:1})).status).toBe(403);
 expect((await confirm(url,owner)).body.trade.completed).toBe(true);
 expect((await send(owner)).status).toBe(409);
 expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:1})).status).toBe(201);
 expect(await Report.countDocuments({targetType:'trade_confirmation'})).toBe(1);
 expect((await Supplier.findById(owner.user._id)).isActive).not.toBe(false);
});

test('trade dispute recovers saved record after acknowledgement loss and never duplicates audit',async()=>{
 const Report=require('../models/Report'),owner=await account('supplier'),buyer=await account();
 const url=await acceptSourcing(buyer,owner);await confirm(url,buyer);
 const endpoint=url+'/dispute',send=()=>request(app).post(endpoint).set(auth(buyer.token)).send({details:'Synthetic saved intent'});
 const original=Report.updateOne;
 const fault=jest.spyOn(Report,'updateOne').mockImplementationOnce(async function(...args){await original.apply(this,args);throw Error('Synthetic lost acknowledgement')});
 try{expect((await send()).status).toBe(200)}finally{fault.mockRestore()}
 expect((await send()).status).toBe(200);
 const saved=await Report.findOne({targetType:'trade_confirmation'}).lean();
 expect(saved).toBeTruthy();
 expect(await Report.countDocuments({targetType:'trade_confirmation'})).toBe(1);
 expect(await AuditLog.countDocuments({action:'REPORT_SUBMITTED',targetId:saved._id,phase:'completed'})).toBe(1);
});

test('trade dispute receipt remains unconfirmed until its durable submission audit is recovered',async()=>{
 const Report=require('../models/Report'),owner=await account('supplier'),buyer=await account();
 const url=await acceptSourcing(buyer,owner);await confirm(url,buyer);
 const endpoint=url+'/dispute',details='Synthetic audit failure',send=()=>request(app).post(endpoint).set(auth(buyer.token)).send({details});
 const fault=jest.spyOn(AuditLog,'updateOne').mockRejectedValueOnce(Error('Synthetic audit failure before write'));
 try{expect((await send()).status).toBe(503)}finally{fault.mockRestore()}
 const saved=await Report.findOne({targetType:'trade_confirmation'}).lean();
 expect(saved).toBeTruthy();
 expect(await AuditLog.countDocuments({action:'REPORT_SUBMITTED',targetId:saved._id})).toBe(0);
 expect((await request(app).get(endpoint).set(auth(buyer.token))).status).toBe(503);
 const admin=await account('admin');
 expect((await request(app).put('/api/reports/'+saved._id+'/resolve').set(auth(admin.token)).send({action:'resolved',resolutionNotes:'Examined',moderationAction:'none'})).status).toBe(503);
 expect((await Report.findById(saved._id)).status).toBe('pending');
 expect((await send()).status).toBe(200);
 const read=await request(app).get(endpoint).set(auth(buyer.token));
 expect(read.status).toBe(200);
 expect(read.body.dispute).toEqual({_id:String(saved._id),status:'pending'});
 expect(await Report.countDocuments({targetType:'trade_confirmation'})).toBe(1);
 expect(await AuditLog.countDocuments({action:'REPORT_SUBMITTED',targetId:saved._id,phase:'completed'})).toBe(1);
 expect((await request(app).get('/api/reviews/eligibility/'+owner.user._id).set(auth(buyer.token))).body.eligible).toBe(false);
});

test('historical rating validates exact linked agreement, preserves negative reviews and never rewrites records',async()=>{
 const owner=await account('supplier'),other=await account('supplier');
 const buyers=await Promise.all(Array.from({length:6},()=>account()));
 async function publish(b,stars){await completed(b,owner);const res=await request(app).post('/api/reviews').set(auth(b.token)).send({supplierId:String(owner.user._id),stars,comment:'Synthetic historical comment'});expect(res.status).toBe(201);return Review.findById(res.body.review._id).select('+tradeConfirmationId').lean()}
 const negative=await publish(buyers[0],1),positive=await publish(buyers[1],5),broken=await publish(buyers[2],5);
 await completed(buyers[2],owner); // another valid agreement must not replace the original link
 const mismatch=await publish(buyers[3],5),early=await publish(buyers[4],5),productMismatch=await publish(buyers[5],5);
 await Review.collection.updateOne({_id:mismatch._id},{$set:{tradeConfirmationId:positive.tradeConfirmationId}});
 await Review.collection.updateOne({_id:early._id},{$set:{date:new Date('2000-01-01')}});
 await Review.collection.updateOne({_id:productMismatch._id},{$set:{productId:new mongoose.Types.ObjectId()}});
 const corrupt=await Confirmation.findById(broken.tradeConfirmationId).lean();
 await Confirmation.collection.updateOne({_id:corrupt._id},{$set:{decisionHash:'0'.repeat(64)}});
 await Supplier.updateOne({_id:buyers[0].user._id},{$set:{isActive:false}});
 const legacy=await Review.create({supplierId:owner.user._id,userName:'Legacy',stars:2,comment:'Keep historical opinion'});
 const orphan=await Review.create({supplierId:owner.user._id,userName:'Orphan',stars:5,basis:'mutual_confirmation',tradeConfirmationId:new mongoose.Types.ObjectId()});
 await Review.create({supplierId:other.user._id,userName:'Other',stars:5});
 const before=await Review.collection.find({}).sort({_id:1}).toArray();
 const url='/api/reviews/'+owner.user._id;
 const res=await request(app).get(url+'?limit=20');expect(res.status).toBe(200);
 expect(res.body.stats).toEqual({avg:3,total:2});expect(res.body.legacyTotal).toBe(6);expect(res.body.pagination.total).toBe(8);
 const byId=new Map(res.body.data.map(r=>[r._id,r]));
 for(const r of [negative,positive])expect(byId.get(String(r._id)).basis).toBe('mutual_confirmation');
 for(const r of [broken,mismatch,early,productMismatch,legacy,orphan])expect(byId.get(String(r._id)).basis).toBeUndefined();
 for(const r of res.body.data){expect(r.buyerId).toBeUndefined();expect(r.tradeConfirmationId).toBeUndefined()}
 expect((await request(app).get(url+'?limit=1&page=2')).body.stats).toEqual({avg:3,total:2});
 const dashboard=await request(app).get('/api/suppliers/me/reviews?limit=20').set(auth(owner.token));
 expect(dashboard.status).toBe(200);expect(dashboard.body.data.find(r=>r._id===String(broken._id)).basis).toBeUndefined();
 const reply=await request(app).post('/api/suppliers/me/reviews/'+broken._id+'/reply').set(auth(owner.token)).send({text:'Synthetic reply'});
 expect(reply.status).toBe(200);expect(reply.body.review.basis).toBeUndefined();
 const after=await Review.collection.find({}).sort({_id:1}).toArray();
 expect(after.map(({reply,...r})=>r)).toEqual(before.map(({reply,...r})=>r));
 expect((await Review.collection.findOne({_id:broken._id})).basis).toBe('mutual_confirmation');
 expect(await Confirmation.countDocuments()).toBe(7);
});

test('historical evidence outage never publishes a partial rating and missing source keeps the opinion',async()=>{
 const owner=await account('supplier'),buyer=await account(),legacyBuyer=await account();
 await completed(buyer,owner);
 const result=await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(owner.user._id),stars:1});
 expect(result.status).toBe(201);
 await Review.create({supplierId:owner.user._id,buyerId:legacyBuyer.user._id,userName:'Legacy without evidence',stars:5});
 const saved=await Confirmation.findOne().lean(),url='/api/reviews/'+owner.user._id;
 const before=await request(app).get(url);expect(before.status).toBe(200);expect(before.headers['cache-control']).toBe('no-store');
 expect(before.body.stats).toEqual({avg:1,total:1});
 const fault=jest.spyOn(Confirmation,'find').mockImplementationOnce(()=>{throw Object.assign(Error('Synthetic evidence unavailable'),{status:503})});
 try{
  const unavailable=await request(app).get(url);
  expect(unavailable.status).toBe(503);expect(unavailable.body.stats).toBeUndefined();expect(unavailable.body.data).toBeUndefined();
 }finally{fault.mockRestore()}
 await Sourcing.collection.deleteOne({_id:saved.sourceId});
 const after=await request(app).get(url);expect(after.status).toBe(200);
 expect(after.body.stats).toEqual({avg:0,total:0});expect(after.body.legacyTotal).toBe(2);
 expect(after.body.data.find(r=>r._id===result.body.review._id)).not.toHaveProperty('basis');
 expect(await Review.countDocuments({supplierId:owner.user._id})).toBe(2);
 expect(await Confirmation.countDocuments()).toBe(1);
});

test('batched historical checks preserve exact BSON scope, RFQ closure and page-boundary classification',async()=>{
 const f=await require('./helpers/tradeFixtures')(),buyer={user:f.buyer,token:f.tokens.buyer},owner={user:f.supplier,token:f.tokens.supplier};
 const created=await request(app).post('/api/rfq').set(auth(buyer.token)).set('Idempotency-Key',crypto.randomUUID()).send({productId:String(f.product._id),quantity:40,buyerPhone:f.buyer.phone});
 expect(created.status).toBe(201);const id=created.body.rfq._id;
 const offered=await request(app).put('/api/rfq/'+id+'/respond').set(auth(owner.token)).set('Idempotency-Key',crypto.randomUUID()).send({unitPrice:88,deliveryDays:3});
 expect(offered.status).toBe(200);const offerId=offered.body.offer._id;
 expect((await request(app).put('/api/rfq/'+id+'/action').set(auth(buyer.token)).send({action:'accept',offerId})).status).toBe(200);
 const trade='/api/trade-confirmations/rfq/'+id+'/'+offerId;
 expect((await confirm(trade,buyer)).status).toBe(200);expect((await confirm(trade,owner)).status).toBe(200);
 expect((await request(app).post('/api/reviews').set(auth(buyer.token)).send({supplierId:String(f.supplier._id),stars:1})).status).toBe(201);
 const saved=await Confirmation.findOne().lean(),r=await Review.findOne({buyerId:f.buyer._id}).select('+tradeConfirmationId').lean();
 const {historicalEvidence,historicalEvidenceBatch}=require('../services/tradeConfirmation');
 const check=async expected=>{expect(await historicalEvidence(r)).toBe(expected);expect(await historicalEvidenceBatch([r])).toEqual([expected]);};
 await check(true);
 await Confirmation.collection.updateOne({_id:saved._id},{$set:{buyerId:String(saved.buyerId)}});await check(false);
 await Confirmation.collection.updateOne({_id:saved._id},{$set:{buyerId:saved.buyerId}});await check(true);
 const Offer=require('../models/QuoteOffer'),Thread=require('../models/MessageThread');
 await Offer.collection.updateOne({_id:new mongoose.Types.ObjectId(offerId)},{$set:{decisionId:String(saved.decisionId)}});await check(false);
 await Offer.collection.updateOne({_id:new mongoose.Types.ObjectId(offerId)},{$set:{decisionId:saved.decisionId}});
 await Thread.collection.updateOne({rfqId:saved.sourceId},{$set:{status:'open'}});await check(false);
 await Thread.collection.updateOne({rfqId:saved.sourceId},{$set:{status:'closed'}});await check(true);
 await Review.collection.insertMany(Array.from({length:65},()=>({supplierId:f.supplier._id,userName:'Synthetic excluded',stars:5,date:new Date(Date.now()+1000)})));
 const url='/api/reviews/'+f.supplier._id;
 const first=await request(app).get(url+'?page=1&limit=5'),last=await request(app).get(url+'?page=14&limit=5');
 for(const res of [first,last]){expect(res.status).toBe(200);expect(res.body.stats).toEqual({avg:1,total:1});expect(res.body.legacyTotal).toBe(65);}
 expect(last.body.data[0].basis).toBe('mutual_confirmation');
 expect(await Review.countDocuments()).toBe(66);
});
