// Independent renderer and independently implemented pixel comparison. Does not import app code.
import mupdf from 'mupdf';
process.env.RAYON_NUM_THREADS ||= '2';process.env.TOKIO_WORKER_THREADS ||= '2';
const {createCanvas,loadImage}=await import('@napi-rs/canvas');import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const provenance=await readJSON('demo/provenance.json');
for(const d of provenance.documents)assert.equal(createHash('sha256').update(await readFile('demo/'+d.file)).digest('hex'),d.sha256);
const open=async p=>mupdf.Document.openDocument(await readFile(p),'application/pdf');
const real=[await open('demo/draft.pdf'),await open('demo/final.pdf')],controlled=[await open('tests/fixtures/old.pdf'),await open('tests/fixtures/new.pdf')];
const text=(d,n)=>d.loadPage(n-1).toStructuredText().asText().replace(/\s+/g,' ');
function render(d,n){const p=d.loadPage(n-1),pix=p.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,true);const result={width:pix.getWidth(),height:pix.getHeight(),components:pix.getNumberOfComponents(),pixels:Uint8Array.from(pix.getPixels()),png:pix.asPNG().slice()};pix.destroy();p.destroy();return result;}
function count(a,b,roi=null){const w=Math.max(a.width,b.width),h=Math.max(a.height,b.height);let changed=0;
 for(let y=roi?.[1]||0;y<(roi?.[3]||h);y++)for(let x=roi?.[0]||0;x<(roi?.[2]||w);x++){
 const av=x<a.width&&y<a.height?(y*a.width+x)*a.components:-1,bv=x<b.width&&y<b.height?(y*b.width+x)*b.components:-1;
 let different=false;for(let k=0;k<3;k++)if(Math.abs((av<0?255:a.pixels[av+k])-(bv<0?255:b.pixels[bv+k]))>20)different=true;if(different)changed++;
 }return changed;}
