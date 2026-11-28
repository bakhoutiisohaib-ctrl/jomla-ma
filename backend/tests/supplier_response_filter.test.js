require('./helpers/pilotIsolation')
const request=require('supertest'),mongoose=require('mongoose'),{MongoMemoryServer}=require('mongodb-memory-server')
const app=require('../server'),fixtures=require('./helpers/tradeFixtures')
const R=require('../models/QuoteRequest'),O=require('../models/QuoteOffer'),S=require('../models/Supplier'),Store=require('../models/Store')
const {generateToken}=require('../middleware/auth'),{fastSupplierIds}=require('../services/supplierResponseFilter')
const DAY=86400000
let mongo,f,n=0
const auth=token=>({Authorization:'Bearer '+token})
const key=()=> 'response-metric-'+String(++n).padStart(12,'0')
const read=id=>R.findById(id).select('+creation +responseMetricVersion +firstCommercialResponse +supplierRejection +offerSubmission').lean()
const create=async(token=f.tokens.buyer)=>{const x=await request(app).post('/api/rfq').set(auth(token)).set('Idempotency-Key',key()).send({productId:String(f.product._id),quantity:20,buyerPhone:'+212600000001',responseMetricVersion:9,firstCommercialResponse:{kind:'offer'}});expect(x.status).toBe(201);expect(x.body.rfq.responseMetricVersion).toBeUndefined();expect(x.body.rfq.firstCommercialResponse).toBeUndefined();return x.body.rfq._id}
const offer=(id,k=key(),token=f.tokens.supplier)=>request(app).put('/api/rfq/'+id+'/respond').set(auth(token)).set('Idempotency-Key',k).send({unitPrice:90,deliveryDays:3})
const refuse=id=>request(app).put('/api/rfq/'+id+'/respond').set(auth(f.tokens.supplier)).send({status:'rejected'})
const newBuyer=async()=>generateToken(await S.create({name:'Synthetic buyer '+n,email:'metric-'+key()+'@test.ma',password:'fixture-password',role:'buyer',phone:'+212600000001',city:'Rabat'}))
const age=async(id,days=2,delay=0.5)=>{const r=await read(id),start=new Date(Date.now()-days*DAY),at=new Date(+start+delay*DAY);const update={createdAt:new Date(+start-1000),'creation.completedAt':start};if(r.firstCommercialResponse){update['firstCommercialResponse.at']=at;if(r.firstCommercialResponse.kind==='offer')await O.updateOne({_id:r.firstCommercialResponse.refId},{$set:{createdAt:new Date(+start+1000)}});else update['supplierRejection.completedAt']=at}await R.collection.updateOne({_id:r._id},{$set:update})}
beforeAll(async()=>{mongo=await MongoMemoryServer.create({instance:{storageEngine:'wiredTiger'}});await mongoose.connect(mongo.getUri());await Promise.all([R.init(),O.init()])})
beforeEach(async()=>{await Promise.all(Object.values(mongoose.connection.collections).map(c=>c.deleteMany({})));f=await fixtures()})
afterEach(()=>jest.restoreAllMocks())
afterAll(async()=>{await mongoose.disconnect();if(mongo)await mongo.stop()})
test('first completed offer is private, stable across retry, replacement and refusal; legacy not backfilled',async()=>{
 const id=await create(),k=key(),x=await offer(id,k);expect(x.status).toBe(200);const first=await read(id);expect(first.responseMetricVersion).toBe(1);expect(first.firstCommercialResponse).toMatchObject({kind:'offer',refId:new mongoose.Types.ObjectId(x.body.offer._id),at:first.offerSubmission.completedAt});expect(first.firstCommercialResponse.at>=first.creation.completedAt).toBe(true)
 expect(JSON.stringify(x.body)).not.toMatch(/firstCommercialResponse|responseMetricVersion/)
 expect((await offer(id,k)).status).toBe(200);expect((await offer(id)).status).toBe(200);expect((await refuse(id)).status).toBe(200);expect((await read(id)).firstCommercialResponse).toEqual(first.firstCommercialResponse)
 const legacy=await create();await R.collection.updateOne({_id:new mongoose.Types.ObjectId(legacy)},{$unset:{responseMetricVersion:1}});expect((await offer(legacy)).status).toBe(200);expect((await read(legacy)).firstCommercialResponse).toBeUndefined()
})
test('first refusal is stamped only after durable completion, recovery and replay keep it',async()=>{
 const id=await create(),N=require('../models/Notification'),spy=jest.spyOn(N,'updateOne').mockRejectedValueOnce(Error('synthetic failure'))
 expect((await refuse(id)).status).toBe(202);expect((await read(id)).firstCommercialResponse).toBeUndefined();spy.mockRestore()
 const x=await refuse(id);expect(x.status).toBe(200);const r=await read(id);expect(r.firstCommercialResponse).toMatchObject({kind:'refusal',refId:r.supplierRejection.id,at:r.supplierRejection.completedAt});expect(JSON.stringify(x.body)).not.toMatch(/firstCommercialResponse|responseMetricVersion/);expect((await refuse(id)).status).toBe(200);expect((await read(id)).firstCommercialResponse).toEqual(r.firstCommercialResponse)
})
test('mature distinct buyers, inclusive 24h and 80%, no response and invalid evidence count against threshold',async()=>{
 const a=await create(),b=await create(await newBuyer()),c=await create(await newBuyer()),d=await create(await newBuyer()),e=await create(await newBuyer())
 for(const id of [a,b,c])expect((await offer(id)).status).toBe(200)
 expect((await refuse(d)).status).toBe(200)
 await age(a,3,1);await age(b);await age(c);await age(d);await age(e)
 const repeat=await create();expect((await offer(repeat)).status).toBe(200);await age(repeat,2,2)
 const recent=await create(await newBuyer());await age(recent,0.5)
 const old=await create(await newBuyer());await age(old,31)
 const legacy=await create(await newBuyer());await age(legacy);await R.collection.updateOne({_id:new mongoose.Types.ObjectId(legacy)},{$unset:{responseMetricVersion:1}})
 expect((await fastSupplierIds()).map(String)).toEqual([String(f.supplier._id)])
 for(const endpoint of ['/api/products?supplierTrust=fast_response','/api/stores?supplierTrust=fast_response']){const x=await request(app).get(endpoint);expect(x.status).toBe(200);expect(x.body.total??x.body.pagination?.total??x.body.products?.length??x.body.stores?.length).toBe(1);expect(JSON.stringify(x.body)).not.toMatch(/firstCommercialResponse|responseMetricVersion/)}
 const r=await read(c);await O.collection.updateOne({_id:r.firstCommercialResponse.refId},{$set:{supplierId:f.otherSupplier._id}});expect(await fastSupplierIds()).toEqual([])
})
test('insufficient samples and hidden stores excluded; evidence outage never broadens results',async()=>{
 for(let i=0;i<2;i++){const id=await create(await newBuyer());expect((await offer(id)).status).toBe(200);await age(id)}
 expect(await fastSupplierIds()).toEqual([])
 const id=await create(await newBuyer());expect((await offer(id)).status).toBe(200);await age(id);expect((await fastSupplierIds()).map(String)).toEqual([String(f.supplier._id)])
 const spy=jest.spyOn(O,'find').mockImplementationOnce(()=>{throw Error('synthetic evidence outage')})
 expect((await request(app).get('/api/products?supplierTrust=fast_response')).status).toBe(503);spy.mockRestore()
 await Store.updateOne({_id:f.store._id},{$set:{adminSuspended:true}});expect(await fastSupplierIds()).toEqual([])
})

