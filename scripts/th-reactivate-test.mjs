/** 复现真机崩溃：两次激活（停用→再启用）不得抛 "only a getter" */
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
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const out = { passes: [], errors: [] };
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const files = { manifest, entryPath: manifest.js, script, styles: css };

  // 第 1 次激活
  const h1 = await bridge.activateSTExtension('st.re', files);
  out.passes.push('第1次激活 OK');
  h1.dispose();
  // 第 2 次（复现真机：重新激活）
  try {
    const h2 = await bridge.activateSTExtension('st.re', files);
    out.passes.push('第2次激活 OK');
    h2.dispose();
  } catch (e) {
    out.errors.push('第2次: ' + String(e?.message ?? e).slice(0, 160));
  }
  // 第 3 次
  try {
    const h3 = await bridge.activateSTExtension('st.re', files);
    out.passes.push('第3次激活 OK');
    h3.dispose();
  } catch (e) {
    out.errors.push('第3次: ' + String(e?.message ?? e).slice(0, 160));
  }
  // chat getter 仍然活
  try {
    out.chatIsArray = Array.isArray(window.chat);
    out.chatLen = window.chat?.length ?? -1;
  } catch (e) {
    out.errors.push('chat读取: ' + String(e?.message ?? e).slice(0, 120));
  }
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
console.log('--- pageerror', errors.length, '条 ---');
errors.slice(0, 4).forEach((e) => console.log(' •', e));
await browser.close();
process.exit(r.errors.length || errors.length ? 1 : 0);
