require('./helpers/pilotIsolation')
const request=require('supertest')
const mongoose=require('mongoose')
const {MongoMemoryServer}=require('mongodb-memory-server')
const app=require('../server')
const fixtures=require('./helpers/tradeFixtures')
const Thread=require('../models/MessageThread')
const Notice=require('../models/Notification')
const Membership=require('../models/Membership')
const {recoverPendingMessages,createMessageRecovery}=require('../services/rfqMessageDelivery')
let mongo,f
beforeAll(async()=>{mongo=await MongoMemoryServer.create({instance:{storageEngine:'wiredTiger'}});await mongoose.connect(mongo.getUri(),{monitorCommands:true});f=await fixtures();await Promise.all([Thread.init(),Notice.init()])},120000)
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()},120000)
afterEach(()=>jest.restoreAllMocks())
const auth=who=>({Authorization:'Bearer '+f.tokens[who]})
const key='message_test_key_123456789'
async function ready(){const r=await request(app).post('/api/rfq').set(auth('buyer')).send({productId:f.product._id,quantity:20,buyerPhone:'+212600000001'});expect(r.status).toBe(201);return r.body.rfq._id}
const send=(id,who='buyer',k=key,content='Synthetic message')=>{let r=request(app).post('/api/rfq/'+id+'/messages').set(auth(who));if(k!==null)r=r.set('Idempotency-Key',k);return r.send({content,senderRole:'admin',senderName:'forged',delivery:{phase:'completed'}})}
const state=async id=>({thread:await Thread.findOne({rfqId:id}).lean(),notices:await Notice.find({resourceId:id,type:'message_received'}).lean()})
const free=thread=>thread.messages.filter(m=>m.delivery)
async function proof(id,n=1){const {thread,notices}=await state(id),messages=free(thread);expect(messages).toHaveLength(n);expect(notices).toHaveLength(n);for(const m of messages){expect(m.delivery.phase).toBe('completed');expect(m.delivery.nextAttemptAt).toBeUndefined();expect(notices.filter(x=>String(x._id)===String(m._id)&&String(x.userId)===String(m.delivery.recipientId))).toHaveLength(1)}return {thread,notices,messages}}
test('six concurrent same-key sends and replay create exactly one message and notice, preserve read status',async()=>{
 const id=await ready(),results=await Promise.all(Array.from({length:6},()=>send(id)))
 expect(results.map(r=>r.status)).toEqual(Array(6).fill(201))
 const ids=new Set(results.map(r=>r.body.submission.messageId));expect(ids.size).toBe(1)
 const p=await proof(id);expect(p.messages[0].senderRole).toBe('buyer');expect(String(p.messages[0].senderId)).toBe(String(f.buyer._id));expect(p.messages[0].senderName).toBe(f.buyer.name)
 expect(results[0].body.thread.messages.every(m=>!m.delivery)).toBe(true)
 const history=await request(app).get('/api/rfq/'+id+'/thread').set(auth('supplier'));expect(history.body.thread.messages.every(m=>!m.delivery)).toBe(true)
 const mark=await request(app).put('/api/notifications/'+p.notices[0]._id+'/read').set(auth('supplier'));expect(mark.status).toBe(200)
 const r=await send(id);expect(r.status).toBe(201);expect(r.body.submission).toMatchObject({version:1,phase:'completed',replayed:true,messageId:String(p.messages[0]._id)})
 expect((await proof(id)).notices[0].readAt.toISOString()).toBe(mark.body.notification.readAt)
 expect((await send(id,'buyer',key,'Different text')).status).toBe(409)
})
test('key is scoped to actor and RFQ; distinct keys allow intentional identical messages; legacy clients remain valid',async()=>{
 const id=await ready(),other=await ready()
 for(const [rid,who,k] of [[id,'buyer',key],[id,'supplier',key],[id,'staff',key],[id,'buyer',key+'2'],[id,'buyer',null],[id,'buyer',null],[other,'buyer',key]])expect((await send(rid,who,k)).status).toBe(201)
 const p=await proof(id,6);expect(p.messages.filter(m=>m.senderRole==='supplier')).toHaveLength(2);expect(String(p.messages.find(m=>String(m.senderId)===String(f.staff._id)).delivery.recipientId)).toBe(String(f.buyer._id))
 expect((await proof(other)).messages[0]._id.toString()).not.toBe(p.messages[0]._id.toString())
 for(const who of ['otherBuyer','otherSupplier'])expect((await send(id,who)).status).toBe(403)
 expect((await send(id,'buyer','short')).status).toBe(400)
 await proof(id,6)
})
test('notification failure before insertion leaves durable pending message; fresh recovery completes it once',async()=>{
 const id=await ready(),fault=jest.spyOn(Notice,'updateOne').mockRejectedValueOnce(new Error('synthetic notification outage'))
 const r=await send(id);expect(r.status).toBe(503);fault.mockRestore()
 let p=await state(id);expect(free(p.thread)).toHaveLength(1);expect(free(p.thread)[0].delivery.phase).toBe('pending');expect(p.notices).toHaveLength(0)
 const result=await recoverPendingMessages({now:new Date(Date.now()+120000)});expect(result.completed).toBe(1)
 const replay=await send(id);expect(replay.status).toBe(201);expect(replay.body.submission.replayed).toBe(true);await proof(id)
})
test('lost notification acknowledgement after insertion is verified; lost completion acknowledgement replays safely',async()=>{
 const id=await ready(),original=Notice.updateOne
 const fault=jest.spyOn(Notice,'updateOne').mockImplementationOnce(async function(...args){await original.apply(this,args);throw Error('synthetic ack lost')})
 expect((await send(id)).status).toBe(201);fault.mockRestore();await proof(id)
 const second=await ready(),update=Thread.updateOne
 const mark=jest.spyOn(Thread,'updateOne').mockImplementation(async function(q,u,...args){const result=await update.call(this,q,u,...args);if(u.$set?.['messages.$.delivery.phase']==='completed')throw Error('synthetic receipt ack lost');return result})
 expect((await send(second)).status).toBe(503);mark.mockRestore();expect((await send(second)).status).toBe(201);await proof(second)
})
test('lost message write acknowledgement preserves identity; fresh key cannot reopen closed thread, prior key can recover',async()=>{
 const id=await ready(),original=Thread.updateOne
 const fault=jest.spyOn(Thread,'updateOne').mockImplementationOnce(async function(...args){await original.apply(this,args);throw Error('synthetic message ack lost')})
 expect((await send(id)).status).toBe(201);fault.mockRestore()
 const offer=await request(app).put('/api/rfq/'+id+'/respond').set(auth('supplier')).send({unitPrice:100,deliveryDays:4});expect(offer.status).toBe(200)
 const accepted=await request(app).put('/api/rfq/'+id+'/action').set(auth('buyer')).send({action:'accept',offerId:offer.body.offer._id});expect(accepted.status).toBe(200)
 expect((await send(id)).status).toBe(201);expect((await send(id,'buyer',key+'new')).status).toBe(409)
 const p=await proof(id);expect(p.thread.status).toBe('closed')
})
test('revoked staff cannot replay; already authorized pending notice recovers after revocation and thread closure',async()=>{
 const id=await ready(),fault=jest.spyOn(Notice,'updateOne').mockRejectedValueOnce(new Error('synthetic outage'))
 expect((await send(id,'staff')).status).toBe(503);fault.mockRestore()
 await Membership.updateOne({_id:f.membership._id},{$set:{status:'revoked'}})
 try{
  expect((await send(id,'staff')).status).toBe(403)
  const offer=await request(app).put('/api/rfq/'+id+'/respond').set(auth('supplier')).send({unitPrice:100,deliveryDays:4});expect(offer.status).toBe(200)
  expect((await request(app).put('/api/rfq/'+id+'/action').set(auth('buyer')).send({action:'accept',offerId:offer.body.offer._id})).status).toBe(200)
  const worker=createMessageRecovery();try{await Thread.updateOne({rfqId:id,'messages.delivery.phase':'pending'},{$set:{'messages.$.delivery.nextAttemptAt':new Date(0)}});const r=await worker.runOnce();expect(r.completed).toBe(1)}finally{await worker.stop()}
  const p=await proof(id);expect(p.thread.status).toBe('closed');expect(String(p.notices[0].userId)).toBe(String(f.buyer._id))
 }finally{await Membership.updateOne({_id:f.membership._id},{$set:{status:'active'}})}
})
test('persistent faults pause automatic retries; explicit same attempt resumes and never overwrites a conflicting notice',async()=>{
 const id=await ready(),fault=jest.spyOn(Notice,'updateOne').mockRejectedValue(new Error('synthetic outage'))
 expect((await send(id)).status).toBe(503)
 for(let i=0;i<9;i++)expect((await recoverPendingMessages({now:new Date(Date.now()+3600000*(i+1))})).pending).toBe(1)
 expect((await recoverPendingMessages({now:new Date(Date.now()+86400000)})).processed).toBe(0)
 fault.mockRestore()
 const p=await state(id),m=free(p.thread)[0];expect(m.delivery.attempts).toBe(10)
 await Notice.create({_id:m._id,userId:f.otherBuyer._id,type:'message_received',resourceType:'rfq',resourceId:id})
 expect((await send(id)).status).toBe(503);expect((await Notice.findById(m._id)).userId.toString()).toBe(f.otherBuyer._id.toString())
 await Notice.deleteOne({_id:m._id})
 expect((await send(id)).status).toBe(201);await proof(id)
})

