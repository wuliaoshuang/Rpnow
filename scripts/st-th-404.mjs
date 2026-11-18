import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const bad = [];
page.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400) bad.push(`${r.status()} ${u}`);
});
page.on('requestfailed', (r) => {
  bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`);
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

// 再次主动 import 触发子依赖请求
await page.evaluate(async () => {
  try {
    await import('/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js');
  } catch {
    /* expected */
  }
});
await page.waitForTimeout(4000);

console.log(JSON.stringify(bad.slice(-25), null, 1));
await browser.close();
