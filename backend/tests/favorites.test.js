require('./helpers/pilotIsolation')
const request = require('supertest')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const app = require('../server')
const Supplier = require('../models/Supplier')
const Store = require('../models/Store')
const Product = require('../models/Product')
const FavoriteList = require('../models/FavoriteList')
const { generateToken } = require('../middleware/auth')

let mongo, a, b, owner, other, store, foreignStore, p, q, tokenA, tokenB, supplierToken
const headers = token => ({ Authorization: 'Bearer ' + token })
const get = token => request(app).get('/api/favorites').set(headers(token))
const put = (id, token = tokenA) => request(app).put('/api/favorites/' + id).set(headers(token))
const del = (id, token = tokenA) => request(app).delete('/api/favorites/' + id).set(headers(token))
const oid = () => new mongoose.Types.ObjectId()
const publish = extra => Product.create({
  name: 'Synthetic product', category: 'Test', price: 20, moq: 10, currency: 'MAD', city: 'Rabat',
  description: 'Synthetic fixture for favorite visibility checks', unit: 'piece',
  supplierId: owner._id, storeId: store._id, imageUrl: '/uploads/synthetic.png',
  isDraft: false, hasImageRights: true, imageRights: { source: 'owned', declaredBy: owner._id, declaredAt: new Date() },
  approvedBy: owner._id, approvedAt: new Date(), availabilityConfirmed: true, availability: 'in_stock', inStock: true,
  ...extra
})

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri())
  ;[a,b,owner,other] = await Supplier.create([
    {name:'Buyer A',email:'a@favorites.test',password:'test',role:'buyer'},
    {name:'Buyer B',email:'b@favorites.test',password:'test',role:'buyer'},
    {name:'Owner',email:'owner@favorites.test',password:'test',role:'supplier'},
    {name:'Other',email:'other@favorites.test',password:'test',role:'supplier'}
  ])
  store = await Store.create({name:'Public store',slug:'fav-public',supplierId:owner._id,reviewStatus:'approved',isActive:true})
  foreignStore = await Store.create({name:'Other store',slug:'fav-other',supplierId:other._id,reviewStatus:'approved',isActive:true})
  tokenA = generateToken(a); tokenB = generateToken(b); supplierToken = generateToken(owner)
},120000)

beforeEach(async () => {
  await FavoriteList.deleteMany({})
  await Product.deleteMany({})
  await Store.updateOne({_id:store._id},{$set:{isActive:true,adminSuspended:false}})
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:true}})
  p = await publish({}); q = await publish({name:'Second product'})
})
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('authentication and buyer-only authorization protect all methods; no private caching', async () => {
  for(const method of ['get','put','delete']) {
    const url = '/api/favorites' + (method === 'get' ? '' : '/' + p.id)
    expect((await request(app)[method](url)).status).toBe(401)
    const denied = await request(app)[method](url).set(headers(supplierToken))
    expect(denied.status).toBe(403)
    expect(denied.headers['cache-control']).toContain('no-store')
  }
  const empty = await get(tokenA)
  expect(empty.status).toBe(200)
  expect(empty.headers['cache-control']).toBe('private, no-store')
  expect(empty.body).toEqual({productIds:[],limit:100})
})
test('save, reread with another token, duplicate save, and idempotent removal', async () => {
  expect((await put(p.id)).body).toEqual({productId:p.id,saved:true})
  expect((await put(p.id)).status).toBe(200)
  expect((await get(generateToken(a))).body.productIds).toEqual([p.id])
  expect(await FavoriteList.countDocuments()).toBe(1)
  expect((await del(p.id)).body).toEqual({productId:p.id,saved:false})
  expect((await del(p.id)).status).toBe(200)
  expect((await get(tokenA)).body.productIds).toEqual([])
})
test('buyers cannot read or mutate each other; request owner injection is rejected', async () => {
  await put(p.id); await put(q.id,tokenB)
  expect((await get(tokenB)).body.productIds).toEqual([q.id])
  expect((await get(tokenB).query({owner:a.id})).status).toBe(400)
  expect((await put(q.id).send({buyerId:b.id})).status).toBe(400)
  expect((await del(p.id,tokenB)).status).toBe(200)
  expect((await get(tokenA)).body.productIds).toEqual([p.id])
  expect((await get(tokenB)).body.productIds).toEqual([q.id])
})
test('invalid and missing product IDs do not create favorites', async () => {
  expect((await put('invalid')).status).toBe(400)
  expect((await del('invalid')).status).toBe(400)
  expect((await put(oid().toString())).status).toBe(404)
  expect(await FavoriteList.countDocuments()).toBe(0)
})
test('draft, unavailable, hidden and mismatched-owner products cannot be saved', async () => {
  const draft = await Product.create({supplierId:owner._id,name:'Private draft',isDraft:true})
  const hidden = await publish({}); await Product.updateOne({_id:hidden._id},{$set:{moderationStatus:'hidden'}})
  const unavailable = await publish({availability:'out_of_stock',inStock:false})
  const foreign = await publish({storeId:foreignStore._id})
  for (const item of [draft,hidden,unavailable,foreign]) expect((await put(item.id)).status).toBe(404)
  expect((await get(tokenA)).body.productIds).toEqual([])
})
test('closed store and disabled supplier prevent saves; withdrawn items remain removable without metadata', async () => {
  await put(p.id)
  await Store.updateOne({_id:store._id},{$set:{isActive:false}})
  expect((await put(q.id)).status).toBe(404)
  expect((await get(tokenA)).body).toEqual({productIds:[p.id],limit:100})
  expect((await del(p.id)).status).toBe(200)
  await Store.updateOne({_id:store._id},{$set:{isActive:true}})
  await Supplier.updateOne({_id:owner._id},{$set:{isActive:false}})
  expect((await put(q.id)).status).toBe(404)
})
test('concurrent duplicate first writes do not duplicate a list or product', async () => {
  const results = await Promise.all(Array.from({length:6},()=>put(p.id)))
  expect(results.map(r=>r.status)).toEqual(Array(6).fill(200))
  expect(await FavoriteList.countDocuments()).toBe(1)
  expect((await get(tokenA)).body.productIds).toEqual([p.id])
})
test('atomic capacity under concurrent distinct saves and retry at limit', async () => {
  const initial = Array.from({length:99},oid)
  await FavoriteList.create({_id:a._id,productIds:initial})
  const results = await Promise.all([put(p.id),put(q.id)])
  expect(results.map(r=>r.status).sort()).toEqual([200,409])
  const saved = results.find(r=>r.status===200).body.productId
  expect((await get(tokenA)).body.productIds).toHaveLength(100)
  expect((await put(saved)).status).toBe(200)
  expect((await del(initial[0].toString())).status).toBe(200)
  expect((await put(saved===p.id?q.id:p.id)).status).toBe(200)
  expect((await get(tokenA)).body.productIds).toHaveLength(100)
})
test('revoked session cannot read or write a previously saved list', async () => {
  await put(p.id)
  await Supplier.updateOne({_id:a._id},{$inc:{tokenVersion:1}})
  expect((await get(tokenA)).status).toBe(401)
  expect((await del(p.id)).status).toBe(401)
  a = await Supplier.findById(a._id).select('+tokenVersion'); tokenA = generateToken(a)
  expect((await get(tokenA)).body.productIds).toEqual([p.id])
})
