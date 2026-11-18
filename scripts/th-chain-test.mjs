/** 验证 bus 通路：跳过内核，直接手动触发 kernel 事件并检查监听器链 */
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
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const h = await bridge.activateSTExtension('st.th-chain', {
    manifest, entryPath: manifest.js, script, styles: css,
  });
  await new Promise((r) => setTimeout(r, 1200));

  // 1. 通过 __rpHostValues 拿 shim 版 eventSource（getter，实时 bus）
  const shimBus = (window.__rpHostValues ?? {}).eventSource;
  out.shimBusType = typeof shimBus?.on;

  // 2. 在 shim bus 上监听
  const got = [];
  shimBus?.on('character_message_rendered', (...a) => got.push(['CMR', a[0]]));
  shimBus?.on('user_message_rendered', (...a) => got.push(['UMR', a[0]]));
  shimBus?.on('message_sent', (...a) => got.push(['MS', a[0]]));

  // 3. 直接通过 shim bus emit —— 验证 bus 通路本身
  shimBus?.emit('character_message_rendered', 7);
  out.directEmit = got.length;

  // 4. 通过内核事件链触发（spy 应转译到同一 bus）
  window.__rpnowStore.getState().kernel?.events.emit('chat:message-sent', { chatId: 'x', message: {}, message_id: 3 });
  await new Promise((r) => setTimeout(r, 500));
  out.afterKernel = JSON.stringify(got);

  // 5. kernel events.on 是否真的注册过 chat:message-sent？
  const k = window.__rpnowStore.getState().kernel;
  out.kernelHasListeners = typeof k?.events?.on;
  h.dispose();
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
await browser.close();
