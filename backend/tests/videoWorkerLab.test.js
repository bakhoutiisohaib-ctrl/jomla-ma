const path=require('node:path')
const {createOfflineVideoWorker:create}=require('../services/videoWorkerLab')
const {MAX_VIDEO_BYTES}=require('../services/videoContainer')
const box=(type,payload)=>{const h=Buffer.alloc(8);h.writeUInt32BE(8+payload.length);h.write(type,4);return Buffer.concat([h,payload])}
const sample=()=>Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',Buffer.from([1])),box('mdat',Buffer.from([1,2,3]))])
// Trusted synthetic protocol peer. Never decodes media; these are intentionally fake MP4 envelopes.
const peer=`
const {createHash}=require('node:crypto'),hash=b=>createHash('sha256').update(b).digest('hex'),mode=process.argv[1];
const chunks=[];process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',()=>{
 const b=Buffer.concat(chunks),n=b.readUInt32BE(),h=JSON.parse(b.subarray(4,4+n)),data=b.subarray(4+n);
 if(h.bytes!==data.length||h.inputSha256!==hash(data))process.exit(3);
 if(mode==='hang'){setInterval(()=>{},1000);return}
 if(mode==='fail'){process.stderr.write('PRIVATE synthetic diagnostic');process.exitCode=4;return}
 if(mode==='stderr'){process.stderr.write(Buffer.alloc(140*1024));return}
 if(mode==='stdout'){process.stdout.write(Buffer.alloc(21*1024*1024));return}
 if(mode==='bad-header'){process.stdout.write(Buffer.from([255,255,255,255]));return}
 let meta={version:1,jobId:h.jobId,inputSha256:h.inputSha256,mime:'video/mp4',codec:'h264',fps:24,frames:48,durationUs:2000000,width:320,height:180,bytes:data.length,outputSha256:hash(data)};
 if(mode==='wrong-job')meta.jobId='foreign';
 if(mode==='wrong-input')meta.inputSha256='0'.repeat(64);
 if(mode==='wrong-hash')meta.outputSha256='0'.repeat(64);
 if(mode==='extra')meta.path='private/path';
 if(mode==='duration')meta.durationUs=30000001;
 if(mode==='frames')meta.frames=49;
 if(mode==='pixels')meta.width=1920,meta.height=1920;
 if(mode==='bad-output'){data.fill(0);meta.outputSha256=hash(data)}
 const header=Buffer.from(JSON.stringify(meta)),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);
 function respond(){process.stdout.write(prefix);process.stdout.write(header);process.stdout.write(data);if(mode==='trailing')process.stdout.write('extra');if(mode==='warning')process.stderr.write('warning')}
 if(mode==='delay')setTimeout(respond,300);else respond();
});`
const worker=(mode='ok',opts={})=>create({executable:process.execPath,args:['-e',peer,mode],cwd:__dirname,timeoutMs:4000,...opts})
test('explicit offline worker configuration required',()=>{
 expect(()=>create()).toThrow('VIDEO_WORKER_CONFIG')
 expect(()=>create({executable:'ffmpeg',cwd:__dirname})).toThrow('VIDEO_WORKER_CONFIG')
 expect(()=>create({executable:process.execPath,cwd:__dirname,timeoutMs:999999})).toThrow('VIDEO_WORKER_CONFIG')
})
test('strict receipt binds bytes, input, job and normalized policy; repeat creates new job',async()=>{
 const w=worker(),b=sample(),a=await w.normalize(b,'video/mp4'),c=await w.normalize(b,'video/mp4')
 expect(a.data).toEqual(b);expect(a.metadata).toMatchObject({frames:48,durationUs:2000000,width:320,height:180})
 expect(a.metadata.jobId).not.toBe(c.metadata.jobId);expect(w.state()).toEqual({active:false,poisoned:false})
})
test('single flight, no queue, caller mutation cannot change admitted input',async()=>{
 const w=worker('delay'),b=sample(),original=Buffer.from(b),p=w.normalize(b,'video/mp4')
 b.fill(0);expect(w.state().active).toBe(true)
 await expect(w.normalize(original,'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_BUSY',status:429})
 expect((await p).data).toEqual(original);expect(w.state().active).toBe(false)
})
test('invalid input and already cancelled request never occupy slot',async()=>{
 const w=worker(),c=new AbortController();c.abort()
 await expect(w.normalize(sample(),'video/mp4',{signal:c.signal})).rejects.toMatchObject({code:'VIDEO_WORKER_CANCELLED'})
 await expect(w.normalize(Buffer.alloc(100),'video/mp4')).rejects.toMatchObject({code:'VIDEO_CONTAINER_INVALID'})
 await expect(w.normalize(Buffer.alloc(MAX_VIDEO_BYTES+1),'video/mp4')).rejects.toMatchObject({code:'VIDEO_TOO_LARGE'})
 expect(w.state()).toEqual({active:false,poisoned:false})
})
test.each(['wrong-job','wrong-input','wrong-hash','extra','duration','frames','pixels','bad-output','bad-header','trailing'])('rejects invalid worker receipt: %s',async mode=>{
 const w=worker(mode);await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_PROTOCOL'})
 expect(w.state().active).toBe(false)
})
test.each(['stdout','stderr'])('terminates on %s budget',async mode=>{
 const w=worker(mode);await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_OUTPUT_LIMIT'});expect(w.state().active).toBe(false)
})
test('nonzero exit and diagnostic output are never returned to caller',async()=>{
 for(const mode of ['fail','warning']){
 const w=worker(mode);await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({message:'VIDEO_WORKER_FAILED'})
 expect(w.state().active).toBe(false)}
})
test('deadline kills hanging peer; slot can be reused after close',async()=>{
 const w=worker('hang',{timeoutMs:300})
 await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_TIMEOUT'})
 expect(w.state()).toEqual({active:false,poisoned:false})
 await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_TIMEOUT'})
})
test('abort kills peer and rejects, without result',async()=>{
 const w=worker('hang'),c=new AbortController(),p=w.normalize(sample(),'video/mp4',{signal:c.signal})
 c.abort();await expect(p).rejects.toMatchObject({code:'VIDEO_WORKER_CANCELLED'});expect(w.state().active).toBe(false)
})
test('missing executable fails closed and does not fall back',async()=>{
 const w=create({executable:path.join(__dirname,'synthetic-missing-executable.exe'),cwd:__dirname})
 await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_UNAVAILABLE'})
 expect(w.state().active).toBe(false)
})

