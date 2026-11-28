require('./helpers/pilotIsolation')
const request=require('supertest'),mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server'),{randomUUID}=require('crypto')
const app=require('../server'),fixture=require('./helpers/tradeFixtures')
const Conversation=require('../models/DirectConversation'),Product=require('../models/Product'),Supplier=require('../models/Supplier'),Store=require('../models/Store'),RFQ=require('../models/QuoteRequest'),Confirmation=require('../models/TradeConfirmation')
const url='/api/direct-conversations',auth=t=>({Authorization:'Bearer '+t})
let mongo,f
const payload=(content='Synthetic inquiry',clientId=randomUUID())=>({productId:String(f.product._id),clientId,content})
const start=(p=payload(),token=f.tokens.buyer)=>request(app).post(url).set(auth(token)).send(p)
const reply=(id,p,token=f.tokens.supplier)=>request(app).post(url+'/'+id+'/messages').set(auth(token)).send(p)
const get=(id,token=f.tokens.buyer)=>request(app).get(url+'/'+id).set(auth(token))
beforeAll(async()=>{mongo=await MongoMemoryServer.create({instance:{storageEngine:'wiredTiger'}});await mongoose.connect(mongo.getUri());await Conversation.init()})
beforeEach(async()=>{await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));f=await fixture()})
afterEach(()=>jest.restoreAllMocks())
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()})
test('buyer starts, owner replies, both list and read only their own thread; no trade objects or contact DTO',async()=>{
 const p=payload('  Synthetic question  '),a=await start(p)
 expect(a.status).toBe(201);expect(a.headers['cache-control']).toBe('private, no-store')
 expect(a.body).toMatchObject({actorId:String(f.buyer._id),role:'buyer',message:{clientId:p.clientId,role:'buyer',content:'Synthetic question'},replayed:false})
 const id=a.body.conversation._id
 const b=await reply(id,{clientId:randomUUID(),content:'Synthetic answer'})
 expect(b.status).toBe(201);expect(b.body.message.role).toBe('supplier')
 for(const [role,account] of [['buyer',f.buyer],['supplier',f.supplier]]){
  const list=await request(app).get(url).set(auth(f.tokens[role]));expect(list.status).toBe(200);expect(list.body).toMatchObject({actorId:String(account._id),role,page:1,hasNext:false});expect(list.body.data).toHaveLength(1);expect(list.body.data[0]._id).toBe(id)
  expect(list.body.data[0].messages).toBeUndefined()
  const r=await get(id,f.tokens[role]);expect(r.status).toBe(200);expect(r.body.messages.map(x=>x.content)).toEqual(['Synthetic question','Synthetic answer']);expect(r.body.canSend).toBe(true)
  expect(JSON.stringify(r.body)).not.toMatch(/buyerPhone|supplierPhone|buyerId|supplierId|email|password|@trade.test/)
 }
 expect(await RFQ.countDocuments()).toBe(0);expect(await Confirmation.countDocuments()).toBe(0)
})
test('foreign buyer, foreign supplier and staff cannot inspect or post; owner identity comes from visible product',async()=>{
 const a=await start(),id=a.body.conversation._id
 for(const role of ['otherBuyer','otherSupplier']){
  expect((await get(id,f.tokens[role])).status).toBe(404)
  expect((await reply(id,{clientId:randomUUID(),content:'Synthetic intrusion'},f.tokens[role])).status).toBe(404)
  expect((await request(app).get(url).set(auth(f.tokens[role]))).body.data).toEqual([])
 }
 expect((await get(id,f.tokens.staff)).status).toBe(403)
 expect((await reply(id,{clientId:randomUUID(),content:'Synthetic staff'},f.tokens.staff)).status).toBe(403)
 expect((await request(app).get(url+'/'+id)).status).toBe(401)
 expect((await start(payload(),f.tokens.supplier)).status).toBe(403)
 expect((await start({...payload(),supplierId:String(f.otherSupplier._id)})).status).toBe(400)
 expect((await reply(id,{clientId:randomUUID(),content:'Synthetic spoof',role:'buyer'})).status).toBe(400)
 expect((await Conversation.findById(id)).messages).toHaveLength(1)
})
test('concurrent creation, replay and distinct appends remain one thread and no duplicate message',async()=>{
 const p=payload(),calls=await Promise.all(Array.from({length:4},()=>start(p)))
 expect(calls.map(r=>r.status).sort()).toEqual([200,200,200,201])
 const id=calls[0].body.conversation._id
 expect(new Set(calls.map(r=>r.body.conversation._id)).size).toBe(1)
 expect((await start({...p,content:'Different content'})).status).toBe(409)
 const m={clientId:randomUUID(),content:'Synthetic answer'}
 const replies=await Promise.all(Array.from({length:4},()=>reply(id,m)))
 expect(replies.map(r=>r.status).sort()).toEqual([200,200,200,201])
 expect((await reply(id,{...m,content:'Different reply'})).status).toBe(409)
 const distinct=await Promise.all([reply(id,{clientId:randomUUID(),content:'A'}),reply(id,{clientId:randomUUID(),content:'B'})]);expect(distinct.map(r=>r.status)).toEqual([201,201])
 expect(await Conversation.countDocuments()).toBe(1);expect((await get(id)).body.messages).toHaveLength(4)
})
test('lost write acknowledgment recovered with exact client key, no duplicate on retry',async()=>{
 const a=await start(),id=a.body.conversation._id,m={clientId:randomUUID(),content:'Synthetic uncertain reply'}
 const original=Conversation.updateOne.bind(Conversation),spy=jest.spyOn(Conversation,'updateOne').mockImplementationOnce(async(...args)=>{await original(...args);throw Error('Synthetic lost acknowledgment')})
 const uncertain=await reply(id,m);expect(uncertain.status).toBe(503);expect(uncertain.body.message).not.toContain(m.content);spy.mockRestore()
 const retry=await reply(id,m);expect(retry.status).toBe(200);expect(retry.body.replayed).toBe(true);expect((await get(id)).body.messages).toHaveLength(2)
})
test('hidden product or suspended store prevents new and existing writes; history remains readable',async()=>{
 const a=await start(),id=a.body.conversation._id
 await Product.updateOne({_id:f.product._id},{$set:{isDraft:true}})
 expect((await start(payload(),f.tokens.otherBuyer)).status).toBe(404)
 expect((await get(id)).body.canSend).toBe(false)
 expect((await reply(id,{clientId:randomUUID(),content:'Synthetic blocked'})).status).toBe(409)
 await Product.updateOne({_id:f.product._id},{$set:{isDraft:false}})
 await Store.updateOne({_id:f.store._id},{$set:{adminSuspended:true}})
 expect((await get(id)).body.canSend).toBe(false)
 expect((await start(payload(),f.tokens.otherBuyer)).status).toBe(404)
 await Store.updateOne({_id:f.store._id},{$set:{adminSuspended:false}})
 await Supplier.updateOne({_id:f.buyer._id},{$set:{isActive:false}})
 expect((await get(id)).status).toBe(401)
 expect((await get(id,f.tokens.supplier)).body.canSend).toBe(false)
 expect((await reply(id,{clientId:randomUUID(),content:'Synthetic inactive'})).status).toBe(409)
})
test('strict payload and bounded capacity; concurrent attempts cannot exceed 200 messages',async()=>{
 for(const p of [{...payload(),content:' '},{...payload(),content:'x'.repeat(2001)},{...payload(),clientId:'bad'},{...payload(),attachment:'https://example.test/a'}])expect((await start(p)).status).toBe(400)
 const a=await start(),id=a.body.conversation._id
 await Conversation.collection.updateOne({_id:new mongoose.Types.ObjectId(id)},{$push:{messages:{$each:Array.from({length:198},()=>({clientId:randomUUID(),role:'buyer',content:'Synthetic historical text',sentAt:new Date()}))}}})
 const calls=await Promise.all([reply(id,{clientId:randomUUID(),content:'Last A'}),reply(id,{clientId:randomUUID(),content:'Last B'})])
 expect(calls.map(r=>r.status).sort()).toEqual([201,409])
 const r=await get(id);expect(r.body.messages).toHaveLength(200);expect(r.body.canSend).toBe(false)
 expect((await request(app).get(url+'?page=1001').set(auth(f.tokens.buyer))).status).toBe(400)
 expect((await request(app).get(url+'?buyerId='+f.otherBuyer._id).set(auth(f.tokens.buyer))).status).toBe(400)
})

