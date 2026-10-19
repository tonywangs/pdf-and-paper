import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const p=JSON.parse(await readFile('demo/provenance.json','utf8'));
for(const d of p.documents){const r=await fetch(d.url);if(!r.ok)throw Error(`${r.status}: ${d.url}`);const b=Buffer.from(await r.arrayBuffer());if(createHash('sha256').update(b).digest('hex')!==d.sha256)throw Error(`Upstream bytes changed: ${d.file}; original retained`);await writeFile(`demo/${d.file}`,b);console.log(d.file,d.sha256);}
