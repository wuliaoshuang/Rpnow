import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const u = 'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@4.12.1/src/store/settings/global.ts';
const r = await page.request.get(u, { timeout: 30000 });
const t = await r.text();
if (r.ok() && !t.includes("Couldn't find")) {
  writeFileSync('th-src-settings_global.ts', t);
  console.log(`OK ${t.length}`);
} else {
  console.log(`bad: ${r.status()} ${t.slice(0, 80)}`);
}
await browser.close();
