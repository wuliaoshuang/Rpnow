import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const js = readFileSync('th-index.js', 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 260)));
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 260)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1500);

const r = await page.evaluate(async ({ script }) => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const log = [];
  try {
    const h = await bridge.activateSTExtension('st.pp', {
      manifest: { display_name: 'pp', js: 'dist/index.js' },
      entryPath: 'dist/index.js',
      script,
    });
    await new Promise((r) => setTimeout(r, 1500));
    // 检查 preset manager 全局形态
    const s = window.__rpnowStore.getState();
    log.push('store ok');
    // 检查 tavern_helper 内容
    const th = document.getElementById('tavern_helper');
    log.push({ thChildren: th?.childElementCount, thHtml: th?.innerHTML.slice(0, 200) });
    h.dispose();
  } catch (e) {
    log.push('ERR ' + String(e.message).slice(0, 200));
  }
  return log;
}, { script: js });

console.log(JSON.stringify(r, null, 1));
await browser.close();
