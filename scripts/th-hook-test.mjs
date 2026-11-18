/** 真实酒馆助手：激活 hook + 事件触发，验证 renderer 是否被调用。 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
const css = await zip.file('JS-Slash-Runner-main/dist/index.css').async('text');
const manifest = JSON.parse(await zip.file('JS-Slash-Runner-main/manifest.json').async('text'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 220)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1400);

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const out = {};
  try {
    const h = await bridge.activateSTExtension('st.th-e2e', {
      manifest,
      entryPath: manifest.js,
      script,
      styles: css,
    });
    out.activated = true;
    await new Promise((r) => setTimeout(r, 2000));
    out.afterActivate = {
      helperDiv: Boolean(document.getElementById('tavern_helper')),
      childCount: document.getElementById('tavern_helper')?.childElementCount ?? -1,
      settingsHasContent: (document.getElementById('extensions_settings')?.childElementCount ?? 0) > 0,
    };
    // 触发用户消息事件，看渲染器是否反应
    window.__rpnowStore.getState().kernel?.events.emit('chat:message-sent', { chatId: 'x', message: { id: 'm', content: 'hi' } });
    await new Promise((r) => setTimeout(r, 800));
    h.dispose();
  } catch (e) {
    out.activated = false;
    out.error = String(e && e.message ? e.message : e).slice(0, 500);
    out.stackHead = String(e && e.stack ? e.stack : '').split('\n').slice(0, 3).join(' | ');
  }
  return out;
}, { script: js, css, manifest });

console.log('结果:', JSON.stringify(r, null, 1));
console.log('--- 错误 ' + errors.length + ' 条 ---');
errors.slice(0, 6).forEach((e) => console.log(' •', e));
await page.screenshot({ path: 'th-e2e.png' });
await browser.close();
