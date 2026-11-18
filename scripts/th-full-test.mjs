import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const js = readFileSync('th-index.js', 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1500);

const r = await page.evaluate(async ({ script }) => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const out = {};
  try {
    const h = await bridge.activateSTExtension('st.th-full', {
      manifest: { display_name: '酒馆助手', js: 'dist/index.js' },
      entryPath: 'dist/index.js',
      script,
    });
    out.activated = true;
    await new Promise((r) => setTimeout(r, 1500));
    out.lodash = typeof window._;
    out.jQuery = typeof window.jQuery;
    out.dollar = typeof window.$;
    out.mountNode = Boolean(document.getElementById('extensions_settings'));
    out.helperDiv = Boolean(document.getElementById('tavern_helper'));
    out.rendered = Boolean(document.querySelector('#extensions_settings *'));
    h.dispose();
  } catch (e) {
    out.activated = false;
    out.error = String(e && e.message ? e.message : e).slice(0, 600);
  }
  return out;
}, { script: js });

console.log(JSON.stringify(r, null, 1));
await browser.close();
