import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const entries=JSON.parse(await fs.readFile(new URL('../fixtures/sources.json',import.meta.url)));
for(const s of entries){const res=await fetch(s.url);if(!res.ok)throw Error('Download failed '+res.status);const b=Buffer.from(await res.arrayBuffer());if(b.length>10*1024*1024)throw Error('Oversize source');const h=createHash('sha256').update(b).digest('hex');if(h!==s.sha256)throw Error('Upstream source changed: '+s.file+'; expected '+s.sha256+', got '+h+'. Existing fixture retained.');await fs.writeFile(new URL('../fixtures/'+s.file,import.meta.url),b);console.log('Verified '+s.file+' '+h)}
