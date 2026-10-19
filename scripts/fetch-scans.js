import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('demo/provenance.json'));
for(const page of manifest.pages){const bytes=execFileSync('curl',['-L','--fail','--silent','--show-error',page.url],{maxBuffer:10*1024*1024});if(createHash('sha256').update(bytes).digest('hex')!==page.sha256)throw Error(`Source changed: ${page.url}`);await writeFile(page.file,bytes);console.log(`Verified scan ${page.scan}`);}