test('a saved first message can be recovered after visibility changes, but no new write is allowed',async()=>{
 const p=payload(),original=Conversation.prototype.save,spy=jest.spyOn(Conversation.prototype,'save').mockImplementationOnce(async function(...args){await original.apply(this,args);throw Error('Synthetic lost creation acknowledgment')})
 expect((await start(p)).status).toBe(503);spy.mockRestore()
 await Product.updateOne({_id:f.product._id},{$set:{isDraft:true}})
 const recovered=await start(p);expect(recovered.status).toBe(200);expect(recovered.body.replayed).toBe(true)
 expect((await start(payload())).status).toBe(409)
 const id=recovered.body.conversation._id
 expect((await get(id)).body.messages).toHaveLength(1)
 expect((await get(id)).body.canSend).toBe(false)
})
test('per-actor write budget is isolated and cannot be bypassed with repeated client keys',async()=>{
 const p=payload(),a=await start(p);expect(a.status).toBe(201)
 for(let i=0;i<29;i++)expect((await start(p)).status).toBe(200)
 const rejected=await start(p);expect(rejected.status).toBe(429);expect(rejected.headers['cache-control']).toBe('private, no-store')
 const other=await reply(a.body.conversation._id,{clientId:randomUUID(),content:'Independent supplier budget'});expect(other.status).toBe(201)
 expect((await get(a.body.conversation._id)).body.messages).toHaveLength(2)
})

