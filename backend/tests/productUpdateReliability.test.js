require('./helpers/pilotIsolation')
const express=require('express'),request=require('supertest'),mongoose=require('mongoose')
const {MongoMemoryServer}=require('mongodb-memory-server')
const Product=require('../models/Product'),Supplier=require('../models/Supplier'),Organization=require('../models/Organization'),Membership=require('../models/Membership'),Job=require('../models/BackgroundJob')
const {generateToken}=require('../middleware/auth')
const app=express()
app.use(express.json());app.use('/api/products',require('../routes/products'))
app.use((e,req,res,next)=>res.status(e.status||(e.name==='ValidationError'?400:500)).json({message:e.message,code:e.code}))
let mongo,owner,other,staff,membership,tokens
const key='synthetic-edit-key-123456'
const auth=who=>({Authorization:'Bearer '+tokens[who]})
const headers=(rev=0,k=key)=>({'Idempotency-Key':k,'X-Product-Revision':String(rev)})
const edit=(id,body,rev=0,k=key,who='owner')=>request(app).put('/api/products/'+id).set(auth(who)).set(headers(rev,k)).send(body)
const state=(id,who='owner')=>request(app).get('/api/products/'+id+'/edit-state').set(auth(who))
const lookup=(id,rev=0,k=key,who='owner')=>request(app).get('/api/products/'+id+'/update-attempt').set(auth(who)).set(headers(rev,k))
const jobs=id=>Job.find({type:'visual_index_product','payload.productId':String(id)}).select('+idempotencyKey').lean()
const draft=async extra=>Product.create({supplierId:owner._id,isDraft:true,name:'Synthetic old name',price:20,moq:10,...extra})
beforeAll(async()=>{
 mongo=await MongoMemoryServer.create({instance:{storageEngine:'wiredTiger'}});await mongoose.connect(mongo.getUri(),{monitorCommands:true})
 await Promise.all([Product.init(),Job.init()])
 ;[owner,other,staff]=await Supplier.create([{name:'Synthetic owner',email:'owner@edit.test',password:'fixture',role:'supplier'},{name:'Synthetic other',email:'other@edit.test',password:'fixture',role:'supplier'},{name:'Synthetic staff',email:'staff@edit.test',password:'fixture',role:'staff'}])
 const org=await Organization.create({ownerSupplierId:owner._id,name:'Synthetic organization'})
 membership=await Membership.create({organizationId:org._id,userId:staff._id,invitedEmail:staff.email,invitedBy:owner._id,role:'staff',status:'active',permissions:['manage_products']})
 tokens={owner:generateToken(owner),other:generateToken(other),staff:generateToken(staff)}
},120000)
afterEach(()=>jest.restoreAllMocks())
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()})
test('six same-key requests apply one revision and create exactly one job; private receipts do not leak',async()=>{
 const p=await draft(),body={name:'Synthetic updated',price:35}
 const results=await Promise.all(Array.from({length:6},()=>edit(p._id,body)))
 expect(results.map(r=>r.status)).toEqual(Array(6).fill(200))
 expect(results.filter(r=>!r.body.update.replayed)).toHaveLength(1)
 expect(results.every(r=>r.body.product.editRevision===1&&r.body.product.price===35)).toBe(true)
 expect((await jobs(p._id))).toHaveLength(1)
 expect((await Product.findById(p._id)).editRevision).toBe(1)
 expect(JSON.stringify(results.map(r=>r.body))).not.toContain('updateReceipt')
 expect(JSON.stringify((await state(p._id)).body)).not.toContain('updateReceipt')
 expect(JSON.stringify((await request(app).get('/api/products/mine').set(auth('owner'))).body)).not.toContain('updateReceipt')
 expect((await lookup(p._id)).body).toMatchObject({phase:'saved',baseRevision:0,currentRevision:1,actorId:String(owner._id)})
 expect((await edit(p._id,{...body,price:36})).status).toBe(409)
})
test('two independent sessions from revision zero cannot overwrite one another; old receipt is superseded without replay',async()=>{
 const p=await draft(),r=await Promise.all([edit(p._id,{price:30}),edit(p._id,{price:40},0,key+'2','staff')])
 expect(r.map(x=>x.status).sort()).toEqual([200,409])
 const winner=r[0].status===200?{price:30,k:key,who:'owner'}:{price:40,k:key+'2',who:'staff'}
 expect((await Product.findById(p._id)).price).toBe(winner.price)
 expect((await edit(p._id,{price:55},1,key+'3')).status).toBe(200)
 expect((await lookup(p._id,0,winner.k,winner.who)).body.phase).toBe('superseded')
 expect((await edit(p._id,{price:winner.price},0,winner.k,winner.who)).status).toBe(409)
 expect((await Product.findById(p._id)).price).toBe(55);expect(await jobs(p._id)).toHaveLength(2)
})
test('pre-write failure and post-write lost acknowledgement recover safely',async()=>{
 const p=await draft(),body={price:45},original=Product.updateOne
 jest.spyOn(Product,'updateOne').mockRejectedValueOnce(Error('Synthetic before write'))
 expect((await edit(p._id,body)).status).toBe(503);expect((await lookup(p._id)).body.phase).toBe('absent')
 jest.restoreAllMocks()
 jest.spyOn(Product,'updateOne').mockImplementationOnce(async function(...args){await original.apply(this,args);throw Error('Synthetic ack lost')})
 expect((await edit(p._id,body)).status).toBe(200);expect((await lookup(p._id)).body.phase).toBe('saved')
 expect((await edit(p._id,body)).status).toBe(200);expect((await Product.findById(p._id)).editRevision).toBe(1);expect(await jobs(p._id)).toHaveLength(1)
})
test.each(['before','after'])('index enqueue outage %s insertion is explicit and same attempt repairs without second edit/job',async phase=>{
 const p=await draft(),original=Job.create
 jest.spyOn(Job,'create').mockImplementationOnce(async function(...args){if(phase==='after')await original.apply(this,args);throw Error('Synthetic queue outage')})
 const r=await edit(p._id,{price:61});expect(r.status).toBe(200);expect(r.body.visualIndex.status).toBe('unavailable')
 const retry=await edit(p._id,{price:61});expect(retry.status).toBe(200);expect(retry.body.visualIndex.status).toBe('queued');expect(retry.body.update.replayed).toBe(true)
 expect(await jobs(p._id)).toHaveLength(1);expect((await Product.findById(p._id)).editRevision).toBe(1)
})
test('legacy missing revision accepted once, old clients compatible, view counters survive concurrent edit',async()=>{
 const p=await draft();await Product.collection.updateOne({_id:p._id},{$unset:{editRevision:1,moderationStatus:1}})
 expect((await state(p._id)).body.product.editRevision).toBe(0)
 const original=Product.updateOne
 jest.spyOn(Product,'updateOne').mockImplementationOnce(async function(...args){await Product.collection.updateOne({_id:p._id},{$inc:{views:1}});return original.apply(this,args)})
 expect((await edit(p._id,{price:50})).status).toBe(200);jest.restoreAllMocks()
 expect((await Product.findById(p._id)).views).toBe(1)
 const r=await request(app).put('/api/products/'+p._id).set(auth('owner')).send({price:75});expect(r.status).toBe(200);expect(r.body.product.editRevision).toBe(2)
 expect((await lookup(p._id)).body.phase).toBe('superseded')
})
test('moderation race rejects stale edit without undoing administrative state',async()=>{
 const p=await draft(),original=Product.updateOne
 jest.spyOn(Product,'updateOne').mockImplementationOnce(async function(...args){await Product.collection.updateOne({_id:p._id},{$set:{moderationStatus:'hidden',moderatedAt:new Date()}});return original.apply(this,args)})
 expect((await edit(p._id,{price:65})).status).toBe(409)
 const saved=await Product.findById(p._id);expect(saved.price).toBe(20);expect(saved.editRevision).toBe(0);expect(saved.moderationStatus).toBe('hidden')
 expect(await jobs(p._id)).toHaveLength(0)
})
test('invalid or foreign requests, revoked staff and forged server fields do not gain authority',async()=>{
 const p=await draft()
 expect((await edit(p._id,{price:2},0,'short')).status).toBe(400)
 expect((await edit(p._id,{price:2},-1)).status).toBe(400)
 expect((await state(p._id,'other')).status).toBe(404);expect((await lookup(p._id,0,key,'other')).status).toBe(404)
 expect((await edit(p._id,{price:2},0,key,'other')).status).toBe(404)
 const r=await edit(p._id,{price:62,editRevision:999,updateReceipt:{key:'forged'},supplierId:String(other._id),views:500},0,key,'staff')
 expect(r.status).toBe(200);expect(r.body.product.editRevision).toBe(1);expect(r.body.product.views).toBe(0)
 expect((await lookup(p._id,0,key,'owner')).status).toBe(409)
 await Membership.updateOne({_id:membership._id},{$set:{status:'revoked'}})
 try{expect((await edit(p._id,{price:62},0,key,'staff')).status).toBe(403);expect((await lookup(p._id,0,key,'staff')).status).toBe(403)}finally{await Membership.updateOne({_id:membership._id},{$set:{status:'active'}})}
})

