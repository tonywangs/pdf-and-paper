export const LIMITS={file:10*1024*1024,total:40*1024*1024,pages:200,output:300};
export async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function inspect(bytes,name,lib){
 if(bytes.length>LIMITS.file)throw Error('PDF exceeds 10 MiB');
 const pdf=await lib.PDFDocument.load(bytes,{updateMetadata:false});
 if(pdf.getPageCount()>LIMITS.pages)throw Error('PDF exceeds 200 pages');
 const warnings=['Document metadata, outlines, attachments, tags and document actions are not copied.'];
 if(pdf.catalog.has(lib.PDFName.of('AcroForm')))throw Error('Interactive forms are unsupported; flatten them in a trusted PDF editor first.');
 for(const p of pdf.getPages()){
 const annots=p.node.Annots(); if(annots){for(let i=0;i<annots.size();i++){const a=pdf.context.lookup(annots.get(i));if(a.get(lib.PDFName.of('Subtype'))?.toString()!=='/Link')throw Error('Non-link annotations are unsupported; flatten them first.');} if(!warnings.includes('Links are omitted from exported pages.'))warnings.push('Links are omitted from exported pages.');}
 if(p.node.has(lib.PDFName.of('UserUnit')))throw Error('Custom UserUnit pages are unsupported.');
 if(p.getRotation().angle%90)throw Error('Non-quarter-turn source rotation is unsupported.');
 }
 return {id:await hash(bytes),name,bytes,pdf,warnings,pages:pdf.getPages().map(p=>({media:p.getMediaBox(),crop:p.getCropBox(),rotation:p.getRotation().angle}))};
}
export function plan(sources,pages){return {format:'pdf-desk',version:1,sources:sources.map(({id,name,pages})=>({id,name,pageCount:pages.length})),pages:pages.map(p=>({...p}))}}
export function validatePlan(p){
 if(p?.format!=='pdf-desk'||p.version!==1||!Array.isArray(p.sources)||!Array.isArray(p.pages)||p.pages.length>LIMITS.output||p.sources.length>100)throw Error('Invalid or oversized project');
 const ids=new Set();for(const s of p.sources){if(!/^[a-f0-9]{64}$/.test(s.id)||ids.has(s.id)||typeof s.name!=='string'||s.name.length>500||!Number.isInteger(s.pageCount)||s.pageCount<1||s.pageCount>LIMITS.pages)throw Error('Invalid project source');ids.add(s.id)}
 for(const v of p.pages){const s=p.sources.find(s=>s.id===v.source);if(!s||!Number.isInteger(v.page)||v.page<1||v.page>s.pageCount||![0,90,180,270].includes(v.rotation))throw Error('Invalid project page');}return p;
}
export async function assemble(p,sources,lib){validatePlan(p);if(!p.pages.length)throw Error('Select at least one page');
 const byId=new Map(sources.map(s=>[s.id,s]));for(const ref of p.sources){const s=byId.get(ref.id);if(!s||await hash(s.bytes)!==ref.id||s.pages.length!==ref.pageCount)throw Error('Missing or changed source: '+ref.name)}
 const out=await lib.PDFDocument.create();const mapping=[];
 for(const [i,v] of p.pages.entries()){const s=byId.get(v.source);const [page]=await out.copyPages(s.pdf,[v.page-1]);page.setRotation(lib.degrees((s.pages[v.page-1].rotation+v.rotation)%360));page.node.delete(lib.PDFName.of('Annots'));out.addPage(page);mapping.push({outputPage:i+1,sourceSha256:s.id,sourceName:s.name,sourcePage:v.page,addedRotation:v.rotation,rotation:page.getRotation().angle,mediaBox:page.getMediaBox(),cropBox:page.getCropBox()});}
 out.setProducer('PDF Page Assembly Desk');out.setCreator('PDF Page Assembly Desk');const bytes=await out.save();return {bytes,manifest:{format:'pdf-desk-manifest',version:1,outputSha256:await hash(bytes),pages:mapping}};
}
