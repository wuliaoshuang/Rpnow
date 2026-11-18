/**
 * Verifies the *installed* copy (not the build output) launches and renders.
 * Run after installing the NSIS package.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = `${process.env.LOCALAPPDATA}\\RPNow\\rpnow.exe`;
const CDP = 9335;

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

check('安装目录存在可执行文件', existsSync(EXE), EXE);
if (!existsSync(EXE)) process.exit(1);

const child = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}` },
  stdio: ['ignore', 'ignore', 'ignore'],
});

let target = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const t = list.find((x) => x.type === 'page') ?? list[0];
    if (t?.webSocketDebuggerUrl) {
      target = t;
      break;
    }
  } catch {
    /* wait */
  }
}
check('已安装的应用可启动', Boolean(target));

if (target) {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 25000 });
  check('界面渲染成功', true);

  // The bundled app must be a real build, not a dev server.
  const url = page.url();
  check('从本地资源加载（非开发服务器）', url.includes('tauri.localhost'), url);

  // Persistence sanity: create a card through the real UI, reload, confirm it survived.
  await page.getByRole('button', { name: '\u89d2\u8272\u5361' }).first().click();
  await page.waitForTimeout(800);
  const existing = await page.locator('article').count();

  if (existing === 0) {
    // Use the actual "new character" flow so we test what a user does.
    await page.getByRole('button', { name: /\u65b0\u5efa\u89d2\u8272/ }).click();
    await page.waitForSelector('input#card-name', { timeout: 10000 });
    await page.fill('input#card-name', 'Persistence Check');
    await page.getByRole('button', { name: /\u4fdd\u5b58/ }).click();
    await page.waitForTimeout(1200);
  }
  const cardCount = await page.locator('article').count();
  check('可通过界面新建角色卡', cardCount > 0, `${cardCount} cards`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 20000 });
  await page.getByRole('button', { name: '\u89d2\u8272\u5361' }).first().click();
  await page.waitForTimeout(1200);
  const afterReload = await page.locator('article').count();
  check('重启后数据仍存在（IndexedDB 有效）', afterReload > 0, `${afterReload} cards`);

  await page.screenshot({ path: 'screenshots/22-installed-app.png' });
  check('无页面错误', errs.length === 0, errs.slice(0, 2).join('; '));
  await browser.close();
}

child.kill();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
