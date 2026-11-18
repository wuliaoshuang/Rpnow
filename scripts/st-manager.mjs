import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

// 打开扩展抽屉 → 管理扩展程序
await page.evaluate(() => document.getElementById('extensions-settings-button')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById('extensions_details')?.click());
await page.waitForTimeout(2500);

const info = await page.evaluate(() => {
  const pop = document.querySelector('.popup.maximized, .popup, dialog[open], [role="dialog"]');
  const rows = Array.from(document.querySelectorAll('.extensions_info, .extension_block, .extensions_list > *'))
    .slice(0, 12)
    .map((e) => ({
      text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      hasToggle: !!e.querySelector('input[type=checkbox]'),
    }));
  return {
    popupText: (pop?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 700),
    rows,
    slashMentioned: (document.body.innerText || '').includes('JS-Slash-Runner') ||
      (document.body.innerText || '').includes('酒馆助手'),
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'screenshots/st-manager.png' }).catch(() => {});
await browser.close();
