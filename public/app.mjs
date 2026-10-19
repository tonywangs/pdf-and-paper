import * as pdfjs from '/vendor/build/pdf.mjs';
import {SETTINGS,suggest,rowsFor,validate,assign,pixelDiff,escapeHTML as esc} from './core.mjs';
pdfjs.GlobalWorkerOptions.workerSrc='/vendor/build/pdf.worker.mjs';
const $=id=>document.getElementById(id);
let state=null,selected=0,busy=false,viewToken=0;
const cache=new Map();
const dbReady=new Promise((resolve,reject)=>{const r=indexedDB.open('pdf-revision-desk',1);r.onupgradeneeded=()=>r.result.createObjectStore('desk');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function stored(mode,value){const db=await dbReady;return new Promise((resolve,reject)=>{const t=db.transaction('desk',mode==='get'?'readonly':'readwrite'),s=t.objectStore('desk');const r=mode==='get'?s.get('current'):mode==='delete'?s.delete('current'):s.put(value,'current');t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
async function save(){if(state){state.selected=selected;await stored('put',state);}}
function status(s){$('status').textContent=s;}
async function run(fn){if(busy)return;busy=true;document.body.classList.add('busy');document.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);try{await fn();}catch(e){console.error(e);status('Could not finish: '+e.message+'. Your previous saved comparison is retained.');}finally{busy=false;document.body.classList.remove('busy');document.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);}}
const tick=()=>new Promise(r=>setTimeout(r,0));
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
async function readPDF(file,progress,budget){
 if(!file.size||file.size>SETTINGS.maxBytes)throw Error('Each PDF must be nonempty and at most 16 MiB');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,stopAtErrors:true,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/',wasmUrl:'/vendor/wasm/'});
 const passwordFailure=new Promise((_,reject)=>{task.onPassword=()=>{reject(Error('Encrypted PDFs are unsupported'));void task.destroy();};});
 let pdf;try{pdf=await Promise.race([task.promise,passwordFailure]);}catch(e){throw Error('PDF could not be opened (encrypted, malformed or unsupported): '+e.message);}
 try{
  const md=await pdf.getMetadata();if(md.info.EncryptFilterName)throw Error('Encrypted PDFs are unsupported; supply an authorized decrypted copy');
  if(pdf.numPages>SETTINGS.maxPages)throw Error('Maximum 100 pages per PDF');
  const labels=await pdf.getPageLabels();const pages=[];
  for(let n=1;n<=pdf.numPages;n++){
   progress(n,pdf.numPages);await tick();
   const p=await pdf.getPage(n),vp=p.getViewport({scale:SETTINGS.dpi/72});
   const w=Math.ceil(vp.width),h=Math.ceil(vp.height);
   if(w*h>SETTINGS.maxPixels)throw Error(`Page ${n} exceeds 2 million rendered pixels`);
   budget.pixels+=w*h;if(budget.pixels>SETTINGS.maxTotalPixels)throw Error('Combined raster budget exceeds 120 million pixels');
   const c=canvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
   await p.render({canvasContext:ctx,viewport:vp,background:'rgb(255,255,255)',annotationMode:pdfjs.AnnotationMode.ENABLE}).promise;
   const small=canvas(24,32),sc=small.getContext('2d',{willReadFrequently:true});sc.drawImage(c,0,0,24,32);const d=sc.getImageData(0,0,24,32).data;
   const fingerprint=[];let ink=0;for(let i=0;i<d.length;i+=4){const g=(d[i]+d[i+1]+d[i+2])/3;fingerprint.push(Math.round(g));ink+=(255-g)/255;}
   const text=(await p.getTextContent()).items.map(x=>x.str||'').join(' ');
   pages.push({number:n,label:labels?.[n-1]||String(n),width:w,height:h,rotation:p.rotate,text,fingerprint,ink:ink/(24*32),image:c.toDataURL('image/png')});
   c.width=c.height=1;p.cleanup();
  }
  return {name:file.name,hash,size:file.size,pages,renderer:'PDF.js '+pdfjs.version};
 }finally{await pdf.destroy();}
}
async function loadPair(a,b,provenance=null){
 const budget={pixels:0};
 const old=await readPDF(a,(n,total)=>status(`Rendering earlier PDF ${n}/${total}…`),budget);
 const newer=await readPDF(b,(n,total)=>status(`Rendering later PDF ${n}/${total}…`),budget);
 if(!provenance){try{const known=await (await fetch('/demo/provenance.json')).json();if(known.documents[0].sha256===old.hash&&known.documents[1].sha256===newer.hash)provenance=known;}catch{ /* Imported files remain usable without demo metadata. */ }}
 if([...old.pages,...newer.pages].reduce((n,p)=>n+p.width*p.height,0)>SETTINGS.maxTotalPixels)throw Error('Combined raster budget exceeds 120 million pixels');
 const next={version:1,old,new:newer,matches:suggest(old.pages,newer.pages),insertions:{},tolerance:20,dpi:72,provenance,selected:0};validate(next);
 // Commit only after both inputs succeed. Recovery contains renders, never executable PDF content.
 await stored('put',next);state=next;selected=0;cache.clear();$('tolerance').value=20;
 await analyse();await display();status(`Ready. ${rowsFor(state).length} correspondences to inspect. Recovery saved in this browser.`);
}
async function pixels(page){if(!page)return null;const img=new Image();img.src=page.image;await img.decode();const c=canvas(page.width,page.height),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height);}
async function difference(row){const key=`${row.a}:${row.b}:${state.tolerance}`;if(cache.has(key))return cache.get(key);
 const a=row.a===null?null:state.old.pages[row.a],b=row.b===null?null:state.new.pages[row.b];
 const d=pixelDiff(await pixels(a),await pixels(b),state.tolerance);const c=canvas(d.width,d.height);c.getContext('2d').putImageData(new ImageData(d.data,d.width,d.height),0,0);
 const result={changed:d.changed,total:d.total,ratio:d.ratio,sizeChanged:d.sizeChanged,image:c.toDataURL('image/png')};cache.set(key,result);return result;}
async function analyse(){const rows=rowsFor(state);for(let i=0;i<rows.length;i++){status(`Calculating visual differences ${i+1}/${rows.length}…`);await difference(rows[i]);if(i%4===0)await tick();}}
function label(row){return `Earlier ${row.a===null?'—':row.a+1} → Later ${row.b===null?'—':row.b+1}`;}
function needs(row){const d=cache.get(`${row.a}:${row.b}:${state.tolerance}`);return !row.confirmed||row.a===null||row.b===null||d?.changed>0||d?.sizeChanged;}
function list(){
 const rows=rowsFor(state);const reviewed=rows.filter(r=>r.confirmed).length;
 $('summary').textContent=`${state.old.pages.length} earlier · ${state.new.pages.length} later · ${reviewed}/${rows.length} reviewed`;
 $('pages').replaceChildren();rows.forEach((r,i)=>{if($('filter').value==='attention'&&!needs(r))return;const d=cache.get(`${r.a}:${r.b}:${state.tolerance}`),button=document.createElement('button');button.className=i===selected?'active':'';button.dataset.row=i;button.textContent=label(r);const s=document.createElement('small');s.textContent=`${r.confirmed?'✓ Reviewed':'○ Needs review'} · ${r.a===null?'Insertion?':r.b===null?'Deletion?':d?.changed?`${(d.ratio*100).toFixed(2)}% pixels`:'No pixel change'}`;button.append(s);button.onclick=()=>run(async()=>{selected=i;await display();await save();});$('pages').append(button);});
}
async function display(){
 if(!state)return;const token=++viewToken;const rows=rowsFor(state);selected=Math.min(selected,rows.length-1);const row=rows[selected];
 $('workspace').hidden=false;$('welcome').hidden=true;list();
 $('pair-title').textContent=label(row);$('reason').textContent=row.reason+(row.confirmed?' · Reviewed':' · Unreviewed');
 $('correction').hidden=row.a===null;
 $('match').replaceChildren();const option=(value,text)=>{const el=document.createElement('option');el.value=value;el.textContent=text;$('match').append(el);};option('','Unmatched / possible deletion');state.new.pages.forEach((p,b)=>{const owner=state.matches.find(r=>r.b===b&&r.a!==row.a);option(String(b),`Page ${b+1} (label ${p.label})${owner?` — assigned to earlier ${owner.a+1}`:''}`);});$('match').value=row.b===null?'':String(row.b);
 $('candidates').textContent=row.candidates?'Top candidates: '+row.candidates.map(c=>`later ${c.b+1}: ${c.score.toFixed(3)}`).join(' · ')+' (heuristic score, not probability)':'Unmatched page; select an earlier page in the list to pair it.';
 for(const [prefix,doc,index] of [['old',state.old,row.a],['new',state.new,row.b]]){const image=$(prefix+'-image');image.hidden=index===null;if(index!==null){const p=doc.pages[index];image.src=p.image;$(prefix+'-caption').textContent=`${doc.name} · PDF ${index+1} · label ${p.label} · ${p.width}×${p.height}px · rotation ${p.rotation}°`;}else $(prefix+'-caption').textContent='No corresponding page';}
 const d=await difference(row);if(token!==viewToken)return;$('diff-image').src=d.image;$('metrics').textContent=`${d.changed.toLocaleString()} / ${d.total.toLocaleString()} pixels changed (${(d.ratio*100).toFixed(3)}%) · tolerance > ${state.tolerance}/255 · 72 dpi${d.sizeChanged?' · PAGE SIZE CHANGED':''}. No semantic identity claim.`;
}
function download(content,name,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
async function report(){
 validate(state);const rows=rowsFor(state),metadata={version:1,generated:new Date().toISOString(),dpi:72,tolerance:state.tolerance,renderer:state.old.renderer,old:{name:state.old.name,hash:state.old.hash,pages:state.old.pages.length},new:{name:state.new.name,hash:state.new.hash,pages:state.new.pages.length},provenance:state.provenance,rows:[]};
 const sections=[];
 for(let i=0;i<rows.length;i++){const r=rows[i],d=await difference(r);status(`Exporting ${i+1}/${rows.length}…`);await tick();metadata.rows.push({...r,changed:d.changed,total:d.total,sizeChanged:d.sizeChanged});
  const figures=[];for(const [name,doc,index] of [['Earlier',state.old,r.a],['Later',state.new,r.b]]){figures.push(index===null?`<figure><figcaption>${name}: no corresponding page</figcaption></figure>`:`<figure><figcaption>${name} PDF page ${index+1} · label ${esc(doc.pages[index].label)} · ${doc.pages[index].width}×${doc.pages[index].height}px</figcaption><img alt="${name} page ${index+1}" src="${doc.pages[index].image}"></figure>`);}
  sections.push(`<section id="pair-${i+1}" data-old="${r.a===null?'':r.a+1}" data-new="${r.b===null?'':r.b+1}"><h2>${esc(label(r))}</h2><p>${r.confirmed?'Reviewed':'UNREVIEWED'} · ${esc(r.reason)} · ${d.changed}/${d.total} changed pixels (${(d.ratio*100).toFixed(3)}%)${d.sizeChanged?' · PAGE SIZE CHANGED':''}</p><div class="pair">${figures.join('')}<figure><figcaption>Difference · pink = changed pixels</figcaption><img alt="Difference overlay" src="${d.image}"></figure></div></section>`);
 }
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>PDF Revision Desk report</title><style>body{font:14px system-ui;color:#183b35;margin:30px}section{border-top:2px solid #a7beb1;margin:30px 0;padding:20px 0}.pair{display:flex;align-items:start;gap:15px}figure{margin:0;flex:1;min-width:0}img{width:100%}figcaption{margin:10px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2ee;padding:20px}a{color:#235b50}@media(max-width:800px){.pair{display:block}}@media print{section{break-before:page}}</style></head><body><h1>PDF Revision Desk · comparison report</h1><p>${esc(state.old.name)} → ${esc(state.new.name)}</p><p>${rows.filter(r=>r.confirmed).length}/${rows.length} correspondences reviewed. Every source page is represented exactly once. Unmatched pages may be insertions, deletions or reflow.</p><p>Rendered with ${esc(state.old.renderer)} at 72 dpi. Maximum RGB-channel change must exceed ${state.tolerance}/255. Top-left alignment, white padding, no noise removal. This is visual comparison, not semantic or byte identity. Source hashes identify the inputs; original PDFs are not embedded. Annotations and saved form appearances may render; interactive content and hidden data are not compared.</p><nav>${rows.map((r,i)=>`<a href="#pair-${i+1}">${esc(label(r))}</a>`).join(' · ')}</nav>${sections.join('')}<details><summary>Source hashes, provenance & machine-readable review</summary><pre id="metadata">${esc(JSON.stringify(metadata,null,2))}</pre></details></body></html>`;
 download(html,'pdf-revision-report.html','text/html');status(`Exported ${rows.length} correspondences; ${rows.filter(r=>!r.confirmed).length} remain unreviewed.`);
}
$('compare').onclick=()=>run(async()=>{const a=$('old-file').files[0],b=$('new-file').files[0];if(!a||!b)throw Error('Choose both PDFs');await loadPair(a,b);});
$('demo').onclick=()=>run(async()=>{const [a,b,p]=await Promise.all(['/demo/draft.pdf','/demo/final.pdf','/demo/provenance.json'].map(async u=>{const r=await fetch(u);if(!r.ok)throw Error('Bundled demo unavailable');return u.endsWith('json')?r.json():r.blob();}));await loadPair(new File([a],'NIST-800-146-draft-2011.pdf'),new File([b],'NIST-800-146-final-2012.pdf'),p);});
$('apply').onclick=()=>run(async()=>{const r=rowsFor(state)[selected];if(r.a===null)return;assign(state,r.a,$('match').value===''?null:Number($('match').value));await save();await analyse();await display();status('Correspondence saved. Any displaced pairing is now unmatched and needs review.');});
$('confirm').onclick=()=>run(async()=>{const r=rowsFor(state)[selected];if(r.a===null)state.insertions[r.b]=true;else state.matches[r.a].confirmed=true;await save();await display();status('Review decision saved.');});
$('next').onclick=()=>run(async()=>{const rows=rowsFor(state);for(let step=1;step<=rows.length;step++){const i=(selected+step)%rows.length;if(needs(rows[i])){selected=i;break;}}await display();await save();});
$('filter').onchange=list;
$('tolerance').onchange=()=>run(async()=>{const n=Number($('tolerance').value);if(!Number.isInteger(n)||n<0||n>255){$('tolerance').value=state.tolerance;throw Error('Tolerance must be an integer from 0 to 255');}state.tolerance=n;cache.clear();state.matches.forEach(r=>r.confirmed=false);state.insertions={};await save();await analyse();await display();status('Tolerance saved; review flags reset because the evidence changed.');});
$('export').onclick=()=>run(report);
$('forget').onclick=()=>run(async()=>{await stored('delete');state=null;cache.clear();$('workspace').hidden=true;$('welcome').hidden=false;$('old-file').value='';$('new-file').value='';status('Saved comparison removed from this browser. Downloaded reports are separate.');});
for(const id of ['old-image','new-image','diff-image'])$(id).onclick=()=>{const image=$(id);const w=window.open('','_blank');if(w){w.document.title='Full-resolution page';const img=w.document.createElement('img');img.src=image.src;img.alt=image.alt;w.document.body.append(img);}};
await run(async()=>{const saved=await stored('get');if(saved?.version===1){validate(saved);state=saved;selected=saved.selected||0;$('tolerance').value=state.tolerance;await analyse();await display();status('Recovered the last comparison and review decisions from this browser.');}});
