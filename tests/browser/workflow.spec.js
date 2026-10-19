import {test,expect} from '@playwright/test';
import {readFile,copyFile} from 'node:fs/promises';
async function download(page,id){const event=page.waitForEvent('download');await page.locator(id).click();return await(await event).path();}
test('real scans → CPU OCR → linked correction → reload → portable recovery → exports',async({page,browser})=>{
 await page.goto('/');
 await page.locator('#scans').setInputFiles(['demo/scans/14.jpg','demo/scans/15.jpg','demo/scans/16.jpg','demo/scans/17.jpg','demo/scans/18.jpg']);
 await expect(page.locator('#pages button')).toHaveCount(5,{timeout:110000});
 await expect(page.locator('#lines textarea')).toHaveCount(32);
 await page.getByRole('button',{name:'Select line 2',exact:true}).click();
 await expect(page.locator('#edit-1')).toBeFocused();
 const before=JSON.parse(await readFile(await download(page,'#backup'),'utf8'));
 const marker='Verified correction <&> — unique Ω';
 await page.locator('#edit-1').fill(marker);
 await expect(page.locator('#status')).toContainText('Saved in this browser');
 await page.reload();await expect(page.locator('#edit-1')).toHaveValue(marker);
 const backupPath=await download(page,'#backup');const saved=JSON.parse(await readFile(backupPath,'utf8'));
 expect(saved.pages[0].regions[1].original).toBe(before.pages[0].regions[1].original);
 const fresh=await browser.newContext();const recovery=await fresh.newPage();await recovery.goto('http://127.0.0.1:4173');await recovery.locator('#recover').setInputFiles(backupPath);
 await expect(recovery.locator('#edit-1')).toHaveValue(marker);
 const txt=await readFile(await download(recovery,'#text'),'utf8');expect(txt.split(marker)).toHaveLength(2);
 for(let p=0;p<5;p++)for(let r=0;r<before.pages[p].regions.length;r++)if(p!==0||r!==1)expect(saved.pages[p].regions[r]).toEqual(before.pages[p].regions[r]);
 const expected=saved.pages.map(p=>`[${p.label}]\n${p.regions.map(r=>r.corrected).join('\n')}`).join('\n\n')+'\n';expect(txt).toBe(expected);
 const htmlDownload=await download(recovery,'#html');const htmlPath=htmlDownload+'.html';await copyFile(htmlDownload,htmlPath);const offline=await fresh.newPage();await offline.goto('file://'+htmlPath);await expect(offline.locator('section')).toHaveCount(5);expect((await offline.locator('pre').allTextContents()).filter(t=>t===marker)).toHaveLength(1);await offline.locator('a[href="#p0r1"]').click();await expect(offline.locator('g:target')).toHaveCount(1);await expect(offline.locator('image')).toHaveCount(5);
 await recovery.screenshot({path:'results/demo.png',fullPage:true});await fresh.close();
});
test('bundled demo and omitted text',async({page})=>{
 await page.goto('/');await page.locator('#demo').click();await expect(page.locator('#pages button')).toHaveCount(5);await page.locator('#regions button').first().click();await page.locator('#add').click();await expect(page.locator('#edit-1')).toBeFocused();await page.locator('#edit-1').fill('Manually recovered omitted text');await expect(page.locator('#status')).toContainText('Saved in this browser');await page.reload();await expect(page.locator('#edit-1')).toHaveValue('Manually recovered omitted text');
});
