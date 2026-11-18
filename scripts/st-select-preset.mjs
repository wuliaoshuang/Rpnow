import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

// 1) API 连接弹层
await page.evaluate(() => document.getElementById('api_button')?.click());
await page.waitForTimeout(1800);
const apiPanel = await page.evaluate(() => ({
  visibleText: (document.getElementById('api_popup')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
  buttons: Array.from(document.querySelectorAll('#api_popup button, #api_popup .menu_button'))
    .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26))
    .filter(Boolean)
    .slice(0, 24),
}));
console.log('api panel:', JSON.stringify(apiPanel, null, 1));

// 2) 选择 OpenAI 类型
const picked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('#api_popup button, #api_popup .menu_button')].find((e) =>
    /OpenAI/i.test(e.textContent || ''),
  );
  if (b) b.click();
  return b ? (b.textContent || '').trim() : null;
});
console.log('picked:', picked);
await page.waitForTimeout(2500);

// 3) 关闭弹层，读预设列表
await page.evaluate(() => {
  const c = document.querySelector('#api_popup .menu_close, #api_popup .popup-close');
  c?.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
await page.waitForTimeout(2000);
const presets = await page.evaluate(() => ({
  mainApi: document.getElementById('main_api')?.value ?? null,
  options: Array.from(document.getElementById('settings_preset')?.options ?? []).map((o) => o.textContent.trim()),
}));
console.log('presets:', JSON.stringify(presets, null, 1));
await browser.close();
