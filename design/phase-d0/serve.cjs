// Optional loopback preview. Serves only this isolated design directory and D0 screenshots.
const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname,evidence=path.resolve(root,'../../reports/phase-d0-evidence');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  let base=root,relative=url==='/'?'index.html':url.replace(/^\//,'');
  const prefix='/reports/phase-d0-evidence/';
  if(url.startsWith(prefix)){base=evidence;relative=url.slice(prefix.length);}
  if(url==='/reports/phase-d0-premium-design-exploration.md'){base=path.resolve(root,'../../reports');relative='phase-d0-premium-design-exploration.md';}
  else if(url.startsWith('/reports/')&&!url.startsWith(prefix)){res.writeHead(404);return res.end('Open the report from the local workspace.');}
  const file=path.resolve(base,relative);
  if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
  fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'"});
    if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  });
});server.listen(5080,'127.0.0.1',()=>console.log('D0_DESIGN_READY http://127.0.0.1:5080 — no API or database'));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
