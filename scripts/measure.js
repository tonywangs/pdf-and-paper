import {readFile,writeFile} from 'node:fs/promises';
const sample=JSON.parse(await readFile('demo/sample.json'));
const raw=JSON.parse(await readFile(`demo/page-${sample.scan}.json`));
const corrected=JSON.parse(await readFile('demo/corrected-sample.json'));
const norm=s=>s.replace(/\s+/g,' ').trim();
function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}
const reference=norm(sample.lines.map(x=>x.reference).join(' '));
const result={sample:sample.selection,checking:sample.checking,normalization:'Collapse whitespace only; Unicode codepoint CER, whitespace-token WER; Levenshtein distance / reference length.',reference_characters:[...reference].length,reference_words:reference.split(' ').length};
for(const [name,lines]of [['raw',sample.lines.map(x=>raw.regions.find(r=>r.id===x.id).original)],['corrected',sample.lines.map(x=>corrected.lines.find(r=>r.id===x.id).corrected)]]){const text=norm(lines.join(' '));const charErrors=distance([...reference],[...text]),wordErrors=distance(reference.split(' '),text.split(' '));result[name]={character_edits:charErrors,word_edits:wordErrors,CER:charErrors/result.reference_characters,WER:wordErrors/result.reference_words};}
result.limitations='Small, post-inspection convenience sample corrected against the same reference; measures this edit only, not general accuracy. Other pages and omitted text are not scored.';
await writeFile('results/measurement.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
