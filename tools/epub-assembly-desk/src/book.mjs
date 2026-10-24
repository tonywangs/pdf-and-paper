import MarkdownIt from 'markdown-it';
import JSZip from 'jszip';
import crypto from 'node:crypto';
import path from 'node:path';
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif'};
const md=new MarkdownIt('commonmark',{html:true,xhtmlOut:true});
const fail=msg=>{throw Error(msg);};
export function validPath(p){return typeof p==='string'&&p.length<240&&!p.split('/').some(s=>!s||s==='.'||s==='..')&&!/[\\\x00-\x1f:#?%]/.test(p)&&!p.startsWith('/');}
export function inspect(project){
 if(project?.version!==1)fail('Unsupported project version');
 if(!Array.isArray(project.files)||project.files.length<1||project.files.length>200)fail('Import 1–200 files');
 const files=new Map();let total=0;
 for(const f of project.files){
  if(!validPath(f.path)||files.has(f.path))fail(`Invalid or duplicate path: ${f.path}`);
  if(typeof f.data!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))fail(`Invalid base64: ${f.path}`);
  const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
  if(bytes.length>8*1024*1024||total>20*1024*1024)fail('Limit: 8 MiB per file, 20 MiB total');
  if(f.sha256!==hash(bytes))fail(`Source changed or corrupt: ${f.path}`);
  const ext=path.posix.extname(f.path).toLowerCase();
  if(ext!=='.md'&&!mime[ext])fail(`Unsupported input: ${f.path}. Import only .md, PNG, JPEG or GIF.`);
  if(mime[ext]){
   const good=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.gif'?/^GIF8[79]a/.test(bytes.toString('ascii',0,6)):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
   if(!good)fail(`Image format does not match extension: ${f.path}`);
  }
  files.set(f.path,{...f,bytes,ext});
 }
 const order=project.order,chapters=[...files.values()].filter(f=>f.ext==='.md');
 if(!Array.isArray(order)||order.length!==chapters.length||new Set(order).size!==order.length||order.some(p=>files.get(p)?.ext!=='.md')||!order.length)fail('Chapter order must contain every Markdown file exactly once');
 const metadata=project.metadata;
 if(!metadata||['title','author','language'].some(k=>typeof metadata[k]!=='string'||!metadata[k].trim()||metadata[k].length>300||/[\x00-\x1f]/.test(metadata[k])))fail('Title, author and language are required (up to 300 characters)');
 try{Intl.getCanonicalLocales(metadata.language);}catch{fail('Language must be a valid BCP 47 tag, for example en or zh-Hant');}
 const warnings=[],used=new Set();
 const parsed=order.map((p,i)=>{
  const source=new TextDecoder('utf-8',{fatal:true}).decode(files.get(p).bytes);
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source))fail(`Invalid XML control character in ${p}`);
  const environment={};
  const tokens=md.parse(source,environment),ids=new Set();let title=p;
  if(Object.keys(environment.references||{}).some(label=>label.startsWith('^')))fail(`Unsupported footnote definition in ${p}`);
  // Reference definitions can be consumed without producing inline tokens.
  // Inspect source outside code blocks so unsupported footnotes cannot disappear.
  const prose=source.split('\n');
  for(const t of tokens)if(['fence','code_block'].includes(t.type)&&t.map)for(let line=t.map[0];line<t.map[1];line++)prose[line]='';
  const nonCode=prose.join('\n');
  if(/^\s*(?:>\s*)*\[\^[^\]]+\]:/m.test(nonCode))fail(`Unsupported footnote definition in ${p}`);
  if(/^---\s*\n[\s\S]*?^\w[\w-]*:\s[\s\S]*?^---\s*$/m.test(nonCode))fail(`Unsupported YAML front matter in ${p}`);
  const walk=ts=>{for(const t of ts){if(t.type.startsWith('html_'))fail(`Raw HTML is unsupported: ${p}`);if(t.children)walk(t.children);}};walk(tokens);
  // Known extensions are rejected outside code blocks, rather than silently flattened.
  for(const t of tokens.filter(t=>t.type==='inline'))if(/\[\^|\{[%{]|\$\$|~~|(^|\n)\s*\||\n\s*:?-{3,}:?\s*\||!\[\[/.test(t.content))fail(`Unsupported Markdown extension in ${p}: tables, footnotes, templates, math or wiki syntax`);
  for(const t of tokens.filter(t=>t.type==='inline'))for(const child of t.children||[])if(child.type==='text'){
   if(/\[[ xX]\]|\$[^$\n]+\$|\[[^\]]+\]\s*[\[(]|!\[|^:\s/m.test(child.content))warnings.push(`Possible unsupported or unresolved Markdown is rendered literally in ${p}: ${child.content.slice(0,100)}`);
  }
  for(let j=0;j<tokens.length;j++)if(tokens[j].type==='heading_open'){
   const inline=tokens[j+1];let explicit;const match=inline.content.match(/\s+\{#([A-Za-z][A-Za-z0-9_.:-]*)\}$/);
   if(match){explicit=match[1];inline.content=inline.content.slice(0,match.index);inline.children=md.parseInline(inline.content,{})[0].children;}
   const plain=inline.children.filter(t=>['text','code_inline'].includes(t.type)).map(t=>t.content).join('');
   const root=explicit||plain.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,'').trim().replace(/\s+/g,'-')||'section';
   let id=root,n=2;if(explicit&&ids.has(id))fail(`Duplicate explicit heading ID ${id} in ${p}`);while(ids.has(id))id=`${root}-${n++}`;ids.add(id);tokens[j].attrSet('id',id);if(title===p)title=plain;
  }
  return {path:p,index:i,href:`c${i}.xhtml`,tokens,ids,title};
 });
 const byPath=new Map(parsed.map(c=>[c.path,c]));
 const assets=[...files.values()].filter(f=>f.ext!=='.md').map((f,i)=>({...f,href:`assets/a${i}${f.ext}`,media:mime[f.ext]}));
 const byAsset=new Map(assets.map(a=>[a.path,a]));
 const resolve=(raw,chapter,isImage)=>{
  if(/^(https?:|mailto:)/i.test(raw)&&!isImage){warnings.push(`External link requires a reader/network: ${raw}`);return raw;}
  if(/^[a-z][a-z0-9+.-]*:|^\/\//i.test(raw))fail(`Unsupported URL: ${raw} in ${chapter.path}`);
  let decoded;try{decoded=decodeURIComponent(raw);}catch{fail(`Invalid URL encoding: ${raw}`);}
  const [file,frag,...extra]=decoded.split('#');if(extra.length||file.includes('?')||file.startsWith('/')||file.includes('\\'))fail(`Unsupported target: ${raw}`);
  const target=file?path.posix.normalize(path.posix.join(path.posix.dirname(chapter.path),file)):chapter.path;
  if(isImage){const asset=byAsset.get(target);if(!asset||frag!==undefined)fail(`Missing or unsupported image ${raw} in ${chapter.path}`);used.add(target);return asset.href;}
  const dest=byPath.get(target);if(!dest)fail(`Unresolved chapter link ${raw} in ${chapter.path}`);
  if(frag&&!dest.ids.has(frag))fail(`Unresolved heading ${raw} in ${chapter.path}`);
  return dest.href+(frag?'#'+encodeURIComponent(frag):'');
 };
 for(const c of parsed){
  const walk=ts=>{for(const t of ts){if(t.type==='image'){const raw=t.attrGet('src');if(!t.content.trim())warnings.push(`Image has empty alternative text: ${c.path}: ${raw}`);t.attrSet('src',resolve(raw,c,true));}if(t.type==='link_open')t.attrSet('href',resolve(t.attrGet('href'),c,false));if(t.children)walk(t.children);}};walk(c.tokens);
  c.body=md.renderer.render(c.tokens,md.options,{});
 }
 for(const a of assets)if(!used.has(a.path))warnings.push(`Unused asset included in EPUB: ${a.path}`);
 return {metadata,chapters:parsed,assets,warnings:[...new Set(warnings)],fileCount:files.size,bytes:total};
}
const style='body{font-family:serif;line-height:1.6;margin:5%;overflow-wrap:break-word}img{max-width:100%;height:auto}pre{white-space:pre-wrap}h1,h2,h3{line-height:1.2}a{color:#135c56}';
const document=(title,lang,body)=>`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escape(lang)}" xml:lang="${escape(lang)}"><head><title>${escape(title)}</title><link rel="stylesheet" type="text/css" href="book.css"/></head><body>${body}</body></html>`;
export async function epub(project){
 const book=inspect(project),{metadata:m,chapters,assets}=book,zip=new JSZip();
 zip.file('mimetype','application/epub+zip',{compression:'STORE'});
 zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
 zip.file('EPUB/book.css',style);
 for(const c of chapters)zip.file('EPUB/'+c.href,document(c.title,m.language,c.body));
 for(const a of assets)zip.file('EPUB/'+a.href,a.bytes);
 zip.file('EPUB/nav.xhtml',document('Contents',m.language,`<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map(c=>`<li><a href="${c.href}">${escape(c.title)}</a></li>`).join('')}</ol></nav>`));
 const identifier='urn:sha256:'+hash(JSON.stringify(project));
 zip.file('EPUB/package.opf',`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escape(m.language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${escape(m.title)}</dc:title><dc:creator>${escape(m.author)}</dc:creator><dc:language>${escape(m.language)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/>${chapters.map(c=>`<item id="c${c.index}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('')}${assets.map((a,i)=>`<item id="a${i}" href="${a.href}" media-type="${a.media}"/>`).join('')}</manifest><spine>${chapters.map(c=>`<itemref idref="c${c.index}"/>`).join('')}</spine></package>`);
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
}
export function preview(project){
 const b=inspect(project);
 let html=b.chapters.map(c=>`<section id="section-${c.index}">${c.body.replace(/id="([^"]+)"/g,(_,id)=>`id="section-${c.index}--${id}"`).replace(/href="c(\d+)\.xhtml(?:#([^"]*))?"/g,(_,n,id)=>`href="#section-${n}${id?'--'+escape(decodeURIComponent(id)):''}"`).replace(/src="(assets\/[^"]+)"/g,(_,p)=>{const a=b.assets.find(a=>a.href===p);return `src="data:${a.media};base64,${a.data}"`;})}</section>`).join('<hr/>');
 return {html:`<!doctype html><html lang="${escape(b.metadata.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${style}section{margin-bottom:4rem}</style><title>Book preview</title></head><body>${html}</body></html>`,chapters:b.chapters.map(c=>({path:c.path,title:c.title,index:c.index})),warnings:b.warnings,fileCount:b.fileCount,bytes:b.bytes};
}
