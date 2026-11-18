import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// 直接用 node 无法 import TS——通过 dev 页面
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async () => {
  const mod = await import('/src/core/render/renderer.ts');
  const sample = [
    '正文第二段。',
    '```',
    '<!DOCTYPE html>',
    '<html><head></head>',
    '<body><h1>A</h1></body></html>',
    '```',
    '<game>x</game>',
    '```html',
    '<!DOCTYPE html>',
    '<html><body><h1>B</h1></body></html>',
    '```',
    '结尾。',
  ].join('\n');
  const res = mod.defaultRenderer.render(sample, { sandboxHtml: true, allowExternalMedia: true, styleScope: '.rp-md' });
  return { cards: (res.match(/rp-html-card/g) ?? []).length, heads: res.slice(0, 400) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
