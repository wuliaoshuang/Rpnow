/**
 * Generate the app icon set from RPNow's brand mark.
 *
 * Source of truth is a single SVG so every platform size stays consistent and
 * nobody has to hand-edit 20 PNGs. Run: node scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';

// The mark: a rose-to-plum gradient tile with a stylised "R" and a signal dot,
// matching public/icon.svg so web and desktop icons are identical.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b1b3d"/>
      <stop offset="0.55" stop-color="#6d3b7a"/>
      <stop offset="1" stop-color="#c2456b"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="url(#g)"/>
  <rect width="1024" height="460" rx="230" fill="url(#shine)"/>
  <path d="M320 320h208c86 0 148 62 148 144 0 66-36 114-96 132l104 148h-128l-92-136h-52v136H320V320zm92 84v136h96c44 0 72-28 72-68s-28-68-72-68h-96z" fill="#ffffff" fill-opacity="0.96"/>
  <circle cx="712" cy="700" r="74" fill="#ffd9e3"/>
  <circle cx="712" cy="700" r="40" fill="#c2456b"/>
</svg>`;

const SIZES = [
  ['src-tauri/icons/32x32.png', 32],
  ['src-tauri/icons/128x128.png', 128],
  ['src-tauri/icons/128x128@2x.png', 256],
  ['src-tauri/icons/icon.png', 512],
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/apple-touch-icon.png', 180],
  ['public/favicon-32.png', 32],
];

mkdirSync('src-tauri/icons', { recursive: true });
mkdirSync('public', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });

for (const [path, size] of SIZES) {
  await page.setContent(
    `<html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center">
      <div style="width:${size}px;height:${size}px">${SVG.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</div>
    </body></html>`,
  );
  const el = await page.$('div');
  await el.screenshot({ path, omitBackground: true });
  console.log('wrote', path, `${size}px`);
}

// Full-resolution master used to derive .ico/.icns via the Tauri CLI.
await page.setContent(
  `<html><body style="margin:0">${SVG}</body></html>`,
);
await page.screenshot({ path: 'src-tauri/icons/source-1024.png' });
console.log('wrote master source-1024.png');

await browser.close();

// Web favicon and maskable icon mirror the same artwork.
writeFileSync('public/icon.svg', SVG, 'utf8');
copyFileSync('src-tauri/icons/source-1024.png', 'public/icon-1024.png');
console.log('done');
