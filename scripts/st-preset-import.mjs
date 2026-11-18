import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(13000);

// 打开预设选择弹层
await page.evaluate(() => {
  const sel = document.getElementById('settings_preset');
  if (sel) {
    sel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // ST 用的是自定义下拉：点击其容器
    document.getElementById('preset_open_preset_manager')?.click();
  }
});
await page.waitForTimeout(2000);
await page.evaluate(() => {
  // 也尝试常见的预设管理器入口
  for (const id of ['preset_open_preset_manager', 'open_preset_manager', 'ui_setting_preset_open']) {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) {
      el.click();
      break;
    }
  }
});
await page.waitForTimeout(2500);

const info = await page.evaluate(() => ({
  popups: Array.from(document.querySelectorAll('.popup, dialog[open], [role="dialog"], .select_preset_block'))
    .filter((e) => e.offsetParent !== null)
    .slice(0, 4)
    .map((e) => ({
      cls: String(e.className).slice(0, 40),
      text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      buttons: Array.from(e.querySelectorAll('button, .menu_button')).map((b) =>
        (b.textContent || b.getAttribute('title') || '').toString().trim().slice(0, 24),
      ).filter(Boolean).slice(0, 16),
      fileInputs: Array.from(e.querySelectorAll('input[type=file]')).map((i) => i.id || '(no-id)'),
    })),
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'screenshots/st-preset-manager.png' }).catch(() => {});
await browser.close();
