import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const USER = process.env.ST_USER ?? 'RPNowProbe';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (!/aihorde|horde|Internal Server Error/.test(t)) errors.push(`[${m.type()}] ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

// 首次使用向导：填写用户名并确认
const done = await page.evaluate((name) => {
  const inputs = Array.from(document.querySelectorAll('input'));
  const target = inputs.find((i) => /用户设定名称|username|name/i.test(i.placeholder + i.getAttribute('aria-label')));
  if (!target) return { found: false };
  return { found: true };
}, USER);
console.log('wizard input found:', JSON.stringify(done));

await page.evaluate(
  ([name]) => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const target =
      inputs.find((i) => /用户设定名称|username|name/i.test(i.placeholder + i.getAttribute('aria-label'))) ||
      inputs[0];
    if (!target) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, name);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  },
  [USER],
);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /确定|OK|Confirm/i.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(15000);

const info = await page.evaluate(async () => {
  const st = window.SillyTavern;
  let ctx = null;
  try {
    ctx = st?.getContext?.();
  } catch {
    /* ignore */
  }
  // 等 chatLoaded 之后扩展应已挂载
  return {
    name1: ctx?.name1,
    characters: Array.isArray(window.characters) ? window.characters.length : null,
    chat: Array.isArray(window.chat) ? window.chat.length : null,
    hasTavernHelper: !!document.getElementById('tavern_helper'),
    tavernHelperNodes: document.getElementById('tavern_helper')?.querySelectorAll('*').length ?? 0,
    extSettingsKeys: ctx?.extensionSettings ? Object.keys(ctx.extensionSettings).filter((k) => /slash|tavern/i.test(k)) : null,
    disabledExtensions: ctx?.extensionSettings?.disabledExtensions ?? null,
    presets: null,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await page.screenshot({ path: 'screenshots/st-after-wizard.png' }).catch(() => {});
await browser.close();
