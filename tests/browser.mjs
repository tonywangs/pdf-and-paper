import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'desk-browser-'));
const server=spawn('python3',['serve.py','--port','18765'],{cwd:root,stdio:['ignore','pipe','pipe']});
let serverError='';server.stderr.on('data',d=>serverError+=d);
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',code=>reject(Error('Server exited '+code+serverError)));});
const options={headless:true};
if(process.env.CHROMIUM_PATH)options.executablePath=process.env.CHROMIUM_PATH;
else {const provided='/tmp/formula-browsers/chromium_headless_shell-1187/chrome-linux/headless_shell';try{await fs.access(provided);options.executablePath=provided;}catch{}}
let browser;
try{
 browser=await chromium.launch(options);
 const context=await browser.newContext({acceptDownloads:true});
 const page=await context.newPage();const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>{const u=route.request().url();if(!u.startsWith('http://127.0.0.1:18765/')&&!u.startsWith('file:')){external.push(u);return route.abort();}return route.continue();});
 await page.goto('http://127.0.0.1:18765');
 await page.getByRole('button',{name:'Open real-corpus demo'}).click();
 await page.waitForFunction(()=>document.querySelector('#result-summary').textContent.includes('102 occurrences'));
 assert.match(await page.locator('#coverage').textContent(),/20 submitted · 20 indexed · 0 rejected · 0 failed/);
 assert.equal(await page.locator('.result').count(),102);
 // Search and inspection must not request any resources after local demo import.
 const requests=[];page.on('request',r=>requests.push(r.url()));
 await page.locator('.result-top button').first().click();
 assert.equal(await page.locator('#context').evaluate(e=>e.open),true);
 assert.match(await page.locator('#context-title').textContent(),/\.md:\d+:\d+/);
 assert.equal(await page.locator('#context-lines mark').textContent(),'ownership');
 await page.getByRole('button',{name:'Close context'}).click();
 await page.locator('.result input').first().check();
 await page.getByRole('button',{name:'Save query & selection'}).click();
 await page.waitForFunction(()=>document.querySelector('#persistence').textContent.startsWith('Saved on'));
 assert.equal(requests.length,0,'Search/context/save should not make requests');
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Desk recovered'));
 await page.locator('#saved .saved-item button').first().click();
 assert.equal(await page.locator('.result input:checked').count(),1);
 async function download(button,name){const wait=page.waitForEvent('download');await page.getByRole('button',{name:button,exact:true}).click();const d=await wait;const dest=path.join(temp,name);await d.saveAs(dest);return dest;}
 const project=await download('Export project','desk.json');
 const json=await download('JSON report','report.json');
 const html=await download('HTML report','report.html');
 const report=JSON.parse(await fs.readFile(json));assert.equal(report.total,102);assert.equal(report.selected.length,1);assert.equal(report.manifest.length,20);
 const expected=JSON.parse(await fs.readFile(root+'/examples/ownership.json'));assert.deepEqual(report.results,expected.results);
 // Offline file:// report works with all networking disabled.
 const offline=await browser.newContext({offline:true});const rp=await offline.newPage();const offlineRequests=[];rp.on('request',r=>offlineRequests.push(r.url()));
 await rp.goto('file://'+html);assert.equal(await rp.locator('article').count(),102);assert.equal(await rp.locator('mark').count(),102);assert.match(await rp.locator('body').textContent(),/File filter: All indexed files/);assert.equal(offlineRequests.filter(u=>!u.startsWith('file:')).length,0);await offline.close();
 await page.getByRole('button',{name:'Clear this desk'}).click();
 await page.locator('#project-import').setInputFiles(project);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Project imported and source hashes verified'));
 await page.locator('#saved .saved-item button').first().click();assert.equal(await page.locator('.result input:checked').count(),1);
 // Changed local source collection requires explicit rebuild; never displays stale results.
 await page.locator('#files').setInputFiles({name:'changed.txt',mimeType:'text/plain',buffer:Buffer.from('ownership now\n<script>window.pwned=true</script>')});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Collection imported'));
 await page.locator('#saved .saved-item button').first().click();assert.equal(await page.locator('#recovery').isVisible(),true);assert.equal(await page.locator('.result').count(),0);assert.equal(await page.locator('#html').isDisabled(),true);
 await page.getByRole('button',{name:'Rebuild this saved search'}).click();assert.equal(await page.locator('.result').count(),1);assert.equal(await page.locator('.result input:checked').count(),0);
 await page.locator('#query').fill('script');await page.getByRole('button',{name:'Search',exact:true}).click();assert.equal(await page.locator('.result').count(),2);assert.equal(await page.evaluate(()=>window.pwned),undefined);assert.equal(await page.locator('#results script').count(),0);
 await page.locator('#query').fill('foo*');await page.getByRole('button',{name:'Search',exact:true}).click();assert.match(await page.locator('#status').textContent(),/Unsupported syntax/);assert.equal(await page.locator('.result').count(),0);
 // Malformed encoding, duplicate filenames, empty sources and binary input remain visible.
 await page.locator('#files').setInputFiles([{name:'broken.txt',mimeType:'text/plain',buffer:Buffer.from([0xff])},{name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('a')},{name:'same.txt',mimeType:'text/plain',buffer:Buffer.from('b')},{name:'empty.md',mimeType:'text/plain',buffer:Buffer.alloc(0)},{name:'binary.txt',mimeType:'text/plain',buffer:Buffer.from([0])}]);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Collection imported'));
 assert.match(await page.locator('#coverage').textContent(),/5 submitted · 1 indexed · 4 rejected · 0 failed/);
 // Hash-modified portable project: source text rehashed and saved query held for rebuild.
 const altered=JSON.parse(await fs.readFile(project));altered.sources[0].text+='\nchanged';
 await page.locator('#project-import').setInputFiles({name:'altered.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(altered))});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('hashes or semantics differ'));
 await page.locator('#saved .saved-item button').first().click();assert.equal(await page.locator('#recovery').isVisible(),true);assert.equal(await page.locator('.result').count(),0);
 // Semantic version changes require rebuild even when original source bytes match.
 const old=JSON.parse(await fs.readFile(project));old.semantics='old-version';
 await page.locator('#project-import').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(old))});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('hashes or semantics differ'));
 await page.locator('#saved .saved-item button').first().click();assert.equal(await page.locator('#recovery').isVisible(),true);
 // Filter + phrase workflow and portable report carries its scope.
 await page.locator('#project-import').setInputFiles(project);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Project imported and source hashes verified'));
 await page.locator('#query').fill('the stack');await page.locator('#mode').selectOption('phrase');await page.locator('#filter').selectOption('ch04-01-what-is-ownership.md');await page.getByRole('button',{name:'Search',exact:true}).click();
 assert((await page.locator('.result').count())>0);assert((await page.locator('.result-top button').allTextContents()).every(s=>s.startsWith('ch04-01-what-is-ownership.md:')));
 const filteredHTML=await download('HTML report','filtered.html');assert.match(await fs.readFile(filteredHTML,'utf8'),/File filter: ch04-01-what-is-ownership.md/);
 // At 100 saved queries, updating an existing selection still works.
 const full=JSON.parse(await fs.readFile(project));const original=full.saved[0];
 full.saved=[original,...Array.from({length:99},(_,i)=>({...original,query:'unique'+i,selected:[]}))];
 await page.locator('#project-import').setInputFiles({name:'full.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(full))});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Project imported and source hashes verified'));
 await page.locator('#saved .saved-item button').first().click();await page.locator('.result input').first().uncheck();await page.getByRole('button',{name:'Save query & selection'}).click();
 assert.match(await page.locator('#status').textContent(),/Saved query and selected/);
 await page.locator('#saved .saved-item button').first().click();assert.equal(await page.locator('.result input:checked').count(),0);
 // Render desktop and narrow viewport without horizontal overflow.
 await page.setViewportSize({width:1440,height:1000});
 if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS browser: real-corpus import/search/context, selected recovery, project export/import, changed/missing and outdated-source rebuild, malformed/duplicate/binary coverage, inert HTML, filtered phrase reports, offline reopening, responsive layout, no external requests or page errors.');
}finally{if(browser)await browser.close();server.kill();await fs.rm(temp,{recursive:true,force:true});}
