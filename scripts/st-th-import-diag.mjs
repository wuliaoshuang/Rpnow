import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 300)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const res = await page.evaluate(async () => {
  const out = {};
  // 1) 直接 import TH 入口（ST 的激活方式）
  try {
    const mod = await import('/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js');
    out.importOk = true;
    out.exportedHook = typeof mod.activateTauriTavernChatSurface;
  } catch (e) {
    out.importOk = false;
    out.importError = e?.message ? String(e.message).slice(0, 300) : String(e);
  }
  // 2) CSS 是否能作为 link 载入
  out.perf = performance
    .getEntriesByType('resource')
    .filter((r) => /JS-Slash-Runner/.test(r.name))
    .slice(-6)
    .map((r) => ({ name: r.name.split('/').slice(-2).join('/'), size: r.transferSize, dur: Math.round(r.duration) }));
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log('logs:', JSON.stringify(logs.slice(-12), null, 1));
await browser.close();