test('failure before the message write leaves no intent; same key can safely retry, competing texts have one winner',async()=>{
 const id=await ready(),fault=jest.spyOn(Thread,'updateOne').mockRejectedValueOnce(new Error('synthetic failure before message write'))
 expect((await send(id)).status).toBe(503);fault.mockRestore()
 const before=await state(id);expect(free(before.thread)).toHaveLength(0);expect(before.notices).toHaveLength(0)
 expect((await send(id)).status).toBe(201);await proof(id)
 const second=await ready(),r=await Promise.all([send(second,'buyer',key,'Text A'),send(second,'buyer',key,'Text B')])
 expect(r.map(x=>x.status).sort()).toEqual([201,409])
 const winner=await proof(second);expect(winner.messages[0].content).toBe(r[0].status===201?'Text A':'Text B')
})
test('two pending messages on one thread recover separately across concurrent workers, without changing legacy history',async()=>{
 const id=await ready(),fault=jest.spyOn(Notice,'updateOne').mockRejectedValue(new Error('synthetic outage'))
 expect((await send(id,'buyer',key)).status).toBe(503);expect((await send(id,'supplier',key)).status).toBe(503);fault.mockRestore()
 const before=await state(id);expect(free(before.thread)).toHaveLength(2);expect(before.notices).toHaveLength(0)
 const initial=before.thread.messages.filter(m=>!m.delivery).map(m=>String(m._id))
 const workerA=createMessageRecovery(),workerB=createMessageRecovery()
 try{
  await Thread.updateOne({rfqId:id},{$set:{'messages.$[m].delivery.nextAttemptAt':new Date(0)}},{arrayFilters:[{'m.delivery.phase':'pending'}]})
  await Promise.all([workerA.runOnce(),workerB.runOnce()])
  await workerA.runOnce()
  const p=await proof(id,2);expect(p.thread.messages.filter(m=>!m.delivery).map(m=>String(m._id))).toEqual(initial)
 }finally{await workerA.stop();await workerB.stop()}
})
test('a mismatched thread is not exposed or notified by automatic recovery',async()=>{
 const id=await ready(),fault=jest.spyOn(Notice,'updateOne').mockRejectedValueOnce(new Error('synthetic outage'))
 expect((await send(id)).status).toBe(503);fault.mockRestore()
 await Thread.updateOne({rfqId:id},{$set:{supplierId:f.otherSupplier._id,'messages.$[m].delivery.recipientId':f.otherSupplier._id}},{arrayFilters:[{'m.delivery.phase':'pending'}]})
 const r=await request(app).get('/api/rfq/'+id+'/thread').set(auth('buyer'));expect(r.status).toBe(200);expect(r.body.thread).toBeNull()
 expect((await recoverPendingMessages({now:new Date(Date.now()+120000)})).pending).toBe(1)
 expect((await state(id)).notices).toHaveLength(0)
 await Thread.updateOne({rfqId:id},{$set:{supplierId:f.supplier._id,'messages.$[m].delivery.recipientId':f.supplier._id}},{arrayFilters:[{'m.delivery.phase':'pending'}]})
 expect((await send(id)).status).toBe(201);await proof(id)
})
test('real standalone writes request journaling for the message, notice and completion',async()=>{
 const id=await ready(),commands=[],client=mongoose.connection.getClient(),capture=e=>{if(e.commandName==='update'&&['messagethreads','notifications'].includes(e.command.update))commands.push(e.command)}
 client.on('commandStarted',capture);try{expect((await send(id)).status).toBe(201)}finally{client.off('commandStarted',capture)}
 expect(commands.filter(c=>c.update==='messagethreads')).toHaveLength(2)
 expect(commands.filter(c=>c.update==='notifications')).toHaveLength(1)
 expect(commands.every(c=>c.writeConcern?.w===1&&c.writeConcern?.j===true)).toBe(true)
 await proof(id)
})

