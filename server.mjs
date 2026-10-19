import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
const root=process.cwd();
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
export function start(port=Number(process.env.PORT||4318)) {
 const server=http.createServer(async(req,res)=>{
  try {
   if(req.method!=='GET') {res.writeHead(405).end();return;}
   const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const relative=path==='/'?'public/index.html':path.startsWith('/vendor/')?'node_modules/pdfjs-dist/'+path.slice(8):path.startsWith('/demo/')?path.slice(1):'public/'+path.slice(1);
   const file=resolve(root,relative);
   const allowed=['public/','demo/','node_modules/pdfjs-dist/'].some(p=>file.startsWith(resolve(root,p)+'/'));
   if(!allowed) {res.writeHead(403).end();return;}
   const data=await readFile(file);
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; img-src 'self' data: blob:; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(data);
  } catch {res.writeHead(404).end('Not found');}
 });
 return new Promise((resolve,reject)=>{server.on('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
}
if(process.argv[1]===new URL(import.meta.url).pathname) start().then(s=>console.log(`PDF Revision Desk: http://127.0.0.1:${s.address().port}`));
