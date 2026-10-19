export const SETTINGS={dpi:72,tolerance:20,maxBytes:16*1024*1024,maxPages:100,maxPixels:2000000,maxTotalPixels:120000000};
export function tokens(text) {const w=text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]; return new Set(w.map((v,i)=>v+' '+(w[i+1]||'')));}
function dice(a,b){if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return 2*n/(a.size+b.size);}
export function similarity(a,b){
 if((a.ink<.001)!==(b.ink<.001))return 0;
 const text=dice(tokens(a.text),tokens(b.text));
 let distance=0;for(let i=0;i<a.fingerprint.length;i++)distance+=Math.abs(a.fingerprint[i]-b.fingerprint[i])/255;
 const visual=1-distance/a.fingerprint.length;
 return a.text.trim().length>30&&b.text.trim().length>30?text*.9+visual*.1:visual;
}
export function suggest(oldPages,newPages){
 const scores=oldPages.map(a=>newPages.map(b=>similarity(a,b)));
 const ranked=scores.map(row=>row.map((score,b)=>({b,score})).sort((a,b)=>b.score-a.score));
 const reverse=newPages.map((_,b)=>scores.map((r,a)=>({a,score:r[b]})).sort((a,b)=>b.score-a.score));
 return oldPages.map((a,i)=>{
  const [best,second]=ranked[i];
  const margin=best.score-(second?.score||0);
  const rev=reverse[best.b];
  const blank=a.ink<.001||newPages[best.b].ink<.001;
  const mutual=rev[0].a===i&&rev[0].score-(rev[1]?.score||0)>.035;
  const confident=!blank&&best.score>=.60&&margin>.035&&mutual;
  return {a:i,b:confident?best.b:null,confirmed:false,reason:blank?'Blank or almost blank: manual decision required':confident?'Mutual best suggestion; not yet reviewed':best.score<.60?'Low similarity: possible deletion or reflow':'Ambiguous candidates: manual decision required',candidates:ranked[i].slice(0,4),score:best.score};
 });
}
export function rowsFor(state){const used=new Set(state.matches.filter(r=>r.b!==null).map(r=>r.b));return [...state.matches,...state.new.pages.map((_,b)=>({a:null,b,confirmed:!!state.insertions?.[b],reason:'Unmatched new page: possible insertion'})).filter(r=>!used.has(r.b))];}
export function validate(state){
 if(state.matches.length!==state.old.pages.length)throw Error('Old page accounting failed');
 const used=new Set();state.matches.forEach((r,i)=>{if(r.a!==i||r.b!==null&&(!Number.isInteger(r.b)||r.b<0||r.b>=state.new.pages.length||used.has(r.b)))throw Error('Invalid or repeated correspondence');if(r.b!==null)used.add(r.b);});
 return true;
}
export function assign(state,a,b){
 if(b!==null){const other=state.matches.find(r=>r.b===b&&r.a!==a);if(other){other.b=null;other.confirmed=false;other.reason='Released by manual reassignment; review required';}delete state.insertions[b];}
 Object.assign(state.matches[a],{b,confirmed:true,reason:b===null?'Manually marked unmatched / deleted':'Manually matched'});validate(state);
}
export function pixelDiff(a,b,tolerance=20){
 if(!Number.isInteger(tolerance)||tolerance<0||tolerance>255)throw Error('Tolerance must be 0–255');
 const width=Math.max(a?.width||0,b?.width||0),height=Math.max(a?.height||0,b?.height||0),data=new Uint8ClampedArray(width*height*4);
 let changed=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const ai=a&&x<a.width&&y<a.height?(y*a.width+x)*4:-1,bi=b&&x<b.width&&y<b.height?(y*b.width+x)*4:-1;
  let delta=0,gray=0;for(let c=0;c<3;c++){const av=ai<0?255:a.data[ai+c],bv=bi<0?255:b.data[bi+c];delta=Math.max(delta,Math.abs(av-bv));gray+=bv;}
  const i=(y*width+x)*4,diff=delta>tolerance;if(diff)changed++;
  const v=Math.round(190+gray/3*65/255);data.set(diff?[220,20,90,255]:[v,v,v,255],i);
 }
 return {width,height,data,changed,total:width*height,ratio:changed/(width*height),sizeChanged:!!a&&!!b&&(a.width!==b.width||a.height!==b.height)};
}
export function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
