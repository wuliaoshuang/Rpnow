/** 检查酒馆助手的 Pinia store 是否成功创建 */
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
page.on('pageerror', (e) => errors.push(e.message.slice(0, 250)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('C ' + m.text().slice(0, 200)); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__errs = []; });

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const out = {};
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const h = await bridge.activateSTExtension('st.th-store', {
    manifest, entryPath: manifest.js, script, styles: css,
  });
  await new Promise((r) => setTimeout(r, 2500));

  // Vue app 的 Pinia：通过 app 实例不好拿，但渲染 store mount 失败会有错误
  // 检查 tavern_helper 的 DOM 深度——Vue 挂载成功会渲染 Panel 组件树
  const th = document.getElementById('tavern_helper');
  out.domDepth = (() => {
    let d = 0, el = th?.firstElementChild;
    while (el) { d++; el = el.firstElementChild; }
    return d;
  })();
  out.allButtons = th?.querySelectorAll('button').length ?? -1;
  out.innerText = (th?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200);
  out.renderToggle = th?.innerText.includes('启用渲染器') ?? false;
  out.errors = window.__errs ?? [];
  h.dispose();
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
await browser.close();
