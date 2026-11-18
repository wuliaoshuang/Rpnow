import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (/slash|Slash|extension/i.test(t)) errors.push(`[${m.type()}] ${t.slice(0, 220)}`);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 220)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, .menu_button, [id*="extensions"]')].find((e) =>
    /扩展程序|Extensions/i.test((e.textContent || '') + ' ' + (e.getAttribute('title') || '')),
  );
  if (b) b.click();
  return b ? (b.id || b.textContent || '').toString().slice(0, 30) : null;
});
console.log('clicked:', clicked);
await page.waitForTimeout(3000);

const drawer = await page.evaluate(() => {
  const block = document.getElementById('rm_extensions_block');
  return {
    display: block ? getComputedStyle(block).display : null,
    thPresent: !!document.getElementById('tavern_helper'),
    thNodes: document.getElementById('tavern_helper')?.querySelectorAll('*').length ?? 0,
    settingsText: (document.getElementById('extensions_settings')?.innerText ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 400),
    thirdPartyText: Array.from(document.querySelectorAll('#third_party_extension_button, .extensions_info, [id*="extension"]'))
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6),
  };
});
console.log(JSON.stringify(drawer, null, 1));
console.log('ext-related logs:', JSON.stringify(errors.slice(0, 10)));
await page.screenshot({ path: 'screenshots/st-drawer.png' }).catch(() => {});
await browser.close();
