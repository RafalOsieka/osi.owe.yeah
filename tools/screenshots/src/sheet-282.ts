// PROTOTYPE (#282): lays screenshots side by side into one picture, to review several at once.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const [dir, outFile, ...names] = process.argv.slice(2);
const imgs = names
  .map(
    (n) =>
      `<figure><img src="data:image/png;base64,${readFileSync(`${dir}/${n}.png`).toString('base64')}"><figcaption>${n}</figcaption></figure>`,
  )
  .join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400 * names.length, height: 900 } });
await page.setContent(
  `<style>body{margin:0;display:flex;gap:8px;align-items:flex-start;font:14px sans-serif}figure{margin:0;width:390px}img{width:390px}</style>${imgs}`,
);
await page.screenshot({ path: outFile!, fullPage: true });
await browser.close();