test('buyer product lookup returns only their own current-supplier conversation without creating one',async()=>{
 const path=url+'/product/'+f.product._id
 const empty=await request(app).get(path).set(auth(f.tokens.buyer));expect(empty.status).toBe(200);expect(empty.body).toMatchObject({actorId:String(f.buyer._id),role:'buyer',productId:String(f.product._id),conversation:null,messages:[],canSend:true});expect(await Conversation.countDocuments()).toBe(0)
 const started=await start(),found=await request(app).get(path).set(auth(f.tokens.buyer));expect(found.status).toBe(200);expect(found.body.conversation._id).toBe(started.body.conversation._id);expect(found.body.messages).toHaveLength(1)
 expect((await request(app).get(path).set(auth(f.tokens.otherBuyer))).body.conversation).toBeNull()
 expect((await request(app).get(path).set(auth(f.tokens.supplier))).status).toBe(403)
 await Product.updateOne({_id:f.product._id},{$set:{isDraft:true}})
 expect((await request(app).get(path).set(auth(f.tokens.buyer))).body.canSend).toBe(false)
 expect((await request(app).get(path).set(auth(f.tokens.otherBuyer))).status).toBe(404)
 expect(await Conversation.countDocuments()).toBe(1)
})

test('message and recipient notification are atomic, replay never duplicates or resets read state',async()=>{
 const p=payload('Synthetic confidential inquiry'),a=await start(p),id=a.body.conversation._id
 expect(a.status).toBe(201)
 const inbox=token=>request(app).get('/api/notifications').set(auth(token))
 const mark=(notice,token)=>request(app).put('/api/notifications/'+notice+'/read').set(auth(token))
 const first=await inbox(f.tokens.supplier);expect(first.status).toBe(200);expect(first.body.unreadCount).toBe(1)
 expect(first.body.data).toHaveLength(1);const n=first.body.data[0]
 expect(n).toMatchObject({type:'direct_message',resourceType:'direct_conversation',resourceId:id,readAt:null})
 expect(JSON.stringify(first.body)).not.toContain(p.content)
 expect(JSON.stringify((await get(id)).body)).not.toMatch(/noticeId|noticeReadAt/)
 for(const role of ['buyer','otherBuyer','otherSupplier','staff']){
  expect((await inbox(f.tokens[role])).body.data).toEqual([])
  expect((await mark(n._id,f.tokens[role])).status).toBe(404)
 }
 const read=await mark(n._id,f.tokens.supplier);expect(read.status).toBe(200);expect(read.body.notification.readAt).toBeTruthy()
 expect(read.headers['cache-control']).toBe('private, no-store')
 expect((await start(p)).status).toBe(200)
 const again=await inbox(f.tokens.supplier);expect(again.body.unreadCount).toBe(0);expect(again.body.data).toEqual([read.body.notification])
 expect((await mark(n._id,f.tokens.supplier)).body.notification.readAt).toBe(read.body.notification.readAt)
 const m={clientId:randomUUID(),content:'Synthetic private reply'}
 const calls=await Promise.all(Array.from({length:4},()=>reply(id,m)));expect(calls.map(r=>r.status).sort()).toEqual([200,200,200,201])
 const buyer=await inbox(f.tokens.buyer);expect(buyer.body.unreadCount).toBe(1);expect(buyer.body.data).toHaveLength(1);expect(buyer.body.data[0].resourceId).toBe(id)
 expect(JSON.stringify(buyer.body)).not.toContain(m.content)
 expect(await require('../models/Notification').countDocuments()).toBe(0)
})
test('lost write acknowledgement leaves exactly one visible notification; read-all scopes to recipient, legacy remains excluded',async()=>{
 const a=await start(),id=a.body.conversation._id,m={clientId:randomUUID(),content:'Synthetic lost reply'}
 const original=Conversation.updateOne.bind(Conversation),spy=jest.spyOn(Conversation,'updateOne').mockImplementationOnce(async(...args)=>{await original(...args);throw Error('Synthetic lost acknowledgement')})
 expect((await reply(id,m)).status).toBe(503);spy.mockRestore()
 const inbox=token=>request(app).get('/api/notifications').set(auth(token))
 const markAll=token=>request(app).put('/api/notifications/read-all').set(auth(token))
 const b=await inbox(f.tokens.buyer);expect(b.body.unreadCount).toBe(1);expect(b.body.data).toHaveLength(1)
 expect((await reply(id,m)).status).toBe(200);expect((await inbox(f.tokens.buyer)).body.data).toEqual(b.body.data)
 await Conversation.collection.updateOne({_id:new mongoose.Types.ObjectId(id)},{$push:{messages:{clientId:randomUUID(),role:'supplier',content:'Legacy text',sentAt:new Date()}}})
 expect((await inbox(f.tokens.buyer)).body.data).toHaveLength(1)
 expect((await markAll(f.tokens.staff)).status).toBe(200);expect((await inbox(f.tokens.supplier)).body.unreadCount).toBe(1)
 expect((await markAll(f.tokens.buyer)).status).toBe(200);expect((await inbox(f.tokens.buyer)).body.unreadCount).toBe(0)
 expect((await inbox(f.tokens.supplier)).body.unreadCount).toBe(1)
 expect((await markAll(f.tokens.supplier)).status).toBe(200);expect((await inbox(f.tokens.supplier)).body.unreadCount).toBe(0)
 expect((await get(id)).body.messages).toHaveLength(3)
})

