// Production parser chain over loopback HTTP. No database connection or real env.
jest.mock('dotenv', () => ({ config: jest.fn(() => ({ parsed: {} })) }))
jest.mock('morgan', () => () => (_req, _res, next) => next())
jest.mock('../middleware/logger', () => ({
  requestLogger: (_req, _res, next) => next(), logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn()
}))
jest.mock('node:zlib', () => {
  const actual = jest.requireActual('node:zlib')
  const blocked = () => { throw new Error('A request decompressor must never be constructed') }
  return { ...actual, createGunzip: jest.fn(blocked), createInflate: jest.fn(blocked), createBrotliDecompress: jest.fn(blocked) }
})

const http = require('http'), fs = require('fs'), os = require('os'), path = require('path')
const { spawnSync } = require('child_process')
const zlib = require('node:zlib'), realZlib = jest.requireActual('node:zlib')
const jwt = require('jsonwebtoken')
process.env.JWT_SECRET = 'r41-parser-tests-only-never-a-real-session-secret'
process.env.DISABLE_REDIS = '1'
const app = require('../server')
const Supplier = require('../models/Supplier'), Organization = require('../models/Organization')
const { authenticate, requirePermission } = require('../middleware/auth')
const secret = process.env.JWT_SECRET
const LIMIT = 100 * 1024
const types = ['application/json', 'application/x-www-form-urlencoded']
const encoders = { gzip: realZlib.gzipSync, deflate: realZlib.deflateSync, br: realZlib.brotliCompressSync }
const decoderNames = ['createGunzip', 'createInflate', 'createBrotliDecompress']
let server, port
const validBody = type => type === types[0] ? '{"name":"اختبار","nested":{"value":"ok"}}' : 'name='+encodeURIComponent('اختبار')+'&nested[value]=ok'
const sizedBody = (type, bytes) => type === types[0]
  ? '{"value":"' + 'a'.repeat(bytes - Buffer.byteLength('{"value":""}')) + '"}'
  : 'value=' + 'a'.repeat(bytes - 6)

app.post('/__r41_parser_probe', (req, res) => res.json({ body: req.body }))
app.post('/__r41_private_probe', authenticate, requirePermission('manage_products'), (req, res) => res.json({ body: req.body, actor: req.supplier.id }))

function send(body = '', { type = types[0], encoding, method = 'POST', target = '/__r41_parser_probe', token, chunked = false } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const headers = { 'Content-Type': type, ...(encoding ? { 'Content-Encoding': encoding } : {}),
    ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!chunked ? { 'Content-Length': bytes.length } : {}) }
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: target, method, headers, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body; try { body = JSON.parse(text) } catch { body = null }
        resolve({ status: response.statusCode, body, text, headers: response.headers })
      })
    })
    request.on('error', reject)
    request.setTimeout(5000, () => request.destroy(new Error('Isolated parser request timed out')))
    if (chunked) { request.write(bytes.subarray(0, Math.floor(bytes.length / 2))); request.end(bytes.subarray(Math.floor(bytes.length / 2))) }
    else request.end(bytes)
  })
}

beforeAll(async () => {
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  port = server.address().port
})
afterEach(() => {
  for (const name of decoderNames) expect(zlib[name]).not.toHaveBeenCalled()
  jest.restoreAllMocks()
})
afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)) })

test.each(types)('ordinary UTF-8 %s is parsed unchanged', async type => {
  const result = await send(validBody(type), { type })
  expect(result.status).toBe(200)
  expect(result.body.body).toEqual({ name: 'اختبار', nested: { value: 'ok' } })
})
test('explicit identity encoding remains accepted', async () => {
  expect((await send('{"ok":true}', { encoding: 'identity' })).body.body).toEqual({ ok: true })
})
test.each(types.flatMap(type => [false, true].map(chunked => [type, chunked])))('%s accepts exactly 100 KiB (chunked=%s)', async (type, chunked) => {
  const body = sizedBody(type, LIMIT)
  expect(Buffer.byteLength(body)).toBe(LIMIT)
  const result = await send(body, { type, chunked })
  expect(result.status).toBe(200)
  expect(result.body.body.value).toBeDefined()
})
test.each(types.flatMap(type => [false, true].map(chunked => [type, chunked])))('%s rejects 100 KiB + 1 byte (chunked=%s)', async (type, chunked) => {
  const result = await send(sizedBody(type, LIMIT + 1), { type, chunked })
  expect(result.status).toBe(413)
  expect(result.body).toEqual({ code: 'REQUEST_BODY_TOO_LARGE', message: expect.any(String) })
})
test('the size limit counts UTF-8 bytes rather than JavaScript characters', async () => {
  const body = JSON.stringify({ value: 'م'.repeat(LIMIT / 2) })
  expect(body.length).toBeLessThan(LIMIT)
  expect(Buffer.byteLength(body)).toBeGreaterThan(LIMIT)
  expect((await send(body)).status).toBe(413)
})

