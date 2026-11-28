// Fixed-path lab bridge only, no production service or network endpoint.
const net=require('node:net');const path=require('node:path');
if(process.platform!=='linux'||process.getuid()!==61002||process.argv.length!==3||!path.isAbsolute(process.argv[2]))process.exit(1);
const sock=net.createConnection({path:process.argv[2],allowHalfOpen:true});
let bytes=0,ended=false;const limit=20*1024*1024+4100;
function fail(){sock.destroy();process.stdin.destroy();process.exitCode=1;}
const timer=setTimeout(fail,41000);
sock.on('error',fail);process.stdin.on('error',fail);process.stdout.on('error',fail);
// Keep the connection open after request EOF: closure signals cancellation to supervisor.
process.stdin.on('end',()=>{ended=true});process.stdin.pipe(sock,{end:false});
sock.on('data',b=>{bytes+=b.length;if(bytes>limit)fail()});sock.pipe(process.stdout);
sock.on('end',()=>{clearTimeout(timer);if(!ended||!bytes)process.exitCode=1;sock.end()});
sock.on('close',()=>{clearTimeout(timer);process.stdin.destroy()});
