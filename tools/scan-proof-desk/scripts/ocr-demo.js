import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createOCR} from '../ocr.js';
const provenance=JSON.parse(await readFile('demo/provenance.json'));
const ocr=await createOCR();
try {
 for(const page of provenance.pages){
  const bytes=await readFile(page.file);
  if(createHash('sha256').update(bytes).digest('hex')!==page.sha256) throw Error('Scan hash mismatch');
  const result=await ocr.recognize(bytes);
  await writeFile(`demo/page-${page.scan}.json`,JSON.stringify({...page,...result},null,2)+'\n');
  console.log(`Scan ${page.scan}: ${result.regions.length} lines`);
 }
} finally {await ocr.close();}
