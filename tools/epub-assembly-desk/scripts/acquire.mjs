import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {JSDOM} from 'jsdom';
import Turndown from 'turndown';
const base='https://www.gutenberg.org/files/28885/28885-h/';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const get=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`${r.status}: ${url}`);return Buffer.from(await r.arrayBuffer());};
const offline=!process.argv.includes('--download');
await fs.mkdir('demo/source',{recursive:true});await fs.mkdir('demo/manuscript/images',{recursive:true});
const records=[];
async function source(name,url){const path=`demo/source/${name}`;const b=offline?await fs.readFile(path):await get(url);if(!offline)await fs.writeFile(path,b);records.push({path,url,sha256:sha(b),bytes:b.length});return b;}
const raw=await source('28885-h.htm',base+'28885-h.htm');
await source('catalog.html','https://www.gutenberg.org/ebooks/28885');
const html=raw.toString(), normalize=s=>s.replace(/\s+/g,' ').trim();
const td=new Turndown({headingStyle:'atx',codeBlockStyle:'fenced',emDelimiter:'*'});
td.addRule('layout',{filter:['table','tbody','tr','td','div','span'],replacement:(s,node)=>['div','tr'].includes(node.nodeName.toLowerCase())?'\n\n'+s+'\n\n':s+' '});
const chapters=[];
async function chapter(name,doc){
 const d=doc.window.document;
 // Text oracle comes from the transformed source DOM, before Markdown conversion.
 const oracle=d.body.cloneNode(true); for(const n of oracle.querySelectorAll('p,h1,h2,h3,div,tr,pre,br')){n.before(d.createTextNode(' '));n.after(d.createTextNode(' '));} const text=normalize(oracle.textContent);
 const images=[...d.querySelectorAll('img')].map(n=>({path:n.getAttribute('src'),alt:n.alt}));
 const links=[...d.querySelectorAll('a[href]')].map(n=>n.getAttribute('href'));
 const md=td.turndown(d.body).replace(/\n{3,}/g,'\n\n').replace(/\{#Page\\_(\d+)\}/g,'{#Page_$1}')+'\n';
 await fs.writeFile('demo/manuscript/'+name,md);
 chapters.push({path:name,text,images,links});
}
const titles=['Down the Rabbit-hole','The Pool of Tears','A Caucus-race and a Long Tale'];
const pages=[1,13,24,35];
const contents=new JSDOM('<body><h1>Contents</h1><p>Chapters I–III of Alice’s Adventures in Wonderland. Lewis Carroll, illustrated by Arthur Rackham.</p></body>');
for(let i=0;i<3;i++){
 const p=contents.window.document.createElement('p');const a=contents.window.document.createElement('a');a.href=`chapter-${i+1}.md#Page_${pages[i]}`;a.textContent=titles[i];p.append(a);contents.window.document.body.append(p);
}
await chapter('contents.md',contents);
for(let i=0;i<3;i++){
 const start=html.indexOf(`<div class='chapter'>CHAPTER ${['I','II','III'][i]}</div>`);
 const end=html.indexOf(`<a name="Page_${pages[i+1]}"`);
 const doc=new JSDOM('<body>'+html.slice(start,end).replace(/<hr[^>]*>\s*<p><span class='pagenum'>\s*$/,'')+'</body>');
 const d=doc.window.document;
 for(const n of d.querySelectorAll('.pagenum,.sidenote'))n.remove();
 const heading=d.querySelector('.chapter');const h=d.createElement('h1');h.textContent=`Chapter ${['I','II','III'][i]} — ${titles[i]} {#Page_${pages[i]}}`;heading.replaceWith(h);
 // Restore decorative drop capitals as actual text, so reading order remains intelligible.
 const first=d.querySelector('.figleft img');if(first&&first.alt.length<4){const next=first.parentElement.nextElementSibling;next.prepend(first.alt);first.parentElement.remove();}
 // Flatten print-only layout. Whitespace in source HTML separates words.
 for(const el of d.querySelectorAll('br'))el.replaceWith(d.createTextNode(' '));
 for(const n of d.querySelectorAll('a:not([href])'))n.replaceWith(...n.childNodes);
 await chapter(`chapter-${i+1}.md`,doc);
 chapters.at(-1).text=chapters.at(-1).text.replace(` {#Page_${pages[i]}}`,'');
}
const licenseStart=html.indexOf('*** END OF');
const licenseDoc=new JSDOM('<body><h1>Project Gutenberg license and source notice</h1><pre><code></code></pre></body>');
const original=new JSDOM(html);
const textAll=original.window.document.body.textContent;
const end=textAll.indexOf('*** END OF');
const notice=textAll.slice(end);
licenseDoc.window.document.querySelector('code').textContent=notice;
await chapter('license.md',licenseDoc);
const imgs=[...new Set(chapters.flatMap(c=>c.images.map(i=>i.path)))];
for(const path of imgs){const b=await source(path.replaceAll('/','_'),base+path);await fs.writeFile('demo/manuscript/'+path,b);}
const files=[];
for(const path of [...chapters.map(c=>c.path),...imgs]){const b=await fs.readFile('demo/manuscript/'+path);files.push({path,sha256:sha(b),bytes:b.length});}
const manifest={work:'Alice’s Adventures in Wonderland, chapters I–III (bounded excerpt)',author:'Lewis Carroll',illustrator:'Arthur Rackham',catalog:'https://www.gutenberg.org/ebooks/28885',sourceRevision:'Project Gutenberg #28885; catalog last updated 2021-01-05; byte revision identified by SHA-256',rights:'Public domain in the USA (catalog evidence retained). Project Gutenberg license retained in source and EPUB. Other jurisdictions require local assessment.',conversion:'HTML to Markdown via Turndown 7.2.0. Select chapters I–III and original contents destinations; insert excerpt label. Remove print page numbers and running side notes; restore drop-cap text from image alt. Flatten layout tables, whitespace, line breaks and CSS, including decorative background art; retain all inline narrative illustrations in selection. Heading IDs preserve original chapter page targets. License is verbatim text in a fenced block. This is a reflowable excerpt, not a facsimile or full book.',acquisition:'node scripts/acquire.mjs --download (network); node scripts/acquire.mjs (rebuild from retained bytes)',sources:records,files,chapters};
if(offline&&!process.argv.includes('--record')){const prior=JSON.parse(await fs.readFile('demo/provenance.json'));if(JSON.stringify(prior)!==JSON.stringify(manifest))throw Error('Reproduction differs from pinned provenance');}
else await fs.writeFile('demo/provenance.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Reproduced ${chapters.length} sections and ${imgs.length} illustrations; ${files.length} input hashes.`);
