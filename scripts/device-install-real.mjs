/**
 * 在真机上走一遍真实安装流程，给出真机实测结果。
 *
 * 通过 CDP 注入真实 zip（base64），触发插件页的文件选择处理器，然后读取：
 *  - 插件卡片显示的状态（正常 / 失败 + 错误文本）
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const zipB64 = readFileSync('tavern-helper-real.zip').toString('base64');
writeFileSync('zip-b64-length.txt', String(zipB64.length));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
await page.waitForTimeout(600);

// release 构建不能 import 源码；直接按文本点 UI。
// 页面当前是设置 hub（分组目录），"插件管理"是其中一行。
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main button')];
  const target = rows.find((b) => (b.textContent || '').includes('插件管理'));
  if (target) target.click();
});
await page.waitForTimeout(1200);
const onPlugins = await page.evaluate(() =>
  (document.querySelector('main')?.innerText ?? '').includes('安装 .rpnx'),
);
console.log('已到插件页:', onPlugins);

// 2. 注入文件并触发安装
const result = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'tavern-helper.zip', { type: 'application/zip' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('input[type="file"][accept*="rpnx"], input[type="file"][accept*="zip"]');
  if (!input) return { foundInput: false };
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { foundInput: true, size: file.size };
}, zipB64);

console.log('注入结果:', JSON.stringify(result));
await page.waitForTimeout(6000);

const state = await page.evaluate(() => ({
  text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1200),
}));
console.log('页面内容:\n', state.text);
// 截图在低端设备上会超时，跳过。
await browser.close();
