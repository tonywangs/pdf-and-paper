import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=process.cwd();
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.pdf':'application/pdf','.json':'application/json','.wasm':'application/wasm','.png':'image/png'};
const allowed=p=>['/','/index.html','/style.css'].includes(p)||['/src/','/node_modules/pdf-lib/dist/','/node_modules/pdfjs-dist/build/','/node_modules/pdfjs-dist/cmaps/','/node_modules/pdfjs-dist/standard_fonts/','/fixtures/','/demo/'].some(x=>p.startsWith(x));
export const server=http.createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!allowed(p))throw Error();const f=resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+'/')||!allowed(f.slice(root.length)))throw Error();const b=await readFile(f);res.writeHead(200,{'Content-Type':mime[extname(f)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' blob: data:; style-src 'self'; connect-src 'self' blob:"});res.end(b)}catch{res.writeHead(404);res.end('Not found')}});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('PDF desk: http://127.0.0.1:'+server.address().port));

process.on('message',message=>{if(message==='close')server.close(()=>process.exit(0))});
