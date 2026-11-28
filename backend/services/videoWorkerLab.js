// Offline application-facing protocol experiment. Not an isolation mechanism.
 // No production factory, route, environment switch or direct FFmpeg fallback.
const {spawn}=require('node:child_process')
const {randomUUID,createHash}=require('node:crypto')
const path=require('node:path')
const {inspectVideoContainer,MAX_VIDEO_BYTES}=require('./videoContainer')
const HEADER_MAX=4096, STDERR_MAX=128*1024
const hash=b=>createHash('sha256').update(b).digest('hex')
const fail=(code,status=503)=>Object.assign(Error(code),{code,status})
function frame(header,data){
 const h=Buffer.from(JSON.stringify(header),'utf8')
 if(!h.length||h.length>HEADER_MAX)throw fail('VIDEO_WORKER_PROTOCOL')
 const prefix=Buffer.alloc(4);prefix.writeUInt32BE(h.length)
 return [prefix,h,data]
}
function unpack(b){
 if(b.length<4)throw fail('VIDEO_WORKER_PROTOCOL')
 const n=b.readUInt32BE(0)
 if(!n||n>HEADER_MAX||n>b.length-4)throw fail('VIDEO_WORKER_PROTOCOL')
 try{return {header:JSON.parse(b.subarray(4,4+n).toString('utf8')),data:b.subarray(4+n)}}catch{throw fail('VIDEO_WORKER_PROTOCOL')}
}
function verify(result,request){
 const {header:h,data}=unpack(result)
 if(!h||typeof h!=='object'||Array.isArray(h)||Object.keys(h).sort().join(',')!=='bytes,codec,durationUs,fps,frames,height,inputSha256,jobId,mime,outputSha256,version,width'||
 h.version!==1||h.jobId!==request.jobId||h.inputSha256!==request.inputSha256||h.mime!=='video/mp4'||h.codec!=='h264'||h.fps!==24||
 !Number.isInteger(h.frames)||h.frames<1||h.frames>720||!Number.isInteger(h.durationUs)||h.durationUs<1||h.durationUs>30000000||
 Math.abs(h.durationUs-h.frames*1000000/24)>2||
 ![h.width,h.height].every(n=>Number.isInteger(n)&&n>=16&&n<=1920&&n%2===0)||h.width*h.height>2073600||
 h.bytes!==data.length||data.length>MAX_VIDEO_BYTES||h.outputSha256!==hash(data))throw fail('VIDEO_WORKER_PROTOCOL')
 try{inspectVideoContainer(data,'video/mp4')}catch{throw fail('VIDEO_WORKER_PROTOCOL')}
 return {metadata:Object.freeze({...h}),data:Buffer.from(data)}
}
// Trusted operator configuration ONLY. A future verified broker must implement
// the protocol and OS isolation. A valid receipt is not sandbox attestation.
function createOfflineVideoWorker({executable,args=[],cwd,timeoutMs=45000,closeGraceMs=2000}={}){
 if(!path.isAbsolute(executable||'')||!path.isAbsolute(cwd||'')||!Array.isArray(args)||!args.every(a=>typeof a==='string')||
 !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>45000||!Number.isInteger(closeGraceMs)||closeGraceMs<100||closeGraceMs>2000)throw fail('VIDEO_WORKER_CONFIG')
 args=[...args]
 let active=false,poisoned=false
 const state=()=>({active,poisoned})
 async function normalize(bytes,mime,{signal}={}){
  if(poisoned)throw fail('VIDEO_WORKER_QUARANTINED')
  if(active)throw fail('VIDEO_WORKER_BUSY',429)
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw fail('VIDEO_WORKER_CONFIG')
  if(signal?.aborted)throw fail('VIDEO_WORKER_CANCELLED',409)
  inspectVideoContainer(bytes,mime)
  // Snapshot before async I/O; no caller-controlled arguments or paths.
  const input=Buffer.from(bytes),request={version:1,jobId:randomUUID(),mime,bytes:input.length,inputSha256:hash(input)}
  const parts=frame(request,input)
  active=true
  return new Promise((resolve,reject)=>{
   let child,deadline,grace,fault=null,settled=false,closed=false,exited=false,out=[],size=0,errSize=0
   const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value)}
   const stop=error=>{
    if(closed||fault)return
    fault=error;out=[]
    child.stdin.destroy()
    if(!exited){try{child.kill('SIGKILL')}catch{}}
    // A signal is not proof of termination. Keep the slot occupied until close.
    grace=setTimeout(()=>{poisoned=true;finish(fault)},closeGraceMs)
   }
   const cancel=()=>stop(fail('VIDEO_WORKER_CANCELLED',409))
   try{
    child=spawn(executable,args,{cwd,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:process.platform==='win32'?{SystemRoot:process.env.SystemRoot||'C:\\Windows',WINDIR:process.env.WINDIR||'C:\\Windows'}:{LANG:'C',LC_ALL:'C'}})
   }catch{active=false;finish(fail('VIDEO_WORKER_UNAVAILABLE'));return}
   child.once('exit',()=>{exited=true})
   child.on('error',()=>stop(fail('VIDEO_WORKER_UNAVAILABLE')))
   child.stdout.on('error',()=>stop(fail('VIDEO_WORKER_UNAVAILABLE')))
   child.stderr.on('error',()=>stop(fail('VIDEO_WORKER_UNAVAILABLE')))
   child.stdin.on('error',()=>stop(fail('VIDEO_WORKER_UNAVAILABLE')))
   child.stdout.on('data',b=>{if(fault)return;size+=b.length;if(size>MAX_VIDEO_BYTES+HEADER_MAX+4)stop(fail('VIDEO_WORKER_OUTPUT_LIMIT'));else out.push(b)})
   child.stderr.on('data',b=>{if(fault)return;errSize+=b.length;if(errSize>STDERR_MAX)stop(fail('VIDEO_WORKER_OUTPUT_LIMIT'))})
   child.once('close',(code,sig)=>{
    closed=true;clearTimeout(deadline);clearTimeout(grace);active=false
    if(fault){finish(fault);return}
    if(code!==0||sig||errSize){finish(fail('VIDEO_WORKER_FAILED'));return}
    try{finish(null,verify(Buffer.concat(out,size),request))}catch{finish(fail('VIDEO_WORKER_PROTOCOL'))}
   })
   deadline=setTimeout(()=>stop(fail('VIDEO_WORKER_TIMEOUT')),timeoutMs)
   signal?.addEventListener('abort',cancel,{once:true})
   if(signal?.aborted){cancel();return}
   for(const b of parts)child.stdin.write(b)
   child.stdin.end()
  })
 }
 return Object.freeze({normalize,state})
}
module.exports={createOfflineVideoWorker}
