import fs from 'node:fs/promises';import path from 'node:path';
const files=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(['.git','node_modules','.agents','.codex'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Unexpected symlink: '+p);if(e.isDirectory())await walk(p);else files.push(p);}}
await walk('.');let total=0;for(const p of files){const size=(await fs.stat(p)).size;total+=size;if(size>10*1024*1024)throw Error('File exceeds 10 MiB: '+p);if(p.endsWith('.log')&&p!=='results/tests.log')throw Error('Disallowed log: '+p);if(/(?:handoff|session|review-report|credentials)/i.test(p))throw Error('Control record filename: '+p);}
if(total>32*1024*1024||files.length>1000)throw Error('Package exceeds limits');console.log(JSON.stringify({files:files.length,bytes:total,limits:{files:1000,bytes:32*1024*1024,perFile:10*1024*1024}},null,2));