test('malformed cancellation object rejected before admission',async()=>{
 const w=worker()
 await expect(w.normalize(sample(),'video/mp4',{signal:{aborted:false}})).rejects.toMatchObject({code:'VIDEO_WORKER_CONFIG'})
 expect(w.state()).toEqual({active:false,poisoned:false})
})
test('unconfirmed termination quarantines worker even after late close',async()=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream')
 const child=new EventEmitter()
 child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough()
 child.kill=jest.fn(()=>true)
 let createMock
 try{
  jest.doMock('node:child_process',()=>({spawn:()=>child}))
  jest.isolateModules(()=>{createMock=require('../services/videoWorkerLab').createOfflineVideoWorker})
  const w=createMock({executable:process.execPath,cwd:__dirname,timeoutMs:100,closeGraceMs:100})
  await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_TIMEOUT'})
  expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  expect(w.state()).toEqual({active:true,poisoned:true})
  await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_QUARANTINED'})
  child.emit('close',null,'SIGKILL')
  expect(w.state()).toEqual({active:false,poisoned:true})
  await expect(w.normalize(sample(),'video/mp4')).rejects.toMatchObject({code:'VIDEO_WORKER_QUARANTINED'})
 }finally{jest.dontMock('node:child_process');child.stdin.destroy();child.stdout.destroy();child.stderr.destroy()}
})
