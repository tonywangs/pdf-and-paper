export function validateProject(p) {
 if (!p || p.version!==1 || typeof p.title!=='string' || !Array.isArray(p.pages) || !p.pages.length || p.pages.length>50) throw Error('Invalid project: expected version 1 and 1–50 pages');
 for(const page of p.pages){
  if(typeof page.label!=='string'||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(page.image)||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||!Array.isArray(page.regions)) throw Error('Invalid page');
  const ids=new Set();
  for(const r of page.regions){
   if(typeof r.id!=='string'||ids.has(r.id)||typeof r.original!=='string'||typeof r.corrected!=='string'||!r.bbox) throw Error('Invalid region');
   ids.add(r.id);
   const {x0,y0,x1,y1}=r.bbox;
   if(![x0,y0,x1,y1].every(Number.isFinite)||x0<0||y0<0||x1<x0||y1<y0||x1>page.width||y1>page.height) throw Error('Invalid region bounds');
  }
 }
 return p;
}
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function exportText(p){return p.pages.map(page=>`[${page.label}]\n${page.regions.map(r=>r.corrected).join('\n')}`).join('\n\n')+'\n';}
export function exportHTML(p){
 const e=escapeHTML;
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(p.title)}</title><style>body{font:18px Georgia;margin:2rem auto;max-width:1200px;padding:1rem;background:#faf8f2}section{margin:3rem 0}.spread{display:grid;grid-template-columns:1fr 1fr;gap:2rem}img{width:100%}pre{white-space:pre-wrap;font:inherit}a{color:#236452}@media(max-width:700px){.spread{display:block}}</style><h1>${e(p.title)}</h1><p>Corrected transcription. Page images are embedded; links beside each line point to its source region.</p><nav>${p.pages.map((x,i)=>`<a href="#p${i}">${e(x.label)}</a>`).join(' · ')}</nav>${p.pages.map((page,i)=>`<section id="p${i}"><h2>${e(page.label)}</h2><div class="spread"><div><svg viewBox="0 0 ${page.width} ${page.height}" xmlns="http://www.w3.org/2000/svg"><style>rect{fill:transparent;stroke:transparent}g:target rect{stroke:#d95b21;stroke-width:5;fill:#ffd68844}</style><image href="${page.image}" width="${page.width}" height="${page.height}"/>${page.regions.map((r,j)=>`<g id="p${i}r${j}"><rect x="${r.bbox.x0}" y="${r.bbox.y0}" width="${r.bbox.x1-r.bbox.x0}" height="${r.bbox.y1-r.bbox.y0}"/></g>`).join('')}</svg></div><div>${page.regions.map((r,j)=>`<div><a href="#p${i}r${j}" aria-label="Source region ${j+1}">↗ ${j+1}</a><pre>${e(r.corrected)}</pre></div>`).join('')}</div></div></section>`).join('')}</html>`;
}