test('attempt lookup is read-only, actor-scoped, distinguishes absent/pending/completed, and works after closure',async()=>{
 const id=await ready()
 const lookup=(who='buyer',k=key)=>{let r=request(app).get('/api/rfq/'+id+'/messages/attempt').set(auth(who));if(k!==null)r=r.set('Idempotency-Key',k);return r}
 const empty=await lookup();expect(empty.status).toBe(200);expect(empty.headers['cache-control']).toBe('private, no-store')
 expect(empty.body).toEqual({rfqId:id,actorId:String(f.buyer._id),submission:{version:1,phase:'absent'}})
 expect(free((await state(id)).thread)).toHaveLength(0)
 expect((await lookup('buyer',null)).status).toBe(400);expect((await lookup('buyer','bad')).status).toBe(400)
 expect((await lookup('otherBuyer')).status).toBe(403)
 expect((await request(app).get('/api/rfq/'+id+'/messages/attempt').set('Idempotency-Key',key)).status).toBe(401)
 const fault=jest.spyOn(Notice,'updateOne').mockRejectedValueOnce(Error('synthetic outage'))
 expect((await send(id)).status).toBe(503);fault.mockRestore()
 const pending=await lookup();expect(pending.body.submission.phase).toBe('pending')
 expect((await lookup('supplier')).body.submission.phase).toBe('absent')
 expect((await state(id)).notices).toHaveLength(0)
 const offer=await request(app).put('/api/rfq/'+id+'/respond').set(auth('supplier')).send({unitPrice:100,deliveryDays:4})
 expect(offer.status).toBe(200)
 expect((await request(app).put('/api/rfq/'+id+'/action').set(auth('buyer')).send({action:'accept',offerId:offer.body.offer._id})).status).toBe(200)
 expect((await lookup()).body.submission.phase).toBe('pending')
 const replay=await send(id);expect(replay.status).toBe(201)
 expect((await lookup()).body.submission).toEqual({version:1,phase:'completed',messageId:pending.body.submission.messageId})
 await proof(id)
})
