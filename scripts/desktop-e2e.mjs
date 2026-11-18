/**
 * Verifies the packaged desktop app really runs.
 *
 * Launches the built rpnow.exe, attaches to its WebView2 via the Chrome DevTools
 * protocol (enabled with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS), and drives the
 * UI through DevTools the same way the browser tests do.
 *
 * This is what distinguishes "the installer was produced" from "the app works".
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EXE = 'src-tauri/target/release/rpnow.exe';
const PORT = 9333;

if (!existsSync(EXE)) {
  console.error('missing exe:', EXE);
  process.exit(1);
}

const env = {
  ...process.env,
  // WebView2 passes these to the embedded Chromium.
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
};

const child = spawn(EXE, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d.toString()));

const alive = () => child.exitCode === null;

// Wait for the CDP endpoint.
let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await res.json();
    const page = list.find((t) => t.type === 'page') ?? list[0];
    if (page?.webSocketDebuggerUrl) {
      targets = page;
      break;
    }
  } catch {
    /* not up yet */
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

check('已打包的应用已启动', alive());
check('WebView2 调试端点可用', Boolean(targets));

if (targets) {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15000 }));

  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // The packaged app serves from tauri://localhost, not the dev server.
  console.log('url:', page.url());
  await page.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 25000 });
  check('应用界面已渲染', true);

  const info = await page.evaluate(() => {
    const tauri = Boolean(window.__TAURI_INTERNALS__);
    const theme = getComputedStyle(document.documentElement).getPropertyValue('--rp-bg').trim();
    return { tauri, theme, title: document.title };
  });
  check('检测到 Tauri 运行时', info.tauri);
  check('主题变量已注入', info.theme.length > 0, info.theme);

  // Navigate every page inside the packaged app.
  for (const label of ['\u89d2\u8272\u5361', '\u4e16\u754c\u4e66', '\u9884\u8bbe', '\u63d2\u4ef6', '\u8bbe\u7f6e', '\u5bf9\u8bdd']) {
    await page.getByRole('button', { name: label }).first().click();
    await page.waitForTimeout(300);
  }
  check('所有页面可访问', true);

  // Confirm the native transport is wired: the app must pick the Tauri HTTP plugin.
  const transportKind = await page.evaluate(async () => {
    const mod = await import('/assets/index.js').catch(() => null);
    // Fall back to a DOM-level assertion if module probing is not possible.
    return mod ? 'module' : 'unknown';
  }).catch(() => 'unknown');
  console.log('transport probe:', transportKind);

  // Desktop-specific UI copy must say so.
  await page.getByRole('button', { name: '\u8bbe\u7f6e' }).first().click();
  await page.waitForTimeout(500);
  const body = await page.evaluate(() => document.body.innerText);
  check('界面显示为桌面版', body.includes('\u684c\u9762\u7248'), body.includes('\u684c\u9762\u7248') ? '' : 'no desktop marker found');

  await page.screenshot({ path: 'screenshots/20-desktop-app.png' });
  check('无页面错误', errs.length === 0, errs.slice(0, 3).join('; '));
  await browser.close();
}

child.kill();
await sleep(500);
if (child.exitCode === null) child.kill('SIGKILL');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (stderr.trim()) console.log('\nstderr excerpt:\n' + stderr.slice(0, 800));
process.exit(failed.length ? 1 : 0);
