// Verify the production bundle boots and renders, not just the dev server.
import { chromium } from 'playwright';

const URL = process.env.RPNOW_PROD ?? 'http://127.0.0.1:4180/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
});

const res = await page.goto(URL, { waitUntil: 'domcontentloaded' });
console.log('status:', res?.status());
await page.waitForSelector('[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 25000 });
await page.waitForTimeout(1200);

// Kernel booted in the bundle?
const booted = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('nav button')].length;
  const hasTheme = getComputedStyle(document.documentElement).getPropertyValue('--rp-bg').trim().length > 0;
  return { navButtons: btns, hasTheme };
});
console.log(JSON.stringify(booted));

// Navigate every page to be sure no chunk fails to load on demand.
for (const label of ['\u89d2\u8272\u5361', '\u4e16\u754c\u4e66', '\u9884\u8bbe', '\u63d2\u4ef6', '\u8bbe\u7f6e', '\u5bf9\u8bdd']) {
  await page.getByRole('button', { name: label }).first().click();
  await page.waitForTimeout(350);
}
await page.screenshot({ path: 'screenshots/17-production.png' });

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
