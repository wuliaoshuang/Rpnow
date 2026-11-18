import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const hits = [];
page.on('response', async (r) => {
  const u = r.url();
  if (/preset/i.test(u)) {
    let body = '';
    try {
      body = (await r.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    hits.push({ status: r.status(), url: u.replace(BASE, ''), body });
  }
});
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);
console.log(JSON.stringify(hits.slice(-20), null, 1));
await browser.close();