test.each(types.flatMap(type => Object.keys(encoders).map(encoding => [type, encoding])))('%s rejects %s before constructing a decoder', async (type, encoding) => {
  const result = await send(encoders[encoding](Buffer.from(validBody(type))), { type, encoding })
  expect(result.status).toBe(415)
  expect(result.body).toEqual({ code: 'REQUEST_ENCODING_UNSUPPORTED', message: expect.any(String) })
})
test.each(types)('%s rejects compressed frames with trailing bytes without decoding them', async type => {
  const bytes = Buffer.concat([realZlib.gzipSync(Buffer.from(validBody(type))), Buffer.from('R41_TRAILING_TEST_BYTES')])
  const result = await send(bytes, { type, encoding: 'gzip', chunked: true })
  expect(result.status).toBe(415)
  expect(result.body.code).toBe('REQUEST_ENCODING_UNSUPPORTED')
})
test.each(['GZIP', 'gzip, br', 'R41_PRIVATE_ENCODING'])('encoding %s is rejected without echoing the header', async encoding => {
  const result = await send('{}', { encoding })
  expect(result.status).toBe(415)
  expect(result.text).not.toContain(encoding)
})
test('encoded JSON is rejected before routing or authentication', async () => {
  expect((await send(realZlib.gzipSync(Buffer.from('{}')), { encoding: 'gzip', target: '/not-a-real-route' })).status).toBe(415)
  expect((await send(realZlib.gzipSync(Buffer.from('{}')), { encoding: 'gzip', target: '/api/products' })).status).toBe(415)
})
test.each(['test', 'development'])('malformed JSON does not expose body or stack in %s', async environment => {
  const old = process.env.NODE_ENV; process.env.NODE_ENV = environment
  try {
    const result = await send('{"private":"R41_BODY_SENTINEL",')
    expect(result.status).toBe(400)
    expect(result.body).toEqual({ code: 'REQUEST_BODY_INVALID', message: expect.any(String) })
    expect(result.text).not.toMatch(/R41_BODY_SENTINEL|SyntaxError|stack|Unexpected|entity\.parse|node_modules/)
  } finally { process.env.NODE_ENV = old }
})
test('JSON strictness still rejects primitive bodies safely', async () => {
  expect((await send('"R41_BODY_SENTINEL"')).body).toEqual({ code: 'REQUEST_BODY_INVALID', message: expect.any(String) })
})
test.each(types)('%s rejects unsupported charsets with a fixed response', async type => {
  const result = await send(validBody(type), { type: type + '; charset=x-r41-private' })
  expect(result.status).toBe(415)
  expect(result.body.code).toBe('REQUEST_CHARSET_UNSUPPORTED')
  expect(result.text).not.toContain('x-r41-private')
})
test('the existing URL-encoded parameter limit remains enforced', async () => {
  const result = await send(Array.from({ length: 1001 }, (_, i) => 'p' + i + '=x').join('&'), { type: types[1] })
  expect(result.status).toBe(413)
  expect(result.body.code).toBe('REQUEST_BODY_TOO_LARGE')
})
test('the existing URL-encoded depth limit fails safely', async () => {
  const result = await send('x' + '[x]'.repeat(40) + '=R41_BODY_SENTINEL', { type: types[1] })
  expect(result.status).toBe(400)
  expect(result.body.code).toBe('REQUEST_BODY_INVALID')
  expect(result.text).not.toContain('R41_BODY_SENTINEL')
})

test('public API and health remain available after parser rejections', async () => {
  expect((await send('', { method: 'GET', target: '/' })).status).toBe(200)
  expect((await send('', { method: 'GET', target: '/health/live' })).body).toEqual({ status: 'ok' })
})
test.each([['missing', undefined], ['invalid', 'invalid-session'], ['expired', jwt.sign({ id: '000000000000000000000001', tokenVersion: 0 }, secret, { expiresIn: -1 })]])('protected writes retain session rejection (%s)', async (_label, token) => {
  const lookup = jest.spyOn(Supplier, 'findById').mockImplementation(() => { throw new Error('Unexpected account lookup') })
  const result = await send('{"isDraft":true}', { target: '/api/products', token })
  expect(result.status).toBe(401)
  expect(lookup).not.toHaveBeenCalled()
})
test('a live buyer still cannot create products', async () => {
  const id = '000000000000000000000002'
  jest.spyOn(Supplier, 'findById').mockReturnValue({ select: async () => ({ _id: id, role: 'buyer', name: 'R41 synthetic buyer', isActive: true, tokenVersion: 0 }) })
  const token = jwt.sign({ id, tokenVersion: 0 }, secret)
  expect((await send('{"isDraft":true}', { target: '/api/products', token })).status).toBe(403)
})
test('authorized identity and parsed input pass through the unchanged authorization middleware', async () => {
  const id = '000000000000000000000003'
  jest.spyOn(Supplier, 'findById').mockReturnValue({ select: async () => ({ _id: id, role: 'supplier', name: 'R41 synthetic supplier', isActive: true, tokenVersion: 0 }) })
  jest.spyOn(Organization, 'findOne').mockResolvedValue(null)
  const result = await send('{"value":false}', { target: '/__r41_private_probe', token: jwt.sign({ id, tokenVersion: 0 }, secret) })
  expect(result.status).toBe(200)
  expect(result.body).toEqual({ body: { value: false }, actor: id })
})
test('registration validation errors are not replaced by the parser error handler', async () => {
  const result = await send(JSON.stringify({ name: 'x', email: 'invalid', password: 'short', city: '', phone: 'bad' }), { target: '/api/suppliers/register' })
  expect(result.status).toBe(400)
  expect(result.body.errors).toEqual(expect.any(Array))
  expect(result.body.code).toBeUndefined()
})

