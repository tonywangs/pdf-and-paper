import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ingest,search,reportHTML} from '../web/engine.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const provenance=JSON.parse(await fs.readFile(root+'/web/corpus/manifest.json','utf8'));
const inputs=await Promise.all(provenance.files.filter(f=>f.kind==='document').map(async f=>({name:f.name,bytes:new Uint8Array(await fs.readFile(root+'/web/corpus/'+f.name))})));
const records=await ingest(inputs);
const queries=JSON.parse(await fs.readFile(root+'/tests/queries.json','utf8'));
const reports=queries.map(q=>({...search(records,q.query,q.mode,q.file??''),selected:[],provenance}));
if(process.argv.includes('--examples')){
 await fs.writeFile(root+'/examples/ownership.json',JSON.stringify(reports[0],null,2)+'\n');
 await fs.writeFile(root+'/examples/ownership.html',reportHTML(reports[0]));
 console.log('Generated standalone ownership reports from pinned real sources.');
}else process.stdout.write(JSON.stringify(reports));
