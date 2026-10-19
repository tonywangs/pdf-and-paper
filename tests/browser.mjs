import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';import {createHash} from 'node:crypto';import {start} from '../server.mjs';
const server=await start(0),url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
process.on('SIGINT',async()=>{await browser.close();server.close();process.exit(130);});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1480,height:1000}}),page=await context.newPage();page.setDefaultTimeout(180000);page.on('console',m=>{if(m.text().startsWith('PROGRESS')&&/Ready|Could not|Exported/.test(m.text()))console.log(m.text());});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('results',{recursive:true});await mkdir('/tmp/pdf-revision-artifacts',{recursive:true});
const recover=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('pdf-revision-desk',1);r.onsuccess=()=>{const db=r.result,s=db.transaction('desk').objectStore('desk').get('current');s.onsuccess=()=>{resolve(s.result);db.close();};s.onerror=()=>reject(s.error);};}));
async function idle(){await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
async function choose(a,b){console.log('Import',a,b);await page.locator('#old-file').setInputFiles(a);await page.locator('#new-file').setInputFiles(b);await page.locator('#compare').click();await idle();}
async function exportReport(path){const event=page.waitForEvent('download');await page.locator('#export').click();const d=await event;await d.saveAs(path);await idle();return path;}
async function verifyReport(path,expected){
 const report=await context.newPage();await report.goto('file://'+path);const metadata=JSON.parse(await report.locator('#metadata').textContent());assert.equal(metadata.old.hash,expected.old.hash);assert.equal(metadata.new.hash,expected.new.hash);assert.equal(metadata.tolerance,expected.tolerance);
 const old=metadata.rows.filter(r=>r.a!==null).map(r=>r.a).sort((a,b)=>a-b),newer=metadata.rows.filter(r=>r.b!==null).map(r=>r.b).sort((a,b)=>a-b);
 assert.deepEqual(old,expected.old.pages.map((_,i)=>i));assert.deepEqual(newer,expected.new.pages.map((_,i)=>i));
 const reviewedTitle=await page.locator('#pair-title').textContent(),reviewedOverlay=await page.locator('#diff-image').getAttribute('src');
 const sections=await report.locator('section').evaluateAll(ss=>ss.map(s=>({a:s.dataset.old,b:s.dataset.new,images:[...s.querySelectorAll('img')].map(i=>({alt:i.alt,src:i.src}))})));
 for(let i=0;i<sections.length;i++){const s=sections[i],r=metadata.rows[i];assert.equal(s.a,r.a===null?'':String(r.a+1));assert.equal(s.b,r.b===null?'':String(r.b+1));for(const [name,doc,key] of [['Earlier',expected.old,'a'],['Later',expected.new,'b']])if(r[key]!==null)assert.equal(s.images.find(im=>im.alt.startsWith(name)).src,doc.pages[r[key]].image);}
 const reviewedSection=sections.find(s=>`Earlier ${s.a||'—'} → Later ${s.b||'—'}`===reviewedTitle);assert.equal(reviewedSection.images.at(-1).src,reviewedOverlay,'exported overlay matches reviewed UI');
 await report.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await report.close();return metadata;
}
try{
 await page.goto(url);await idle();await page.evaluate(()=>new MutationObserver(()=>console.log('PROGRESS '+document.getElementById('status').textContent)).observe(document.getElementById('status'),{childList:true}));
 await choose('tests/fixtures/old.pdf','tests/fixtures/new.pdf');assert.match(await page.locator('#status').textContent(),/Ready/);let fixture=await recover();assert.equal(fixture.old.pages.length,9);for(const i of [4,5,6])assert.equal(fixture.matches[i].b,null,'duplicate or blank not silently paired');
 // Enforce the injected insertion/deletion oracle via the actual UI.
 await page.locator('[data-row="2"]').click();await idle();await page.locator('#match').selectOption('');await page.locator('#apply').click();await idle();
 await page.locator('[data-row="0"]').click();await idle();await page.locator('#match').selectOption('0');await page.locator('#apply').click();await idle();
 for(const index of [1,3,7,8]){await page.locator(`[data-row="${index}"]`).click();await idle();await page.locator('#match').selectOption(String(index));await page.locator('#apply').click();await idle();}
 const fixturePath=await exportReport('/tmp/pdf-revision-artifacts/controlled.html');fixture=await recover();const fixtureMeta=await verifyReport(fixturePath,fixture);
 await writeFile('/tmp/pdf-revision-artifacts/controlled-state.json',JSON.stringify(fixture));
 await writeFile('results/controlled-browser.json',JSON.stringify(fixtureMeta,null,2)+'\n');
 // Failed imports must not destroy the saved comparison.
 for(const bad of ['malformed','encrypted']){await choose(`tests/fixtures/${bad}.pdf`,'tests/fixtures/new.pdf');assert.match(await page.locator('#status').textContent(),/Could not finish/);assert.equal((await recover()).old.hash,fixture.old.hash);}
 if(!process.env.PDF_DESK_ONLY_CONTROLLED){
 // Real PDF file import, corrections, navigation, reload recovery and standalone export.
 await choose('demo/draft.pdf','demo/final.pdf');assert.match(await page.locator('#status').textContent(),/Ready/);let real=await recover();assert.equal(real.old.pages.length,86);assert.equal(real.new.pages.length,81);
 // The draft archive cover page is deliberately paired wrongly and then corrected to unmatched.
 await page.locator('[data-row="0"]').click();await idle();await page.locator('#match').selectOption('0');await page.locator('#apply').click();await idle();assert.equal((await recover()).matches[0].b,0);
 await page.locator('#match').selectOption('');await page.locator('#apply').click();await idle();assert.equal((await recover()).matches[0].b,null);
 // Published title pages: draft PDF 3 -> final PDF 1.
 await page.locator('[data-row="2"]').click();await idle();await page.locator('#match').selectOption('0');await page.locator('#apply').click();await idle();
 await page.locator('#next').click();await idle();const heading=await page.locator('#pair-title').textContent();
 await page.reload();await idle();assert.equal(await page.locator('#pair-title').textContent(),heading);assert.equal((await recover()).matches[2].b,0);assert.equal((await recover()).matches[2].confirmed,true);
 // Explicit tolerance change invalidates review flags and persists on reload.
 await page.locator('#tolerance').fill('24');await page.locator('#tolerance').dispatchEvent('change');await idle();assert.ok((await recover()).matches.every(r=>!r.confirmed));
 await page.locator('#tolerance').fill('20');await page.locator('#tolerance').dispatchEvent('change');await idle();
 await page.locator('[data-row="2"]').click();await idle();await page.locator('#confirm').click();await idle();
 await page.screenshot({path:'results/demo-browser.png',fullPage:false});
 real=await recover();await writeFile('/tmp/pdf-revision-artifacts/real-state.json',JSON.stringify(real));
 const path=await exportReport('/tmp/pdf-revision-artifacts/real-report.html');const meta=await verifyReport(path,real);await writeFile('results/real-browser.json',JSON.stringify(meta,null,2)+'\n');
 const reportBytes=(await stat(path)).size;
 // Keep the actual standalone report if it meets the repository per-file cap.
 if(reportBytes<=10*1024*1024)await writeFile('results/real-report.html',await readFile(path));
 await page.locator('#forget').click();await idle();await page.reload();await idle();assert.equal(await recover(),undefined);
 // Visible demo button is a separately exercised launch path with embedded provenance.
 console.log('Demo button');await page.locator('#demo').click();await idle();assert.match(await page.locator('#status').textContent(),/Ready/);const demo=await recover();assert.ok(demo.provenance.documents.length===2);assert.equal(demo.old.hash,real.old.hash);
 assert.deepEqual(errors,[]);
 const evidence={browser:'Chromium via Playwright',realPages:[86,81],workflow:['file import','manual wrong match and correction','difference navigation','reload recovery','tolerance change clears reviews','standalone HTML export','all page references and embedded source images checked byte-for-byte','forget recovery','demo button with provenance'],controlled:['duplicates unresolved','blanks unresolved','deletion correction','malformed refusal preserves recovery','encrypted refusal preserves recovery'],report:{bytes:reportBytes,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),saved:reportBytes<=10*1024*1024?'results/real-report.html':'/tmp/pdf-revision-artifacts/real-report.html'},pageErrors:errors};await writeFile('results/browser-checks.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}else{assert.deepEqual(errors,[]);console.log('Controlled browser import, correction, export, encrypted/malformed refusal passed.');}
}finally{await browser.close();server.close();}
