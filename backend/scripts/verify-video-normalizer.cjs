const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{performance}=require('node:perf_hooks');
// Offline acceptance probe. Use only synthetic clips and trusted, verified binaries.
// Never call this script from an upload route or give it untrusted customer files.
const {inspectVideoContainer}=require('../services/videoContainer');
if(process.argv.length!==7)throw Error('Usage: node verify-video-normalizer.cjs <ffmpeg> <ffprobe> <synthetic fixture directory> <new output directory> <expected version prefix>');
const [ffmpeg,ffprobe,source,root]=process.argv.slice(2,6).map(p=>path.resolve(p));
const expectedVersion=process.argv[6];
if(!expectedVersion||!fs.statSync(ffmpeg).isFile()||!fs.statSync(ffprobe).isFile()||!fs.statSync(source).isDirectory())throw Error('Explicit verified executable and fixture paths required');
fs.mkdirSync(root,{recursive:false});
const MAX=20*1024*1024;
function run(exe,args,input=Buffer.alloc(0),{timeout=15000,limit=MAX}={}){
 return new Promise((resolve,reject)=>{
  const started=performance.now(),child=spawn(exe,args,{shell:false,windowsHide:true,cwd:root,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:root,TMP:root}});
  let fault=null,bytes=0,errBytes=0,out=[],err=[];
  const fail=reason=>{if(!fault){fault=Error(reason);child.kill();}};
  const timer=setTimeout(()=>fail('worker timeout'),timeout);
  child.stdout.on('data',b=>{bytes+=b.length;if(bytes>limit)fail('stdout budget');else if(!fault)out.push(b)});
  child.stderr.on('data',b=>{errBytes+=b.length;if(errBytes>128*1024)fail('stderr budget');else if(!fault)err.push(b)});
  child.stdin.on('error',()=>{});child.on('error',()=>fail('spawn error'));
  child.on('close',code=>{clearTimeout(timer);if(fault)return reject(fault);if(code!==0)return reject(Error('decoder failed: '+Buffer.concat(err).toString('utf8').slice(-400)));resolve({out:Buffer.concat(out),stderr:Buffer.concat(err).toString('utf8'),ms:Math.round(performance.now()-started)})});
  child.stdin.end(input);
 });
}
const common=['-hide_banner','-v','error','-max_alloc','67108864'];
const inputArgs=mime=>['-protocol_whitelist','pipe','-f',mime==='video/mp4'?'mov':'matroska',...(mime==='video/mp4'?['-enable_drefs','0','-use_absolute_path','0']:[]),'-i','pipe:0'];
async function probe(b,mime){
 const result=await run(ffprobe,[...common,...inputArgs(mime),'-show_entries','stream=codec_type,codec_name,width,height,pix_fmt:format=format_name,duration','-of','json'],b,{limit:65536});
 const p=JSON.parse(result.out);
 if(!Array.isArray(p.streams)||p.streams.length!==1)throw Error('only silent single-video-track clips supported in this experiment');
 const s=p.streams[0],allowed=mime==='video/mp4'?['h264']:['vp8','vp9'];
 if(s.codec_type!=='video'||!allowed.includes(s.codec_name)||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<16||s.height<16||s.width>1920||s.height>1920||s.width*s.height>1920*1080||s.width%2||s.height%2)throw Error('unsupported codec or dimensions');
 return s;
}
async function normalize(b,mime){
 inspectVideoContainer(b,mime);const source=await probe(b,mime);
 const r=await run(ffmpeg,[...common,'-nostdin','-xerror','-abort_on','empty_output+empty_output_stream','-filter_threads','1','-filter_complex_threads','1','-threads','1','-max_pixels','2073600','-err_detect','explode',...inputArgs(mime),'-map','0:v:0','-an','-sn','-dn','-map_metadata','-1','-map_chapters','-1','-t','31','-vf','fps=24','-c:v','libx264','-threads','1','-preset','veryfast','-pix_fmt','yuv420p','-crf','24','-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],b);
 inspectVideoContainer(r.out,'video/mp4');
 const output=await probe(r.out,'video/mp4');
 const verified=await run(ffmpeg,[...common,'-nostdin','-xerror','-abort_on','empty_output+empty_output_stream','-threads','1','-max_pixels','2073600','-err_detect','explode',...inputArgs('video/mp4'),'-map','0:v:0','-an','-sn','-dn','-progress','pipe:1','-nostats','-f','null','pipe:2'],r.out,{limit:65536});
 const progress=verified.out.toString('utf8'),frames=[...progress.matchAll(/^frame=(\d+)\s*$/gm)].map(m=>Number(m[1])).at(-1),us=[...progress.matchAll(/^out_time_us=(\d+)\s*$/gm)].map(m=>Number(m[1])).at(-1);
 if(!progress.includes('progress=end')||!Number.isInteger(frames)||frames<1||frames>720||!Number.isFinite(us)||us<=0||us>30000000)throw Error('decoded duration/frame policy failed');
 return {source,output,bytes:r.out.length,frames,durationUs:us,normalizationMs:r.ms,verificationMs:verified.ms,data:r.out};
}
async function main(){
 const cases=[];
 const actualVersion=(await run(ffmpeg,['-version'],Buffer.alloc(0),{limit:65536})).out.toString().split(/\r?\n/)[0];
 const probeVersion=(await run(ffprobe,['-version'],Buffer.alloc(0),{limit:65536})).out.toString().split(/\r?\n/)[0];
 if(!actualVersion.startsWith('ffmpeg version '+expectedVersion)||!probeVersion.startsWith('ffprobe version '+expectedVersion))throw Error('Unexpected tool version');
 for(const ext of ['mp4','webm']){
  const b=fs.readFileSync(path.join(source,'recorder.'+ext)),mime='video/'+ext;
  const {data,...result}=await normalize(b,mime);fs.writeFileSync(path.join(root,'normalized-'+ext+'.mp4'),data);
  cases.push({case:ext,status:'PASS',...result});
  await assert.rejects(normalize(b.subarray(0,Math.floor(b.length/2)),mime));cases.push({case:ext+' half truncation',status:'REJECTED'});
  const wrong=ext==='mp4'?'video/webm':'video/mp4';await assert.rejects(normalize(b,wrong));cases.push({case:ext+' wrong MIME',status:'REJECTED'});
 }
 // A structurally acceptable envelope with fabricated inner content must be rejected.
 const box=(type,payload)=>{const h=Buffer.alloc(8);h.writeUInt32BE(8+payload.length);h.write(type,4);return Buffer.concat([h,payload])};
 const fake=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',Buffer.from([1])),box('mdat',Buffer.from([1,2,3]))]);
 inspectVideoContainer(fake,'video/mp4');await assert.rejects(normalize(fake,'video/mp4'));cases.push({case:'fake MP4 passes preflight but decoder rejects',status:'REJECTED'});
 // Generated fixtures only; lavfi never processes user input.
 async function sample(size,duration,codec='libx264',audio=false){
  const r=await run(ffmpeg,[...common,'-nostdin','-f','lavfi','-i','color=c=blue:s='+size+':r=4',...(audio?['-f','lavfi','-i','sine=frequency=440:sample_rate=44100']:[]),'-t',String(duration),'-c:v',codec,'-threads','1','-pix_fmt','yuv420p',...(audio?['-c:a','aac']:['-an']),'-movflags','+frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1']);return r.out;
 }
 for(const [name,b,reason] of [['duration over 30s',await sample('64x64',32),/decoded duration/],['oversized dimensions',await sample('2048x32',1),/unsupported codec or dimensions/],['unsupported video codec',await sample('64x64',1,'mpeg4'),/unsupported codec or dimensions/],['audio track outside pilot scope',await sample('64x64',1,'libx264',true),/single-video-track/]]){
  inspectVideoContainer(b,'video/mp4');await assert.rejects(normalize(b,'video/mp4'),reason);cases.push({case:name,status:'REJECTED'});
 }
 const original=fs.readFileSync(path.join(source,'recorder.mp4')),corrupt=Buffer.from(original);
 for(let o=0;o<corrupt.length;){const n=corrupt.readUInt32BE(o),type=corrupt.toString('ascii',o+4,o+8);if(n<8||o+n>corrupt.length)throw Error('unexpected sample layout');if(type==='mdat')corrupt.fill(0,o+8,o+n);o+=n;}
 inspectVideoContainer(corrupt,'video/mp4');await assert.rejects(normalize(corrupt,'video/mp4'));cases.push({case:'corrupt encoded media with valid outer boxes',status:'REJECTED'});
 // Native child-process budgets independently checked using trusted Node.
 await assert.rejects(run(process.execPath,['-e','setTimeout(()=>{},10000)'],Buffer.alloc(0),{timeout:200,limit:1024}),/worker timeout/);
 cases.push({case:'wall-clock timeout',status:'PASS'});
 await assert.rejects(run(process.execPath,['-e','process.stdout.write(Buffer.alloc(4096))'],Buffer.alloc(0),{limit:1024}),/stdout budget/);
 cases.push({case:'stdout budget',status:'PASS'});
 await assert.rejects(run(process.execPath,['-e','process.stderr.write(Buffer.alloc(256*1024))']),/stderr budget/);cases.push({case:'stderr budget',status:'PASS'});
 const version=(await run(ffmpeg,['-version'],Buffer.alloc(0),{limit:65536})).out.toString().split(/\r?\n/)[0];
 const result={status:'PASS',version,cases,scope:'lab only; silent clips; no OS sandbox or hard aggregate memory cap; no production route'};
 fs.writeFileSync(path.join(root,'normalizer-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
