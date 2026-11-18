import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(13000);

// 读当前 main_api 与预设选项
const before = await page.evaluate(() => ({
  mainApi: document.getElementById('main_api')?.value ?? document.getElementById('main_api')?.textContent,
  presetCount: document.getElementById('settings_preset')?.options.length,
}));
console.log('before:', JSON.stringify(before));

// 打开 API 连接弹层并选择 OpenAI
await page.evaluate(() => {
  for (const id of ['main_api', 'api_button', 'API连接']) {
    const el = typeof id === 'string' ? document.getElementById(id) : null;
    if (el && el.offsetParent !== null) {
      el.click();
      return;
    }
  }
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, .menu_button, li, [role="menuitem"]')].find((e) =>
    /^OpenAI/i.test((e.textContent || '').trim()),
  );
  b?.click();
});
await page.waitForTimeout(2500);

const after = await page.evaluate(() => ({
  mainApi: document.getElementById('main_api')?.value ?? document.getElementById('main_api')?.textContent,
  presets: Array.from(document.getElementById('settings_preset')?.options ?? []).map((o) => o.textContent.trim()).slice(0, 40),
}));
console.log('after:', JSON.stringify(after, null, 1));
await browser.close();
