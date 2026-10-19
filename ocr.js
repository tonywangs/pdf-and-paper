import { createWorker } from 'tesseract.js';
import { mkdir } from 'node:fs/promises';
export async function createOCR() {
  await mkdir('.cache', {recursive:true});
  const worker = await createWorker('eng', 1, {cachePath:'.cache'});
  await worker.setParameters({tessedit_pageseg_mode:'3'});
  return {
    async recognize(image) {
      const {data} = await worker.recognize(image, {}, {blocks:true});
      const regions = [];
      for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) {
        if (!line.text.trim()) continue;
        regions.push({id:`r${regions.length+1}`, bbox:line.bbox, confidence:line.confidence, original:line.text.trimEnd(), corrected:line.text.trimEnd()});
      }
      return {regions, rawText:data.text, engine:'Tesseract.js 7.0.0 / English LSTM / PSM 3'};
    },
    close:()=>worker.terminate()
  };
}
