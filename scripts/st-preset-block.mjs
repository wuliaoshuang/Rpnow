import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(13000);

// 点开预设下拉（ST 用自定义列表）
await page.evaluate(() => {
  const el = document.getElementById('settings_preset');
  el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el?.click();
});
await page.waitForTimeout(1800);

const info = await page.evaluate(() => {
  const vis = (e) => e && e.offsetParent !== null;
  const blocks = Array.from(document.querySelectorAll(
    '.select_preset_block, .popup, .drawer-content, [class*="preset"]',
  ))
    .filter(vis)
    .slice(0, 6)
    .map((e) => ({
      cls: String(e.className).slice(0, 50),
      text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
      buttons: Array.from(e.querySelectorAll('button, .menu_button, .right_menu_button'))
        .map((b) => (b.textContent || b.getAttribute('title') || '').toString().trim().slice(0, 28))
        .filter(Boolean)
        .slice(0, 20),
    }));
  return blocks;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
