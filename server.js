import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createOCR} from './ocr.js';
const port=Number(process.env.PORT||4173);
let busy=false;
const server=http.createServer(async(req,res)=>{
 const send=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});res.end(data);};
 try{
  if(req.method==='POST'&&req.url==='/api/ocr'){
   if(req.headers.origin!==`http://127.0.0.1:${port}`&&req.headers.origin!==`http://localhost:${port}`) return send(403,'{"error":"Local origin required"}');
   if(busy) return send(409,'{"error":"OCR is already running"}');
   busy=true;
   let worker;
   try{
    let data='';for await(const chunk of req){data+=chunk;if(data.length>12*1024*1024) throw Error('Image exceeds 12 MiB');}
    const {image}=JSON.parse(data);
    if(typeof image!=='string'||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image)) throw Error('Use a JPEG or PNG image');
    worker=await createOCR();send(200,JSON.stringify(await worker.recognize(image)));
   }finally{if(worker)await worker.close();busy=false;}
   return;
  }
  if(req.method!=='GET') return send(405,'{}');
  const path=new URL(req.url,'http://localhost').pathname;
  const allowed={'/':'public/index.html','/app.js':'public/app.js','/model.js':'public/model.js','/style.css':'public/style.css','/demo/provenance.json':'demo/provenance.json'};
  let file=allowed[path];
  if(/^\/demo\/(page-1[4-8]\.json|scans\/1[4-8]\.jpg)$/.test(path))file=path.slice(1);
  if(!file)return send(404,'Not found','text/plain');
  const types={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',jpg:'image/jpeg'};
  send(200,await readFile(file),types[file.split('.').pop()]);
 }catch(error){send(400,JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Scan Proof Desk: http://127.0.0.1:${port}`));
