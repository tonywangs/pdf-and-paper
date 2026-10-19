import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {epub,preview} from './book.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const routes={'/':['public/index.html','text/html'],'/app.js':['public/app.js','text/javascript'],'/style.css':['public/style.css','text/css'],'/demo.json':['demo/alice.project.json','application/json'],'/sample.epub':['demo/alice.epub','application/epub+zip'],'/provenance.json':['demo/provenance.json','application/json'],'/reader':['public/reader.html','text/html'],'/reader.js':['public/reader.js','text/javascript'],'/vendor/jszip.js':['node_modules/jszip/dist/jszip.min.js','text/javascript'],'/vendor/epub.js':['node_modules/epubjs/dist/epub.min.js','text/javascript']};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 try{
  const host=req.headers.host;if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('Use the printed loopback URL');
  const origin=req.headers.origin;if(origin&&origin!==`http://${host}`)throw Error('Cross-origin requests are not accepted');
  const url=new URL(req.url,`http://${host}`);
  if(req.method==='GET'&&routes[url.pathname]){const [p,type]=routes[url.pathname];res.setHeader('Content-Type',type+'; charset=utf-8');res.end(await fs.readFile(root+p));return;}
  if(req.method==='POST'&&['/api/preview','/api/export'].includes(url.pathname)){
   if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON body required');
   let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>30*1024*1024)throw Error('Request exceeds 30 MiB');parts.push(chunk);}
   const project=JSON.parse(Buffer.concat(parts).toString());
   if(url.pathname.endsWith('preview')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(preview(project)));}
   else{res.setHeader('Content-Type','application/epub+zip');res.setHeader('Content-Disposition','attachment; filename="book.epub"');res.end(await epub(project));}return;
  }
  res.writeHead(404);res.end('Not found');
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`EPUB Assembly Desk: http://127.0.0.1:${server.address().port}`));