test('partial offer and ordinary message do not stamp a response; recovery stamps once',async()=>{
 const id=await create()
 const msg=await request(app).post('/api/rfq/'+id+'/messages').set(auth(f.tokens.supplier)).send({content:'Synthetic hello'})
 expect(msg.status).toBe(201);expect((await read(id)).firstCommercialResponse).toBeUndefined()
 const N=require('../models/Notification'),k=key(),spy=jest.spyOn(N,'updateOne').mockRejectedValueOnce(Error('synthetic failure'))
 expect((await offer(id,k)).status).toBe(202);expect((await read(id)).firstCommercialResponse).toBeUndefined()
 spy.mockRestore();expect((await offer(id,k)).status).toBe(200)
 const p=(await read(id)).firstCommercialResponse;expect(p.kind).toBe('offer');expect((await offer(id,k)).status).toBe(200);expect((await read(id)).firstCommercialResponse).toEqual(p)
})
test('excess nominal sample fails closed rather than truncating',async()=>{
 const t=new Date(Date.now()-2*DAY),{POLICY}=require('../services/supplierResponseFilter')
 await R.collection.insertMany(Array.from({length:POLICY.maxRequests+1},()=>({supplierId:f.supplier._id,buyerId:f.buyer._id,createdAt:new Date(+t-1000),responseMetricVersion:1,creation:{version:1,phase:'completed',completedAt:t},status:'pending'})))
 await expect(fastSupplierIds()).rejects.toMatchObject({status:503})
 expect((await request(app).get('/api/stores?supplierTrust=fast_response')).status).toBe(503)
})