test('merged notification feed keeps global newest 100 and exact unread count, without leaking text',async()=>{
 const a=await start(),id=a.body.conversation._id,Notification=require('../models/Notification')
 const earlier=new Date(Date.now()-60000),later=new Date(Date.now()+60000)
 await Notification.collection.insertMany(Array.from({length:102},(_,i)=>({userId:f.supplier._id,type:'rfq_created',resourceType:'rfq',resourceId:new mongoose.Types.ObjectId(),createdAt:i===0?later:earlier,readAt:null})))
 const r=await request(app).get('/api/notifications').set(auth(f.tokens.supplier))
 expect(r.status).toBe(200);expect(r.body.data).toHaveLength(100);expect(r.body.unreadCount).toBe(103)
 expect(r.body.data[0].type).toBe('rfq_created');expect(r.body.data[1]).toMatchObject({type:'direct_message',resourceId:id})
 expect(JSON.stringify(r.body)).not.toContain('Synthetic inquiry')
 const spy=jest.spyOn(Conversation,'aggregate').mockImplementationOnce(()=>{throw Error('Synthetic notice outage')})
 const failed=await request(app).get('/api/notifications').set(auth(f.tokens.supplier));expect(failed.status).toBeGreaterThanOrEqual(500);expect(failed.body.data).toBeUndefined();spy.mockRestore()
 expect((await request(app).put('/api/notifications/read-all').set(auth(f.tokens.supplier))).status).toBe(200)
 expect((await request(app).get('/api/notifications').set(auth(f.tokens.supplier))).body.unreadCount).toBe(0)
})
