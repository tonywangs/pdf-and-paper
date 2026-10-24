// Focused replay of saved genuine input evidence through the current one-command launcher.
import {spawn} from 'node:child_process';import {readFile,writeFile} from 'node:fs/promises';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const child=spawn('./launch.sh',[],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','inherit']});
let browser;
try{
 const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Launch timeout')),15000);child.once('error',reject);child.once('exit',code=>reject(Error('Launch exited '+code)));child.stdout.on('data',data=>{const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});});
 const state=JSON.parse(await readFile('/tmp/pdf-revision-artifacts/real-state.json','utf8'));assert.equal(state.old.pages.length,86);assert.equal(state.new.pages.length,81);
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1480,height:1000}});page.setDefaultTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>!document.body.classList.contains('busy'));
 await page.evaluate(saved=>new Promise((resolve,reject)=>{const r=indexedDB.open('pdf-revision-desk',1);r.onsuccess=()=>{const db=r.result,t=db.transaction('desk','readwrite');t.objectStore('desk').put(saved,'current');t.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};}),state);
 await page.reload();await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.match(await page.locator('#status').textContent(),/Recovered/);
 await page.locator('[data-row="2"]').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.locator('#pair-title').textContent(),'Earlier 3 → Later 1');
 const report=await readFile('/tmp/pdf-revision-artifacts/real-report.html','utf8'),section=[...report.matchAll(/<section id="pair-[\s\S]*?<\/section>/g)].find(m=>m[0].includes('data-old="3" data-new="1"'))[0];const images=[...section.matchAll(/src="(data:image\/png;base64,[^"]+)"/g)].map(m=>m[1]);
 assert.equal(await page.locator('#old-image').getAttribute('src'),images[0]);assert.equal(await page.locator('#new-image').getAttribute('src'),images[1]);assert.equal(await page.locator('#diff-image').getAttribute('src'),images[2]);assert.deepEqual(errors,[]);
 await page.screenshot({path:'results/demo-browser.png'});
 const result={launch:'./launch.sh',sourcePages:[86,81],recoveredPair:[3,1],checks:['Current application recovers full genuine comparison','Earlier, later and overlay images match saved standalone report exactly','One-command launch serves current local application'],pageErrors:errors};await writeFile('results/recovery-checks.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();child.kill('SIGTERM');}
