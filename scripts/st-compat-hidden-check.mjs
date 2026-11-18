/**
 * 阶段 0 验收：SillyTavern 扩展兼容层已隐藏。
 *
 * 断言：
 *  1. 安装 SillyTavern 扩展包（酒馆助手真包）被明确拒绝，并给出可读原因；
 *  2. 插件页没有「扩展设置 / 扩展抽屉」等 ST 专属入口；
 *  3. 消息渲染不再产生酒馆助手的 `TH-render` 容器，只有 RPNow 自己的
 *     `rp-frontend-render`。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.RPNOW_E2E_BASE ?? 'http://127.0.0.1:5175/';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// 到插件页
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
    (e.textContent || '').includes('插件'),
  );
  b?.click();
});
await page.waitForTimeout(1800);

// ---- 1. 安装 ST 扩展必须被拒 -------------------------------------------
const before = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').length);
const zipB64 = readFileSync('tavern-helper-real.zip').toString('base64');
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([arr], 'tavern-helper.zip', { type: 'application/zip' }));
  const input = document.querySelector('input[type="file"][accept*="rpnx"], input[type="file"][accept*="zip"]');
  if (input) {
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, zipB64);
await page.waitForTimeout(6000);

const reject = await page.evaluate(() => {
  const text = (document.querySelector('main')?.innerText ?? '') + ' ';
  return {
    mentionsUnsupported: /暂不支持|SillyTavern 扩展/.test(text),
    toast: Array.from(document.querySelectorAll('[data-sonner-toast], .toast, [class*="toast"]'))
      .map((t) => (t.textContent || '').trim())
      .join(' | ')
      .slice(0, 200),
    mainLen: text.length,
  };
});
check('安装 SillyTavern 扩展被拒绝并给出原因', reject.mentionsUnsupported, reject.toast.slice(0, 120));

// ---- 2. UI 无 ST 专属入口 ----------------------------------------------
const ui = await page.evaluate(() => {
  const text = document.querySelector('main')?.innerText ?? '';
  return {
    noDrawerButton: !/扩展设置|扩展程序设置|打开扩展设置抽屉/.test(text),
    noExtensionsSurface: !document.getElementById('extensions_settings'),
  };
});
check('插件页无「扩展设置 / 扩展抽屉」入口', ui.noDrawerButton);
check('DOM 中不存在 #extensions_settings 宿主抽屉', ui.noExtensionsSurface);

// ---- 3. 渲染只产出 RPNow 自己的容器 -----------------------------------
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
    (e.textContent || '').trim() === '聊天',
  );
  b?.click();
});
await page.waitForTimeout(2500);
const render = await page.evaluate(async () => {
  // 直接调用渲染器（dev 环境可 import 源码）
  try {
    const mod = await import('/src/core/render/renderer.ts');
    const html = mod.defaultRenderer.render('```html\n<!DOCTYPE html>\n<html><head></head><body>验收</body></html>\n```', {
      styleScope: '.rp-md',
      sandboxHtml: false,
    });
    return {
      hasOwnClass: html.includes('rp-frontend-render'),
      hasTHClass: html.includes('TH-render'),
    };
  } catch (e) {
    return { error: String(e).slice(0, 160) };
  }
});
if (render.error) check('渲染器产物类名正确', false, render.error);
else {
  check('渲染产物使用 RPNow 自有容器类名', render.hasOwnClass && !render.hasTHClass, JSON.stringify(render));
}

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
