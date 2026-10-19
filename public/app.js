import {validateProject,exportText,exportHTML} from './model.js';
const $=id=>document.getElementById(id);
let project,index=0,selected=null,pendingSaves=0;
window.addEventListener('beforeunload',e=>{if(pendingSaves){e.preventDefault();e.returnValue='';}});
const db=new Promise((resolve,reject)=>{const r=indexedDB.open('scan-proof-desk',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function storage(value){const d=await db;return new Promise((resolve,reject)=>{const tx=d.transaction('projects',value===undefined?'readonly':'readwrite');const r=value===undefined?tx.objectStore('projects').get('current'):tx.objectStore('projects').put(value,'current');tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function status(s){$('status').textContent=s;}
async function save(){pendingSaves++;status('Saving edits…');try{await storage(project);if(pendingSaves===1)status('Saved in this browser · Save project for a portable backup.');}catch(e){status('Save failed: '+e.message+'. Export a project backup now.');}finally{pendingSaves--;}}
function safeURL(url){try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function select(id,scroll=true){selected=id;document.querySelectorAll('[data-region]').forEach(el=>el.classList.toggle('selected',el.dataset.region===id));if(scroll){const el=[...$('lines').children].find(el=>el.dataset.region===id);el?.scrollIntoView({block:'nearest'});el?.querySelector('textarea').focus({preventScroll:true});}}
function progress(){const all=project.pages.flatMap(p=>p.regions);$('progress').textContent=`${project.pages.length} pages · ${all.filter(r=>r.original!==r.corrected).length} edited lines`;}
function render(){
 $('workspace').hidden=false;$('welcome').hidden=true;$('title').textContent=project.title;progress();
 $('pages').replaceChildren();project.pages.forEach((p,i)=>{const b=document.createElement('button');b.textContent=p.label;b.className=i===index?'active':'';b.onclick=()=>{index=i;selected=null;render();};$('pages').append(b);});
 const page=project.pages[index];$('image').src=page.image;const url=safeURL(page.source_url);$('source').hidden=!url;if(url)$('source').href=url;
 $('regions').replaceChildren();$('lines').replaceChildren();
 page.regions.forEach((r,i)=>{
  const b=document.createElement('button');b.className='region';b.dataset.region=r.id;b.setAttribute('aria-label',`Select line ${i+1}`);const box=r.bbox;
  Object.assign(b.style,{left:100*box.x0/page.width+'%',top:100*box.y0/page.height+'%',width:100*(box.x1-box.x0)/page.width+'%',height:100*(box.y1-box.y0)/page.height+'%'});b.onclick=()=>select(r.id);$('regions').append(b);
  const line=document.createElement('div');line.className='line';line.dataset.region=r.id;
  const label=document.createElement('label');label.htmlFor=`edit-${i}`;label.textContent=`LINE ${i+1} · ${r.confidence==null?'MANUALLY ADDED':`OCR CONFIDENCE ${Number(r.confidence).toFixed(0)} / 100`}`;
  const edit=document.createElement('textarea');edit.id=`edit-${i}`;edit.value=r.corrected;edit.rows=2;edit.onfocus=()=>select(r.id,false);edit.oninput=()=>{r.corrected=edit.value;progress();save();};
  const details=document.createElement('details'),summary=document.createElement('summary'),original=document.createElement('pre');summary.textContent='Original OCR';original.textContent=r.original;details.append(summary,original);
  const reset=document.createElement('button');reset.textContent='Restore original';reset.onclick=()=>{r.corrected=r.original;edit.value=r.original;progress();save();};details.append(reset);line.append(label,edit,details);$('lines').append(line);
 });
 if(selected)select(selected,false);
}
const dataURL=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});
const dimensions=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve({width:im.naturalWidth,height:im.naturalHeight});im.onerror=()=>reject(Error('Cannot decode image'));im.src=src;});
async function replace(p){validateProject(p);await storage(p);project=p;index=0;selected=null;render();status('Project saved in this browser.');}
function mayReplace(){return !project||confirm('Replace the current workspace? Save project first if you need a backup.');}
async function action(fn){try{await fn();}catch(e){status('Could not complete: '+e.message);}}
$('demo').onclick=()=>action(async()=>{if(!mayReplace())return;status('Opening five real scans…');const provenance=await(await fetch('/demo/provenance.json')).json();const pages=[];for(const entry of provenance.pages){const p=await(await fetch(`/demo/page-${entry.scan}.json`)).json();const image=await dataURL(await(await fetch('/'+entry.file)).blob());pages.push({...p,image,...await dimensions(image),label:`Page ${entry.printed_page} · scan ${entry.scan}`});}await replace({version:1,title:'Bluebeard · five-page study',provenance,pages});});
$('recover').onchange=e=>action(async()=>{const file=e.target.files[0];e.target.value='';if(!file||!mayReplace())return;if(file.size>64*1024*1024)throw Error('Project exceeds 64 MiB');await replace(JSON.parse(await file.text()));});
$('scans').onchange=e=>action(async()=>{
 const files=[...e.target.files];e.target.value='';if(!files.length||!mayReplace())return;if(files.length>50)throw Error('Maximum 50 pages per project');
 const pages=[];for(const [i,file] of files.entries()){
  if(!['image/jpeg','image/png'].includes(file.type)||file.size>8*1024*1024)throw Error('Use JPEG / PNG files under 8 MiB');
  status(`CPU OCR: page ${i+1} of ${files.length} (${file.name})…`);
  const image=await dataURL(file),size=await dimensions(image);if(size.width*size.height>25000000)throw Error('Maximum 25 megapixels per image');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const response=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});const result=await response.json();if(!response.ok)throw Error(result.error);
  pages.push({label:`Page ${i+1} · ${file.name}`,image,...size,...result,sha256:hash,source_url:'',provenance:'User-supplied scan; rights and source not independently verified.'});
 }
 await replace({version:1,title:'Imported scans',pages});
});
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
for(const [id,name,type,fn] of [['backup','scan-proof-project.json','application/json',p=>JSON.stringify(p)],['text','transcription.txt','text/plain;charset=utf-8',exportText],['html','transcription.html','text/html;charset=utf-8',exportHTML]])$(id).onclick=()=>{if(!project)return status('Open a project first.');download(name,fn(project),type);};
$('add').onclick=()=>{const page=project.pages[index];const after=page.regions.findIndex(r=>r.id===selected);const region={id:crypto.randomUUID(),original:'',corrected:'',confidence:null,bbox:{x0:0,y0:0,x1:page.width,y1:page.height}};page.regions.splice(after<0?page.regions.length:after+1,0,region);selected=region.id;render();select(selected);save();status('Added after the selected line (or at page end). Manual text links to the whole page.');};
await action(async()=>{const saved=await storage();if(saved){project=validateProject(saved);render();status('Recovered your saved workspace.');}});
