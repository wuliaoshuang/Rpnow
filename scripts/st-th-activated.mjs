import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/Slash|酒馆助手/.test(t)) logs.push(`[${m.type()}] ${t.slice(0, 200)}`);
});
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);

const state = await page.evaluate(() => ({
  hasTavernHelper: !!document.getElementById('tavern_helper'),
  thNodes: document.getElementById('tavern_helper')?.querySelectorAll('*').length ?? 0,
  thText: (document.getElementById('tavern_helper')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
  drawerChildren: document.getElementById('extensions_settings')?.children.length ?? null,
}));
console.log('activated:', JSON.stringify(state, null, 1));

// 预设管理：列出当前可选预设（找含 Meowssiah 的项）
const presets = await page.evaluate(() => {
  const sel = document.querySelector('#openai_preset, #preset_open_preset_manager, select');
  const opts = sel ? Array.from(sel.options || []).map((o) => o.textContent.trim()).slice(0, 40) : null;
  return { selector: sel ? sel.id || sel.tagName : null, options: opts };
});
console.log('preset control:', JSON.stringify(presets, null, 1));
console.log('th logs:', JSON.stringify(logs.slice(0, 10)));
await page.screenshot({ path: 'screenshots/st-th-active.png' }).catch(() => {});
await browser.close();
