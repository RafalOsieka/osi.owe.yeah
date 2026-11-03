// Cuts the committed raster icons from public/favicon.svg and public/icon.svg, with the Chromium
// the ui e2e suite already uses. A one-off, not part of the build: run it from apps/web with
// `node scripts/cut-icons.ts` whenever app/assets/icons/app-mark.svg changes, and commit the
// results. The asset list lives in that file's header comment.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

const tile = '#10b981';

const svgDataUrl = async (file: string) =>
  `data:image/svg+xml;base64,${(await readFile(`public/${file}`)).toString('base64')}`;

/**
 * Renders an SVG as a size×size PNG. With `fullBleed` the page is the tile colour, so the
 * rounded corners fill in and the icon is an opaque square; otherwise the corners stay
 * transparent.
 */
async function cut(page: Page, svg: string, size: number, fullBleed = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:${fullBleed ? tile : 'transparent'}">` +
      `<img src="${svg}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  return page.screenshot({ omitBackground: !fullBleed });
}

/** Packs PNGs into an .ico, which browsers and Windows read as PNG entries. */
function ico(images: { size: number; png: Buffer }[]) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const favicon = await svgDataUrl('favicon.svg');
  const icon = await svgDataUrl('icon.svg');

  const favicons = [
    { size: 16, png: await cut(page, favicon, 16) },
    { size: 32, png: await cut(page, favicon, 32) },
  ];
  await writeFile('public/favicon.ico', ico(favicons));

  await writeFile('public/apple-touch-icon.png', await cut(page, icon, 180, true));
  await writeFile('public/pwa-192x192.png', await cut(page, icon, 192));
  await writeFile('public/pwa-512x512.png', await cut(page, icon, 512));
  await writeFile('public/maskable-icon-512x512.png', await cut(page, icon, 512, true));
} finally {
  await browser.close();
}
