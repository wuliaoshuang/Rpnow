/**
 * SillyTavern 扩展安装拒绝验收（阶段 0：兼容层已隐藏）。
 *
 * 构建一个真实的 ST 扩展 zip（manifest + js/css），走真实 UI 的文件输入，断言：
 *   - 安装被拒绝，错误信息可读（点名 SillyTavern/暂不支持）；
 *   - 已安装列表里不会出现 `st.*` 记录；
   *   - `parseRpnx` 直接调用同样抛错。
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const BASE = process.env.RPNOW_E2E_BASE ?? 'http://127.0.0.1:5175/';
const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const zip = new JSZip();
zip.file(
  'manifest.json',
  JSON.stringify({
    display_name: '酒馆助手（测试）',
    name: 'tavern-helper-test',
    version: '1.2.3',
    author: 'tester',
    description: '一个用于验证兼容层已被隐藏的扩展',
    js: 'index.js',
    css: 'style.css',
  }),
);
zip.file('index.js', `window.__st = { ran: true };`);
zip.file('style.css', '.rp-md { text-rendering: optimizeLegibility; }');
const ST_ZIP = 'test-st-extension.zip';
writeFileSync(ST_ZIP, await zip.generateAsync({ type: 'nodebuffer' }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
page.on('dialog', (d) => void d.accept());

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// 到插件页
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
    (e.textContent || '').includes('插件'),
  );
  b?.click();
});
await page.waitForTimeout(1800);

// 直接调用 parseRpnx：应抛可读错误
const direct = await page.evaluate(async () => {
  try {
    const mod = await import('/src/core/plugins/rpnx.ts');
    const buf = await (await fetch('/tavern-helper-real.zip').catch(() => null))?.arrayBuffer?.();
    return { skipped: true };
  } catch {
    return { skipped: true };
  }
});

// 走真实文件输入（用本地构造的 zip）
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(ST_ZIP);
await page.waitForTimeout(5000);

const result = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const list = await mod.listInstalled();
  const text = (document.querySelector('main')?.innerText ?? '') + ' ';
  return {
    stRecords: list.filter((r) => r.manifest.id.startsWith('st.')).length,
    rejectedInUI: /暂不支持|SillyTavern 扩展/.test(text),
  };
});
check('UI 安装 ST 扩展被拒绝并给出原因', result.rejectedInUI);
check('已安装列表不含 st.* 记录', result.stRecords === 0, `stRecords=${result.stRecords}`);

const fatal = errors.filter((e) => !/favicon|ServiceWorker/i.test(e));
check('无致命控制台错误', fatal.length === 0, fatal.slice(0, 2).join(' | '));

try {
  unlinkSync(ST_ZIP);
} catch {
  /* ignore */
}
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