test('publication changes retain original rights and validation rules; private draft transition and on-request pricing clear fields',async()=>{
 const Store=require('../models/Store'),{mediaFixture}=require('./helpers/mediaFixture')
 const store=await Store.create({supplierId:owner._id,name:'Synthetic store',slug:'edit-test',reviewStatus:'approved',isActive:true})
 const image=await mediaFixture(owner),p=await draft()
 const publish={name:'Synthetic published',category:'Textile',description:'Synthetic description confirmed',city:'Tanger',storeId:String(store._id),imageUrl:image,isDraft:false,publishApproved:true,hasImageRights:true,imageRights:{source:'owned'},availability:'in_stock',availabilityConfirmed:true,inStock:true,price:52,priceTiers:[{minQty:10,price:49}]}
 expect((await edit(p._id,{...publish,publishApproved:false})).status).toBe(400)
 expect((await lookup(p._id)).body.phase).toBe('absent')
 const saved=await edit(p._id,publish);expect(saved.status).toBe(200);expect(saved.body.product.isDraft).toBe(false)
 const publicRead=await request(app).get('/api/products/'+p._id);expect(publicRead.status).toBe(200);expect(publicRead.body.product.price).toBe(52);expect(publicRead.body.product.editRevision).toBeUndefined();expect(JSON.stringify(publicRead.body)).not.toContain('updateReceipt')
 const next=await edit(p._id,{isDraft:true,pricingMode:'on_request',hasImageRights:false},1,key+'2')
 expect(next.status).toBe(200);expect(next.body.product.editRevision).toBe(2);expect(next.body.product.price).toBeUndefined();expect(next.body.product.priceTiers).toEqual([]);expect(next.body.product.approvedAt).toBeUndefined();expect(next.body.product.imageRights?.declaredBy).toBeUndefined()
 expect((await request(app).get('/api/products/'+p._id)).status).toBe(404)
 expect(await jobs(p._id)).toHaveLength(2)
})
test('journaled update is sent to MongoDB; missing queue uniqueness fails closed and same revision can recover',async()=>{
 const p=await draft(),commands=[],client=mongoose.connection.getClient(),capture=e=>{if(e.commandName==='update'&&e.command.update==='products')commands.push(e.command)}
 const index=(await Job.collection.indexes()).find(i=>i.unique&&i.key.ownerId===1&&i.key.type===1&&i.key.idempotencyKey===1)
 expect(index).toBeTruthy();await Job.collection.dropIndex(index.name)
 client.on('commandStarted',capture)
 try{
  const r=await edit(p._id,{price:91});expect(r.status).toBe(200);expect(r.body.visualIndex.status).toBe('unavailable')
  expect(await jobs(p._id)).toHaveLength(0);expect((await lookup(p._id)).body.phase).toBe('saved')
 }finally{client.off('commandStarted',capture);await Job.collection.createIndex(index.key,{name:index.name,unique:true})}
 expect(commands).toHaveLength(1);expect(commands[0].writeConcern).toMatchObject({w:1,j:true})
 expect((await edit(p._id,{price:91})).body.visualIndex.status).toBe('queued');expect(await jobs(p._id)).toHaveLength(1)
})
