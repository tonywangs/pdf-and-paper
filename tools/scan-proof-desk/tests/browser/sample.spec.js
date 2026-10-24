import {test,expect} from '@playwright/test';import {readFile,writeFile} from 'node:fs/promises';
test('apply visually checked sample correction and save actual browser output',async({page})=>{
 const sample=JSON.parse(await readFile('demo/sample.json'));
 await page.goto('/');await page.locator('#demo').click();await expect(page.locator('#pages button')).toHaveCount(5);
 await page.locator('#edit-28').fill('He had met a horseman by the way, he said, who had told him');
 await expect(page.locator('#status')).toContainText('Saved in this browser');await page.reload();await expect(page.locator('#edit-28')).toHaveValue('He had met a horseman by the way, he said, who had told him');
 const event=page.waitForEvent('download');await page.locator('#backup').click();const p=JSON.parse(await readFile(await(await event).path(),'utf8'));
 const lines=sample.lines.map(x=>{const r=p.pages[0].regions.find(r=>r.id===x.id);return {id:r.id,original:r.original,corrected:r.corrected};});
 await writeFile('demo/corrected-sample.json',JSON.stringify({scan:14,method:'Edited line r29 in the browser, reloaded, then exported project; other sample lines unchanged.',lines},null,2)+'\n');
});
