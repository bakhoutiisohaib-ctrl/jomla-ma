process.env.JWT_SECRET = 'external-discovery-test-secret'
jest.mock('@anthropic-ai/sdk', () => jest.fn())
const Anthropic = require('@anthropic-ai/sdk')
const request = require('supertest')
const express = require('express')
const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const ExternalDiscoveryResult = require('../models/ExternalDiscoveryResult')
const { discoverExternally, safePublicUrl } = require('../services/externalDiscovery')
const app = express()
app.use(express.json())
app.use('/api/ai-search', require('../routes/aiSearch'))
app.use('/api/image-search', require('../routes/imageSearch'))
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }))
let mongo
const originalFetch = global.fetch
const envKeys = ['EXTERNAL_DISCOVERY_ENABLED','EXTERNAL_DISCOVERY_PROVIDER','BRAVE_SEARCH_API_KEY','EXTERNAL_DISCOVERY_TERMS_ACCEPTED','EXTERNAL_DISCOVERY_TERMS_REFERENCE','CLAUDE_API_KEY','GOOGLE_VISION_KEY']
const originalEnv = Object.fromEntries(envKeys.map(k => [k,process.env[k]]))
function enable() {
  Object.assign(process.env, { EXTERNAL_DISCOVERY_ENABLED:'true', EXTERNAL_DISCOVERY_PROVIDER:'brave', BRAVE_SEARCH_API_KEY:'mock-key-not-real', EXTERNAL_DISCOVERY_TERMS_ACCEPTED:'true', EXTERNAL_DISCOVERY_TERMS_REFERENCE:'https://brave.com/search/api/' })
}
const rows = Array.from({length:8},(_,i)=>({title:'مورد محتمل '+i,url:'https://supplier'+i+'.example/catalog',description:'وصف من المصدر'}))
beforeAll(async()=>{mongo=await MongoMemoryServer.create();await mongoose.connect(mongo.getUri())},120000)
beforeEach(async()=>{
  for(const key of envKeys)delete process.env[key]
  global.fetch=jest.fn()
  await ExternalDiscoveryResult.deleteMany({})
})
afterAll(async()=>{
  global.fetch=originalFetch
  for(const key of envKeys) {if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key]}
  await mongoose.disconnect();if(mongo)await mongo.stop()
})

test('external discovery is disabled by default and without explicit operator terms confirmation',async()=>{
  const res=await request(app).post('/api/ai-search').send({query:'مضخة صناعية'})
  expect(res.status).toBe(200);expect(res.body.externalDiscovery.enabled).toBe(false)
  enable();delete process.env.EXTERNAL_DISCOVERY_TERMS_ACCEPTED
  const missing=await request(app).post('/api/ai-search').send({query:'مضخة صناعية'})
  expect(missing.body.externalDiscovery.enabled).toBe(false)
  expect(global.fetch).not.toHaveBeenCalled()
  expect(await ExternalDiscoveryResult.countDocuments()).toBe(0)
})

test('opt-in provider results are bounded, separately labeled and saved with provenance',async()=>{
  enable()
  global.fetch.mockResolvedValue({ok:true,json:async()=>({web:{results:[
    {title:'ممنوع',url:'javascript:alert(1)'},{title:'محلي',url:'http://127.0.0.1/admin'},
    {...rows[0],title:'<b>مورد تجريبي</b>'},rows[0],...rows.slice(1)
  ]}})})
  const res=await request(app).post('/api/ai-search').send({query:'مضخة صناعية'})
  expect(res.status).toBe(200);expect(res.body.products).toEqual([])
  const external=res.body.externalDiscovery
  expect(external.enabled).toBe(true);expect(external.results).toHaveLength(5)
  expect(external.results.every(r=>r.external===true&&r.isVerified===false)).toBe(true)
  expect(external.results[0].title).toBe('مورد تجريبي')
  const [endpoint,options]=global.fetch.mock.calls[0]
  expect(endpoint.origin).toBe('https://api.search.brave.com')
  expect(endpoint.searchParams.get('count')).toBe('5')
  expect(options.headers['X-Subscription-Token']).toBe('mock-key-not-real')
  expect(options.signal).toBeTruthy();expect(options.redirect).toBe('error')
  const saved=await ExternalDiscoveryResult.findById(external.discoveryId)
  expect(saved.query).toBe('مضخة صناعية');expect(saved.provider).toBe('brave')
  expect(saved.termsReference).toBe('https://brave.com/search/api/')
  expect(saved.queriedAt).toBeInstanceOf(Date);expect(saved.results).toHaveLength(5)
  expect(saved.isAvailableInCatalog).toBe(false)
})

test('internal catalog results suppress external requests regardless of opt-in settings',async()=>{
  enable()
  expect((await discoverExternally('حذاء',{internalTotal:1})).enabled).toBe(false)
  expect(global.fetch).not.toHaveBeenCalled()
})

test('provider failure and timeout are explicit unavailable states without fabricated links',async()=>{
  enable()
  global.fetch.mockRejectedValue(Object.assign(new Error('timeout'),{name:'TimeoutError'}))
  const res=await request(app).post('/api/ai-search').send({query:'مضخة صناعية'})
  expect(res.status).toBe(200)
  expect(res.body.externalDiscovery).toMatchObject({enabled:false,reason:'external_provider_unavailable',results:[]})
  expect(await ExternalDiscoveryResult.countDocuments()).toBe(0)
  global.fetch.mockResolvedValue({ok:false,status:429})
  const limited=await request(app).post('/api/ai-search').send({query:'مضخة صناعية'})
  expect(limited.body.externalDiscovery.enabled).toBe(false)
})

test('visual similarity requires buyer supplied words before external discovery and never invents an image label',async()=>{
  enable()
  global.fetch.mockResolvedValue({ok:true,json:async()=>({web:{results:rows}})})
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
  const unlabeled=await request(app).post('/api/image-search').attach('image',png,'pump.png')
  expect(unlabeled.status).toBe(200)
  expect(unlabeled.body.externalDiscovery.reason).toBe('text_query_required')
  expect(unlabeled.body.detectedProduct).toBe('')
  expect(global.fetch).not.toHaveBeenCalled()
  const res=await request(app).post('/api/image-search').field('q','مضخة صناعية').attach('image',png,'ignored.png')
  expect(res.status).toBe(200);expect(res.body.products).toEqual([])
  expect(res.body.externalDiscovery.results).toHaveLength(5)
  expect(res.body.sourcingOffer.canRequestSourcing).toBe(true)
  expect(Anthropic).not.toHaveBeenCalled()
})

test('displayed external URLs reject credentials, private endpoints and non-web protocols',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,test','http://localhost/x','http://127.0.0.1','http://169.254.169.254','http://[::1]/','https://user:password@example.com','https://service.internal/path','https://example.com:1234/path'])
    expect(safePublicUrl(url)).toBeNull()
  expect(safePublicUrl('https://supplier.example/catalog#section')).toBe('https://supplier.example/catalog')
})