async function sourceRMSE(independent,browser){
 assert.equal(independent.width,browser.width);assert.equal(independent.height,browser.height);
 const image=await loadImage(browser.image),c=createCanvas(browser.width,browser.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const px=ctx.getImageData(0,0,c.width,c.height).data;
 let sum=0;for(let i=0;i<c.width*c.height;i++)for(let k=0;k<3;k++)sum+=(px[i*4+k]-independent.pixels[i*independent.components+k])**2;
 const raw=Math.sqrt(sum/(c.width*c.height*3));let blockSum=0,blocks=0;
 for(let y=0;y<c.height;y+=2)for(let x=0;x<c.width;x+=2)for(let k=0;k<3;k++){let a=0,b=0,n=0;for(let dy=0;dy<2&&y+dy<c.height;dy++)for(let dx=0;dx<2&&x+dx<c.width;dx++){const i=(y+dy)*c.width+x+dx;a+=px[i*4+k];b+=independent.pixels[i*independent.components+k];n++;}blockSum+=((a-b)/n)**2;blocks++;}
 const block2x2=Math.sqrt(blockSum/blocks);return {raw,block2x2,rawBelow25:raw<25,blockBelow12:block2x2<12};
}

const cs=await readJSON('/tmp/pdf-revision-artifacts/controlled-state.json'),rs=await readJSON('/tmp/pdf-revision-artifacts/real-state.json');
const expected=await readJSON('tests/fixtures/expected.json'),checks=[];
for(const pair of expected.pairs){const a=render(controlled[0],pair.old),b=render(controlled[1],pair.new),n=count(a,b,pair.roi);if(pair.change==='none')assert.equal(n,0);else if(pair.change==='page size')assert.notEqual(a.width,b.width);else assert.ok(n>30,`${pair.change} undetected`);checks.push({...pair,independentChangedPixelsInROI:n,oldRMSE:await sourceRMSE(a,cs.old.pages[pair.old-1]),newRMSE:await sourceRMSE(b,cs.new.pages[pair.new-1])});}
for(const check of checks){assert.ok(check.oldRMSE.rawBelow25);assert.ok(check.newRMSE.rawBelow25);}
assert.match(text(controlled[0],3),/DELETION/);assert.match(text(controlled[1],3),/INSERTION/);assert.equal(cs.matches[2].b,null);
assert.equal(count(render(controlled[0],5),render(controlled[0],6)),0);assert.equal(count(render(controlled[1],5),render(controlled[1],6)),0);
for(const i of [4,5,6])assert.equal(cs.matches[i].b,null);
const realExamples=[{old:4,new:2,oldText:'Gary Locke',newText:'John Bryson',description:'Title-page date and Secretary changed from May 2011 / Gary Locke to May 2012 / John Bryson.'},{old:13,new:11,oldText:'This document presents what is known',newText:'system and network administrators',description:'Purpose wording shortened; audience expanded to system and network administrators.'},{old:15,new:13,oldText:'personal digital assistants',newText:'tablets',description:'Cloud definition examples changed from PDAs to tablets and workstations; final adds footnotes.'}];
for(const pair of realExamples){assert.ok(text(real[0],pair.old).includes(pair.oldText));assert.ok(text(real[1],pair.new).includes(pair.newText));assert.ok(!text(real[1],pair.new).includes(pair.oldText));const a=render(real[0],pair.old),b=render(real[1],pair.new);const n=count(a,b);assert.ok(n>100);pair.independentChangedPixels=n;pair.oldRMSE=await sourceRMSE(a,rs.old.pages[pair.old-1]);pair.newRMSE=await sourceRMSE(b,rs.new.pages[pair.new-1]);
 if(pair.old===4){const c=createCanvas(a.width+b.width,Math.max(a.height,b.height)),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(await loadImage(a.png),0,0);ctx.drawImage(await loadImage(b.png),a.width,0);await writeFile('results/independent-title-pages.png',c.toBuffer('image/png'));}
}
for(const [i,d] of real.entries()){assert.equal(d.countPages(),i?81:86);assert.match(text(d,i?11:13),/not subject to copyright/);}
// Validate the actual standalone overlay PNGs and counts using a separate implementation.
async function rgba(url){const im=await loadImage(url),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};}
async function verifyOverlays(path,metaPath,state){
 const html=await readFile(path,'utf8'),meta=await readJSON(metaPath),sections=[...html.matchAll(/<section id="pair-[\s\S]*?<\/section>/g)].map(m=>m[0]);assert.equal(sections.length,meta.rows.length);let checked=0;
 for(let n=0;n<sections.length;n++){
  const r=meta.rows[n],sources=[...sections[n].matchAll(/src="(data:image\/png;base64,[^"]+)"/g)].map(m=>m[1]);
  const a=r.a===null?null:await rgba(state.old.pages[r.a].image),b=r.b===null?null:await rgba(state.new.pages[r.b].image),overlay=await rgba(sources.at(-1));
  assert.equal(overlay.width,Math.max(a?.width||0,b?.width||0));assert.equal(overlay.height,Math.max(a?.height||0,b?.height||0));let count=0;
  for(let y=0;y<overlay.height;y++)for(let x=0;x<overlay.width;x++){
   const oa=a&&x<a.width&&y<a.height?(y*a.width+x)*4:-1,ob=b&&x<b.width&&y<b.height?(y*b.width+x)*4:-1;
   const left=[0,1,2].map(k=>oa<0?255:a.data[oa+k]),right=[0,1,2].map(k=>ob<0?255:b.data[ob+k]);
   const changed=left.some((v,k)=>Math.abs(v-right[k])>meta.tolerance);if(changed)count++;
   const gray=Math.round(190+(right[0]+right[1]+right[2])/3*65/255),expected=changed?[220,20,90]:[gray,gray,gray],o=(y*overlay.width+x)*4;
   for(let k=0;k<3;k++)if(overlay.data[o+k]!==expected[k])throw Error(`Overlay mismatch in ${path}, row ${n+1}, pixel ${x},${y}`);
  }
  assert.equal(r.changed,count);assert.equal(r.total,overlay.width*overlay.height);checked++;
 }
 return checked;
}
const controlledMetadata=await readJSON('results/controlled-browser.json');
for(const p of expected.pairs){const r=controlledMetadata.rows.find(r=>r.a===p.old-1&&r.b===p.new-1);assert.ok(r,`Controlled ${p.change} pair must be present in report`);if(p.change==='none')assert.equal(r.changed,0);else if(p.change==='page size')assert.equal(r.sizeChanged,true);else assert.ok(r.changed>30);}
const overlayRows={controlled:await verifyOverlays('/tmp/pdf-revision-artifacts/controlled.html','results/controlled-browser.json',cs),real:await verifyOverlays('/tmp/pdf-revision-artifacts/real-report.html','results/real-browser.json',rs)};
const result={renderer:'MuPDF 1.28.1 (npm package)',dpi:72,tolerance:20,exportedOverlayRowsVerified:overlayRows,controlled:checks,ambiguity:'Repeated pages are pixel-identical in MuPDF and left unresolved by the app; blank pages also remain unresolved.',insertDelete:'Injected old page 3 deletion and new page 3 insertion verified by MuPDF text and browser mapping.',real:realExamples,limitations:['Representative real differences, not an exhaustive semantic audit.','Cross-renderer agreement checks FAILED for a NIST body page: raw RMSE 26.433 exceeded 25; 2x2 block-averaged RMSE 14.666 exceeded 12. Neither threshold is relaxed. Real-page metrics are reported as diagnostics, not a passed pixel-equivalence check. Independent visual inspection found matching content/layout but speckled PDF.js draft glyphs. Real difference evidence relies on separate MuPDF text/render inspection, not cross-renderer pixel equivalence. Controlled fixtures still require raw RMSE <25.','All fixture edits are injected; genuine NIST PDFs are unchanged.']};await writeFile('results/oracle-checks.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
