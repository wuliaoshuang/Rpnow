/** 直接验证共享 bus：激活前后 window.eventSource 是否同一实例 + spy 是否发射 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
const css = await zip.file('JS-Slash-Runner-main/dist/index.css').async('text');
const manifest = JSON.parse(await zip.file('JS-Slash-Runner-main/manifest.json').async('text'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 220)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const out = {};
  const before = window.eventSource;
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const h = await bridge.activateSTExtension('st.th-bus', {
    manifest, entryPath: manifest.js, script, styles: css,
  });
  await new Promise((r) => setTimeout(r, 1500));
  const after = window.eventSource;
  out.sameBus = before === after;
  out.beforeHasOnce = typeof before?.once;
  out.afterHasOnce = typeof after?.once;
  out.afterHasEmit = typeof after?.emit;

  // 在 window.eventSource 上监听，然后 emit 内核事件
  const got = [];
  if (typeof after?.on === 'function') {
    after.on(window.event_types?.CHARACTER_MESSAGE_RENDERED ?? 'character_message_rendered', (...a) => got.push(['CMR', a[0]]));
    after.on(window.event_types?.USER_MESSAGE_RENDERED ?? 'user_message_rendered', (...a) => got.push(['UMR', a[0]]));
  }
  window.__rpnowStore.getState().kernel?.events.emit('chat:message-sent', { chatId: 'x', message: {}, message_id: 3 });
  await new Promise((r) => setTimeout(r, 600));
  out.received = JSON.stringify(got);

  // shim 导入路径的 eventSource（酒馆助手真正拿到的）
  out.shimBusSame = (() => {
    try {
      const V = window.__rpHostValues ?? {};
      return V.eventSource === after;
    } catch { return 'err'; }
  })();
  h.dispose();
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
await browser.close();
