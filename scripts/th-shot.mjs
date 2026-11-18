import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const js = readFileSync('th-index.js', 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 400)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1500);

const r = await page.evaluate(async ({ script }) => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const out = {};
  try {
    const h = await bridge.activateSTExtension('st.th-shot', {
      manifest: { display_name: '酒馆助手', js: 'dist/index.js' },
      entryPath: 'dist/index.js',
      script,
    });
    await new Promise((r) => setTimeout(r, 2500));
    out.activated = true;
    const host = document.getElementById('extensions_settings');
    out.childCount = host ? host.childElementCount : -1;
    out.text = (host?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300);
    out.height = host ? Math.round(host.getBoundingClientRect().height) : -1;
    out.errors = window.__errs ?? [];
    h.dispose();
  } catch (e) {
    out.activated = false;
    out.error = String(e && e.message ? e.message : e).slice(0, 400);
  }
  return out;
}, { script: js });

console.log('结果:', JSON.stringify(r, null, 1));
await page.screenshot({ path: 'th-render.png', fullPage: false });
console.log('--- 错误 ' + errors.length + ' 条 ---');
errors.slice(0, 8).forEach((e) => console.log(' •', e));
await browser.close();
