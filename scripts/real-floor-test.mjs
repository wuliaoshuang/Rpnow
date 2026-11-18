import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const text = readFileSync('real-floor.txt', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async (realText) => {
  const mod = await import('/src/core/render/renderer.ts');
  const out = mod.defaultRenderer.render(realText, { sandboxHtml: true, allowExternalMedia: true, styleScope: '.rp-md' });
  // 定位围栏数量
  const fences = (realText.match(/```/g) ?? []).length;
  return {
    fencesInSource: fences,
    cards: (out.match(/rp-html-card/g) ?? []).length,
    escapedDoc: out.includes('&lt;!DOCTYPE'),
    docHead: out.slice(out.indexOf('DOCTYPE') - 60, out.indexOf('DOCTYPE') + 40),
  };
}, text);
console.log(JSON.stringify(r, null, 1));
await browser.close();
