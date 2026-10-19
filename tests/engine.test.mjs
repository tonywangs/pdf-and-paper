import test from 'node:test';
import assert from 'node:assert/strict';
import {ingest,search,parseQuery,exportProject,importProject,binding,reportHTML,LIMITS} from '../web/engine.js';
const input=(name,text)=>({name,bytes:new TextEncoder().encode(text)});
test('Unicode, punctuation, raw Markdown, lines and UTF-16 source references',async()=>{
 const records=await ingest([input('control.md','# Café cafe\u0301 CAFE résumé\r\n😀 naïve—word. naive_word\rfoo\nbar\n<script>alert(1)</script>')]);
 assert.equal(search(records,'CAFÉ').total,2);assert.equal(search(records,'cafe').total,1);
 let r=search(records,'naïve word','phrase').results[0];assert.equal(r.line,2);assert.equal(r.column,4);assert.equal(r.match,'naïve—word');
 assert.equal(search(records,'naive word','phrase').total,1);
 assert.equal(search(records,'foo bar','phrase').total,0);
 assert.equal(search(records,'# Café','literal').total,1);
 assert.equal(search(records,'fé','literal').total,1);
 assert.equal(search(records,'fé','term').total,0);
 assert.equal(search(records,'café','literal').total,0);
 assert.equal(search(records,'Café','literal').total,1);
 const html=reportHTML(search(records,'script'));
 assert(!html.includes('<script>'));assert(html.includes('&lt;'));assert(html.includes("default-src 'none'"));
});
test('unsupported and empty syntax fails explicitly',()=>{
 for(const q of ['','a b','foo*','foo OR bar','"phrase"','a:b','a\nb','foo-bar'])assert.throws(()=>parseQuery(q,'term'));
 for(const q of ['AND','(hello)','word~1','"two words"'])assert.throws(()=>parseQuery(q,'phrase'));
 assert.throws(()=>parseQuery('abc','unknown'));assert.equal(parseQuery('AND','literal'),'AND');
});
test('all submitted files accounted; malformed, binary, duplicate, empty, limit and read failures',async()=>{
 const inputs=[input('a.txt','ok'),input('empty.md',''),input('same.txt','a'),input('same.txt','b'),{name:'bad.txt',bytes:new Uint8Array([0xff])},input('binary.txt','a\0b'),input('other.pdf','foo'),input('long.md','x'.repeat(20001)),{name:'large.txt',size:LIMITS.fileBytes+1}, {name:'error.txt',size:1,arrayBuffer:async()=>{throw Error('denied');}}];
 const rs=await ingest(inputs);assert.equal(rs.length,inputs.length);assert.deepEqual(rs.map(r=>r.status),['indexed','indexed','rejected','rejected','rejected','rejected','rejected','rejected','rejected','failed']);
 assert.equal(search(rs,'ok').coverage.submitted,10);
 const many=await ingest(Array.from({length:101},(_,i)=>input(`${i}.txt`,'a')));assert.equal(many.filter(r=>r.status==='indexed').length,100);assert.match(many[100].reason,/count limit/);
 const large=('a'.repeat(16383)+'\n').repeat(64);const all=await ingest(Array.from({length:9},(_,i)=>input(`${i}.txt`,large)));assert.equal(all.filter(r=>r.status==='indexed').length,8);assert.match(all[8].reason,/8 MiB/);
});
test('ordering, overlapping literal, full totals and visible truncation',async()=>{
 const rs=await ingest([input('z.txt','aaa'),input('a.txt','a '.repeat(3000))]);
 const r=search(rs,'a');assert.equal(r.total,3000);assert.equal(r.results.length,2000);assert.equal(r.truncated,true);assert.deepEqual(r.matchingDocuments,['a.txt']);assert.equal(r.results[0].column,1);
 assert.equal(search(rs,'aa','literal','z.txt').total,2);
});
test('roundtrip source bytes, selections and changed/missing bindings',async()=>{
 const records=await ingest([input('a.md','\uFEFFhello\r\nworld'),input('empty.txt','')]);
 const result=search(records,'hello');const saved=[{query:'hello',mode:'term',file:'',binding:binding(records),selected:[result.results[0].id]}];
 const p=exportProject(records,saved);const restored=await importProject(JSON.parse(JSON.stringify(p)));assert.equal(restored.changed,false);assert.equal(binding(restored.records),binding(records));assert.deepEqual(restored.saved,saved);
 p.sources[0].text='changed';const changed=await importProject(p);assert.equal(changed.changed,true);assert.notEqual(changed.saved[0].binding,binding(changed.records));
 p.sources=[];const missing=await importProject(p);assert.equal(missing.changed,true);
 await assert.rejects(()=>importProject({format:'wrong'}));
});

test('outdated search semantics require explicit rebuild even with unchanged sources',async()=>{const rs=await ingest([input('a.txt','hello')]);const p=exportProject(rs,[{query:'hello',mode:'term',file:'',binding:binding(rs),selected:[]}]);p.semantics='older-v0';const r=await importProject(p);assert.equal(r.changed,true);assert.notEqual(r.saved[0].binding,binding(r.records));});

test('line/token budgets reject whole files and portable projects retain all rejection records',async()=>{
 const tooManyLines=await ingest([input('lines.txt','a\n'.repeat(20000))]);assert.match(tooManyLines[0].reason,/20000 lines/);
 const manyTokens=('a '.repeat(5000)+'\n').repeat(21);
 const tooManyTokens=await ingest([input('tokens.txt',manyTokens)]);assert.match(tooManyTokens[0].reason,/100000 tokens/);
 const bounded=('a '.repeat(5000)+'\n').repeat(20);
 const total=await ingest(Array.from({length:4},(_,i)=>input(`${i}.txt`,bounded)));assert.equal(total.filter(r=>r.status==='indexed').length,3);assert.match(total[3].reason,/300000 tokens/);
 const rejections=Array.from({length:10001},(_,i)=>({name:`${i}.pdf`,status:'rejected',bytes:0,reason:'Unsupported extension'}));
 const p=exportProject(rejections,[]);assert.equal((await importProject(p)).records.length,10001);
});
