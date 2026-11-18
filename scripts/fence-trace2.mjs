import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const text = readFileSync('real-floor.txt', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate((t) => {
  const lines = t.split('\n');
  // 行 190-200 与行 240-252 的原文
  const pick = (a, b) => lines.slice(a, b).map((l, k) => `${a + k}: ${JSON.stringify(l.slice(0, 60))}`).join('\n');
  // 文档开头 <!DOCTYPE 的位置
  const doc1 = lines.findIndex((l) => /<!DOCTYPE/i.test(l));
  return {
    doc1Line: doc1,
    around1: pick(Math.max(0, doc1 - 3), doc1 + 2),
    around199: pick(195, 202),
    around249: pick(246, 252),
  };
}, text);
console.log(r.around1, '\n---199---\n', r.around199, '\n---249---\n', r.around249);
await browser.close();
