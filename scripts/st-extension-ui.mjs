import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (!/aihorde|horde|Internal Server Error/.test(t)) errors.push(`[${m.type()}] ${t.slice(0, 220)}`);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 220)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

// 1) 打开 Extensions 抽屉（顶栏按钮）
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button, .menu_button, [title]')].find((e) =>
    /Extensions/i.test((e.getAttribute('title') || '') + ' ' + (e.textContent || '')),
  );
  if (btn) {
    btn.click();
    return (btn.getAttribute('title') || btn.textContent || '').trim().slice(0, 40);
  }
  return null;
});
console.log('clicked:', opened);
await page.waitForTimeout(2500);

const panel = await page.evaluate(() => {
  const block = document.getElementById('rm_extensions_block');
  return {
    blockVisible: block ? getComputedStyle(block).display : null,
    text: (block?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500),
    switches: Array.from(document.querySelectorAll('#extensions_settings *, #rm_extensions_block *'))
      .filter((e) => e.tagName === 'INPUT' && e.type === 'checkbox')
      .length,
    hasTavernHelper: !!document.getElementById('tavern_helper'),
  };
});
console.log(JSON.stringify(panel, null, 1));

// 2) 打开管理弹窗（Manage extensions）
await page.evaluate(() => {
  const b = document.getElementById('extensions_details');
  if (b) b.click();
});
await page.waitForTimeout(2000);
const manager = await page.evaluate(() => ({
  dialogText: (document.querySelector('.popup, dialog, [role="dialog"]')?.innerText ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 600),
}));
console.log('manager:', JSON.stringify(manager));
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await page.screenshot({ path: 'screenshots/st-extensions.png' }).catch(() => {});
await browser.close();
