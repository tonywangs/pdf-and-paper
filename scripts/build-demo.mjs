import fs from 'node:fs/promises';
import {hash,epub,inspect} from '../src/book.mjs';
const manifest=JSON.parse(await fs.readFile('demo/provenance.json'));
const files=[];
for(const f of manifest.files){const bytes=await fs.readFile('demo/manuscript/'+f.path);if(hash(bytes)!==f.sha256)throw Error('Demo source changed: '+f.path);files.push({path:f.path,sha256:f.sha256,data:bytes.toString('base64')});}
const project={version:1,metadata:{title:'Alice’s Adventures in Wonderland — Chapters I–III',author:'Lewis Carroll; illustrated by Arthur Rackham',language:'en'},order:manifest.chapters.map(c=>c.path),files};
await fs.writeFile('demo/alice.project.json',JSON.stringify(project,null,2)+'\n');
await fs.writeFile('demo/alice.epub',await epub(project));
const b=inspect(project);console.log(JSON.stringify({chapters:b.chapters.length,assets:b.assets.length,bytes:b.bytes,warnings:b.warnings},null,2));
