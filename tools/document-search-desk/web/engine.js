export const LIMITS = Object.freeze({files:100, fileBytes:1048576, totalBytes:8388608, lineChars:20000, lines:20000, fileTokens:100000, totalTokens:300000, results:2000});
export const SEMANTICS = 'desk-v1: Markdown is raw source. Tokens are Unicode letters, combining marks, or numbers; NFC then locale-independent lowercase, accents retained. Term mode accepts one complete token. Phrase mode matches consecutive tokens within one line, ignoring punctuation. Literal mode is case-sensitive exact substring within one line (overlaps included). No stemming, Boolean, wildcard, regex or field syntax. LF, CRLF and CR delimit lines. Results ordered by filename (UTF-16), then line and offset. Columns and offsets are UTF-16 code units, 1-based columns, exclusive end column. UTF-8 BOM is retained as a character. Full totals are computed; at most 2000 passages are exported.';
const decoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
export const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), x=>x.toString(16).padStart(2,'0')).join('');
export const norm = s=>s.normalize('NFC').toLowerCase();
export function tokens(s) {return [...s.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map(m=>({value:norm(m[0]),start:m.index,end:m.index+m[0].length}));}
export function parseQuery(query,mode) {
 if(typeof query!=='string'||!query.trim()||query.length>500) throw Error('Enter a query of 1–500 characters.');
 if(!['term','phrase','literal'].includes(mode)) throw Error('Unsupported search mode.');
 if(/[\r\n]/.test(query)) throw Error('Queries cannot contain line breaks.');
 if(mode==='literal') return query;
 if(/["*?:()\\|+\[\]{}^~]/.test(query)||/\b(?:AND|OR|NOT|NEAR)\b/.test(query)) throw Error('Unsupported syntax. Use plain tokens, or Literal mode for punctuation/operators.');
 const ts=tokens(query).map(t=>t.value);
 if(!ts.length || (mode==='term' && (ts.length!==1 || !/^[\p{L}\p{M}\p{N}]+$/u.test(query.trim())))) throw Error('Term mode needs exactly one whole token. Choose Phrase or Literal for other text.');
 return ts;
}
export async function ingest(inputs) {
 const counts=new Map(); for(const f of inputs) counts.set(f.name,(counts.get(f.name)||0)+1);
 let used=0, tokenCount=0; const records=[];
 for(let i=0;i<inputs.length;i++) {
  const f=inputs[i], r={name:String(f.name),status:'rejected',reason:'',bytes:f.size??f.bytes?.length??0};
  records.push(r);
  if(i>=LIMITS.files){r.reason='File count limit (100)';continue;}
  if(counts.get(f.name)>1){r.reason='Duplicate filename; all duplicates rejected';continue;}
  if(!r.name||r.name.length>240||! /\.(txt|md)$/i.test(r.name)){r.reason='Expected .txt or .md filename (≤240 characters)';continue;}
  if(r.bytes>LIMITS.fileBytes){r.reason='File exceeds 1 MiB';continue;}
  if(used+r.bytes>LIMITS.totalBytes){r.reason='Collection exceeds 8 MiB';continue;}
  used+=r.bytes;
  try {
   const bytes=f.bytes??new Uint8Array(await f.arrayBuffer()); r.bytes=bytes.length; r.hash=await hash(bytes);
   let text; try{text=decoder.decode(bytes);}catch{r.reason='Malformed UTF-8';continue;}
   if(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)){r.reason='Binary/control characters';continue;}
   const lines=text.split(/\r\n|\r|\n/);
   if(lines.length>LIMITS.lines){r.reason='File exceeds 20000 lines';continue;}
   if(lines.some(l=>l.length>LIMITS.lineChars)){r.reason='Line exceeds 20000 UTF-16 units';continue;}
   const indexedTokens=[];let count=0;
   for(const line of lines){const ts=tokens(line);count+=ts.length;if(count>LIMITS.fileTokens||tokenCount+count>LIMITS.totalTokens)break;indexedTokens.push(ts);}
   if(count>LIMITS.fileTokens){r.reason='File exceeds 100000 tokens';continue;}
   if(tokenCount+count>LIMITS.totalTokens){r.reason='Collection exceeds 300000 tokens';continue;}
   tokenCount+=count;
   Object.assign(r,{status:'indexed',text,lines,tokens:indexedTokens,reason:text.length?'':'Empty document (indexed, no matches)'});
  }catch(e){r.status='failed';r.reason='Could not read file: '+e.message;}
 }
 return records;
}
export function manifest(records) {return records.map(r=>({name:r.name,hash:r.hash??null,status:r.status,bytes:r.bytes}));}
export function binding(records){return JSON.stringify(manifest(records).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0));}
export function coverage(records){return {submitted:records.length,indexed:records.filter(r=>r.status==='indexed').length,rejected:records.filter(r=>r.status==='rejected').length,failed:records.filter(r=>r.status==='failed').length};}
export function search(records,query,mode='term',file='') {
 const parsed=parseQuery(query,mode),results=[],matchingDocuments=new Set();let total=0;
 for(const r of [...records].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
  if(r.status!=='indexed'||(file&&r.name!==file))continue;
  r.lines.forEach((line,li)=>{
   const spans=[];
   if(mode==='literal'){let from=0,at;while((at=line.indexOf(parsed,from))!==-1){spans.push([at,at+parsed.length]);from=at+1;}}
   else {const ts=r.tokens[li];for(let i=0;i<=ts.length-parsed.length;i++)if(parsed.every((t,j)=>ts[i+j].value===t))spans.push([ts[i].start,ts[i+parsed.length-1].end]);}
   for(const [start,end] of spans){total++;matchingDocuments.add(r.name);if(results.length<LIMITS.results)results.push({id:JSON.stringify([r.name,r.hash,li+1,start,end]),name:r.name,hash:r.hash,line:li+1,column:start+1,endColumn:end+1,passage:line,match:line.slice(start,end)});}
  });
 }
 return {query,mode,file,semantics:SEMANTICS,coverage:coverage(records),manifest:manifest(records),total,matchingDocuments:[...matchingDocuments],truncated:total>results.length,results};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function reportHTML(report){
 const esc=escapeHTML;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Document Search Desk report</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#172b35}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4f4;padding:15px}small{overflow-wrap:anywhere}mark{background:#ffe28c}</style><h1>Document Search Desk</h1><h2>'+esc(report.query)+' · '+esc(report.mode)+'</h2><p>File filter: '+esc(report.file||'All indexed files')+'</p><p>'+esc(report.semantics)+'</p><p>Coverage: '+esc(JSON.stringify(report.coverage))+'</p><p>'+report.total+' occurrences in '+report.matchingDocuments.length+' documents. '+(report.truncated?'TRUNCATED: only first '+report.results.length+' passages included.':'All passages included.')+'</p><p>Selected: '+esc(JSON.stringify(report.selected??[]))+'</p>'+report.results.map(r=>'<article><h3>'+esc(r.name)+':'+r.line+':'+r.column+'</h3><small>SHA-256 '+esc(r.hash)+'</small><pre>'+esc(r.passage.slice(0,r.column-1))+'<mark>'+esc(r.match)+'</mark>'+esc(r.passage.slice(r.endColumn-1))+'</pre></article>').join('')+'<h2>Source manifest and complete matching-document set</h2><pre>'+esc(JSON.stringify({manifest:report.manifest,matchingDocuments:report.matchingDocuments,provenance:report.provenance??null},null,2))+'</pre></html>';
}
export function exportProject(records,saved,provenance=null){return {format:'document-search-desk-v1',semantics:SEMANTICS,manifest:manifest(records),sources:records.filter(r=>r.status==='indexed').map(r=>({name:r.name,text:r.text})),coverageRecords:records.filter(r=>r.status!=='indexed').map(({name,status,reason,bytes,hash})=>({name,status,reason,bytes,hash})),saved,provenance};}
export async function importProject(p){
 if(p?.format!=='document-search-desk-v1'||!Array.isArray(p.sources)||p.sources.length>100||!Array.isArray(p.saved)||p.saved.length>100||!Array.isArray(p.manifest)||!Array.isArray(p.coverageRecords))throw Error('Invalid project format or limits.');
 let size=0;
 const inputs=p.sources.map(s=>{if(typeof s.name!=='string'||typeof s.text!=='string')throw Error('Invalid source');const bytes=new TextEncoder().encode(s.text);size+=bytes.length;return {name:s.name,bytes};});
 if(size>LIMITS.totalBytes)throw Error('Project sources exceed 8 MiB.');
 const records=await ingest(inputs);
 for(const r of p.coverageRecords){if(typeof r.name!=='string'||!['rejected','failed'].includes(r.status)||typeof r.reason!=='string'||!Number.isSafeInteger(r.bytes)||r.bytes<0)throw Error('Invalid coverage record');records.push({name:r.name,status:r.status,reason:r.reason,bytes:r.bytes,hash:r.hash});}
 const saved=p.saved.map(s=>{if(typeof s.binding!=='string'||!Array.isArray(s.selected)||!s.selected.every(x=>typeof x==='string')||typeof s.file!=='string')throw Error('Invalid saved search');parseQuery(s.query,s.mode);return {query:s.query,mode:s.mode,file:s.file,binding:p.semantics===SEMANTICS?s.binding:'outdated semantics:'+s.binding,selected:s.selected};});
 const expected=JSON.stringify([...p.manifest].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0));
 return {records,saved,provenance:p.provenance??null,changed:binding(records)!==expected||p.semantics!==SEMANTICS};
}
