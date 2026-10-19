import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {suggest,validate,rowsFor} from '../public/core.mjs';
const saved=JSON.parse(await readFile('/tmp/pdf-revision-artifacts/real-state.json','utf8'));
const state={...saved,matches:suggest(saved.old.pages,saved.new.pages),insertions:{}};validate(state);
for(const [a,b] of [[2,0],[3,1],[12,10],[14,12]])assert.equal(state.matches[a].b,b);
const rows=rowsFor(state);assert.deepEqual(rows.filter(r=>r.a!==null).map(r=>r.a).sort((a,b)=>a-b),state.old.pages.map((_,i)=>i));assert.deepEqual(rows.filter(r=>r.b!==null).map(r=>r.b).sort((a,b)=>a-b),state.new.pages.map((_,i)=>i));
for(const r of state.matches)if(r.b!==null)assert.equal(state.old.pages[r.a].ink<.001,state.new.pages[r.b].ink<.001);
const result={sourceHashes:[state.old.hash,state.new.hash],representativePairs:[[3,1],[4,2],[13,11],[15,13]],allPagesAccountedFor:[86,81],correspondences:rows.length,unmatchedEarlier:state.matches.filter(r=>r.b===null).length,unmatchedLater:rows.filter(r=>r.a===null).length,check:'Blank/nonblank suggestions do not compete; representative real suggestions remain intact. All suggestions remain unreviewed.'};await writeFile('results/matching-checks.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
