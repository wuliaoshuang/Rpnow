import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(13000);

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button, .menu_button, [title]'))
    .map((b) => ({
      tag: b.tagName,
      id: b.id || '',
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      title: (b.getAttribute('title') || '').slice(0, 40),
      visible: b.offsetParent !== null,
    }))
    .filter((x) => x.visible && (/导入|预设|Preset/i.test(x.text + x.title) || /preset/i.test(x.id)))
    .slice(0, 30),
);
console.log(JSON.stringify(buttons, null, 1));
await browser.close();