test('a separate real HTTP process rejects encoded bodies and stays healthy without unhandled errors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jomla-r41-parser-child-'))
  const childCode = String.raw`
    const fs=require('fs'),path=require('path'),http=require('http'),zlib=require('node:zlib');
    const gzip=zlib.gzipSync,deflate=zlib.deflateSync,br=zlib.brotliCompressSync;let decoders=0;
    for(const name of ['createGunzip','createInflate','createBrotliDecompress'])Object.defineProperty(zlib,name,{configurable:true,value:()=>{decoders++;throw Error('Unexpected decompressor')}});
    const dotenv=require.resolve('dotenv');require.cache[dotenv]={id:dotenv,filename:dotenv,loaded:true,exports:{config:()=>({parsed:{}})}};
    const app=require(process.env.R41_APP);app.post('/__child_probe',(req,res)=>res.json({ok:!!req.body}));
    const server=app.listen(0,'127.0.0.1',async()=>{
      const port=server.address().port,cases=[];
      function send(bytes,type,encoding){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:'/__child_probe',method:'POST',agent:false,headers:{'Content-Type':type,'Content-Length':bytes.length,...(encoding?{'Content-Encoding':encoding}:{})}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}))});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('timeout')));req.end(bytes)})}
      try{
        for(const type of ['application/json','application/x-www-form-urlencoded']){
          const body=Buffer.from(type==='application/json'?'{"ok":true}':'ok=true');
          cases.push({kind:'plain',...(await send(body,type))});
          for(const [encoding,encode] of [['gzip',gzip],['deflate',deflate],['br',br]])cases.push({kind:'compressed',encoding,...(await send(encode(body),type,encoding))});
          cases.push({kind:'trailing',...(await send(Buffer.concat([gzip(body),Buffer.from('R41_TRAILING')]),type,'gzip'))});
        }
        cases.push({kind:'invalid',...(await send(Buffer.from('{"private":"R41_CHILD_SENTINEL",'),'application/json'))});
        await new Promise(resolve=>setTimeout(resolve,75));
        cases.push({kind:'survival',...(await send(Buffer.from('{"ok":true}'),'application/json'))});
        console.log('R41_CHILD_RESULT='+JSON.stringify({decoders,cases}));
      }catch(e){console.error('R41_CHILD_FAILED');process.exitCode=1}
      finally{server.close(()=>{require(path.join(path.dirname(process.env.R41_APP),'middleware/logger')).logger.close()})}
    });
  `
  const child = spawnSync(process.execPath, ['-e', childCode], {
    cwd: path.resolve(__dirname, '..'), timeout: 15000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: 'development', R41_APP: path.resolve(__dirname, '../server.js'),
      LOG_DIR: path.join(root, 'logs'), UPLOADS_DIR: path.join(root, 'uploads'), MONGODB_URI: 'mongodb://127.0.0.1:1/disabled_r41_original',
      JWT_SECRET: 'r41-child-synthetic-secret-with-no-real-account', CLAUDE_API_KEY: '', BRAVE_SEARCH_API_KEY: '', EXTERNAL_DISCOVERY_ENABLED: 'false', DISABLE_REDIS: '1' }
  })
  expect(child.error).toBeUndefined()
  expect(child.status).toBe(0)
  expect(child.stderr).not.toMatch(/uncaught|unhandled|SyntaxError|R41_CHILD_FAILED/i)
  const line = child.stdout.split(/\r?\n/).find(line => line.startsWith('R41_CHILD_RESULT='))
  expect(line).toBeDefined()
  const result = JSON.parse(line.slice('R41_CHILD_RESULT='.length))
  expect(result.decoders).toBe(0)
  expect(result.cases).toHaveLength(12)
  for (const entry of result.cases) {
    expect(entry.status).toBe(['compressed', 'trailing'].includes(entry.kind) ? 415 : entry.kind === 'invalid' ? 400 : 200)
    if (entry.kind === 'invalid') expect(JSON.stringify(entry.body)).not.toContain('R41_CHILD_SENTINEL')
  }
})

