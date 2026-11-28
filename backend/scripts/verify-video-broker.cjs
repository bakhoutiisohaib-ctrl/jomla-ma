// Lab caller, always run with the dedicated non-root test identity.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {createOfflineVideoWorker}=require('./services/videoWorkerLab');
(async()=>{
 const [sock,file,mime,mode]=process.argv.slice(2);assert.equal(process.getuid(),61002);
 const w=createOfflineVideoWorker({executable:process.execPath,args:[path.join(__dirname,'video-broker-client-lab.cjs'),sock],cwd:__dirname});
 const b=fs.readFileSync(file),pending=w.normalize(b,mime);
 await assert.rejects(w.normalize(b,mime),{code:'VIDEO_WORKER_BUSY'});
 if(mode==='reject'){await assert.rejects(pending);console.log(JSON.stringify({rejected:true,state:w.state()}));return}
 const r=await pending;assert.equal(r.metadata.width,320);assert.equal(r.metadata.height,180);assert.equal(r.metadata.frames,48);assert.equal(r.metadata.durationUs,2000000);
 console.log(JSON.stringify({uid:process.getuid(),mime,frames:r.metadata.frames,durationUs:r.metadata.durationUs,bytes:r.data.length,codec:r.metadata.codec,state:w.state()}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
