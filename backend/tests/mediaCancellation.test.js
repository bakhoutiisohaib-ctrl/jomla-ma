jest.mock('../models/MediaAsset', () => ({ findOne: jest.fn() }))
jest.mock('../middleware/auth', () => ({ authenticate: (_req, _res, next) => next() }))
jest.mock('../middleware/errorHandler', () => ({ asyncHandler: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next) }))
jest.mock('../services/mediaPrivacy', () => ({ mayReadAsset: jest.fn(), verifiedAssetStream: jest.fn() }))

const express = require('express')
const http = require('http')
const { Readable } = require('stream')
const request = require('supertest')
const MediaAsset = require('../models/MediaAsset')
const { mayReadAsset, verifiedAssetStream } = require('../services/mediaPrivacy')
const route = require('../routes/media')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const bytes = Buffer.from('synthetic verified bytes')
const asset = { filename:'test.png', mimetype:'image/png', sha256:'a'.repeat(64) }
let server, url, errors, closed, reported
function snapshot(stream = Readable.from([bytes])) {
  const released = deferred()
  return { stream, size: bytes.length, close: jest.fn(async () => { stream.destroy(); released.resolve() }), released }
}
beforeEach(async () => {
  jest.resetAllMocks()
  delete process.env.MEDIA_REVALIDATION
  MediaAsset.findOne.mockReturnValue({ lean: async () => asset })
  mayReadAsset.mockResolvedValue(true)
  errors = []; closed = deferred(); reported = deferred()
  const app = express()
  app.use((_req,res,next) => { res.once('close',closed.resolve); next() })
  app.use('/api/media',route)
  app.use((err,_req,res,_next) => { errors.push(err); reported.resolve(err); if(!res.destroyed && !res.headersSent) res.status(500).end() })
  server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)) })
  url = 'http://127.0.0.1:'+server.address().port+'/api/media/test.png'
})
afterEach(async () => {
  delete process.env.MEDIA_REVALIDATION
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.() })
})
jest.setTimeout(20000)
test('normal GET, HEAD and opt-in conditional GET preserve bytes and close snapshots', async () => {
  const a=snapshot(); verifiedAssetStream.mockResolvedValueOnce(a)
  const response=await request(server).get('/api/media/test.png')
  expect(response.status).toBe(200); expect(response.body).toEqual(bytes)
  expect(response.headers['cache-control']).toBe('private, no-store')
  await a.released.promise; expect(a.close).toHaveBeenCalledTimes(1)
  const b=snapshot(); verifiedAssetStream.mockResolvedValueOnce(b)
  expect((await request(server).head('/api/media/test.png')).headers['content-length']).toBe(String(bytes.length))
  await b.released.promise; expect(b.close).toHaveBeenCalledTimes(1)
  process.env.MEDIA_REVALIDATION='1'
  const c=snapshot(); verifiedAssetStream.mockResolvedValueOnce(c)
  expect((await request(server).get('/api/media/test.png').set('If-None-Match','"'+asset.sha256+'"')).status).toBe(304)
  await c.released.promise; expect(c.close).toHaveBeenCalledTimes(1)
  expect(errors).toEqual([])
})
test('client disconnect after verification begins closes the snapshot without piping', async () => {
  const started=deferred(), finish=deferred(), a=snapshot()
  const read=jest.spyOn(a.stream,'pipe')
  verifiedAssetStream.mockImplementation(async()=>{started.resolve(); return finish.promise})
  const client=http.get(url); client.on('error',()=>{})
  await started.promise; client.destroy(); await closed.promise
  finish.resolve(a); await a.released.promise
  expect(read).not.toHaveBeenCalled(); expect(a.close).toHaveBeenCalledTimes(1); expect(errors).toEqual([])
})
test('client disconnect during streaming releases snapshot without reporting a storage failure', async () => {
  let started=false
  const stream=new Readable({read(){if(!started){started=true;this.push(bytes.subarray(0,4))}}})
  const a=snapshot(stream); verifiedAssetStream.mockResolvedValue(a)
  const client=http.get(url,res=>{res.on('error',()=>{});res.once('data',()=>client.destroy())})
  client.on('error',()=>{})
  await closed.promise; await a.released.promise
  await new Promise(resolve=>setImmediate(resolve))
  expect(a.close).toHaveBeenCalledTimes(1); expect(errors).toEqual([])
})
test('actual source error is not hidden by the destroyed response', async () => {
  const failure=Object.assign(new Error('synthetic source failure'),{code:'EIO'})
  const a=snapshot(new Readable({read(){this.destroy(failure)}}))
  verifiedAssetStream.mockResolvedValue(a)
  const client=http.get(url,res=>res.resume()); client.on('error',()=>{})
  expect(await reported.promise).toBe(failure)
  await a.released.promise; expect(a.close).toHaveBeenCalledTimes(1)
})
test('denied media never opens a verified snapshot', async () => {
  mayReadAsset.mockResolvedValue(false)
  const response=await request(server).get('/api/media/test.png')
  expect(response.status).toBe(401)
  expect(verifiedAssetStream).not.toHaveBeenCalled()
})
