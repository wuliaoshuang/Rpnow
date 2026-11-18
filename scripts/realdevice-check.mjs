/**
 * Measure the real device layout: status bar overlap, top bar position, and
 * whether the settings entry point is reachable on a phone viewport.
 *
 * Requires a debug build (WebView devtools) on the connected device.
 */
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const PKG = 'app.rpnow.desktop';
const SERIAL = process.env.ADB_SERIAL ?? '2c2a3c4b';
const A = `"${ADB}" -s ${SERIAL}`;

const run = (c) => execSync(c, { encoding: 'utf8' });
const tryRun = (c) => {
  try {
    return run(c);
  } catch {
    return '';
  }
};

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

// Platform-side facts.
console.log('model :', tryRun(`${A} shell getprop ro.product.model`).trim());
console.log('android:', tryRun(`${A} shell getprop ro.build.version.release`).trim());
console.log('size  :', tryRun(`${A} shell wm size`).trim());
console.log('density:', tryRun(`${A} shell wm density`).trim());

// Status bar height from the window manager (px).
const winDump = tryRun(`${A} shell dumpsys window`);
const m =
  /statusBars[\s\S]{0,200}?frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(winDump) ??
  /mStableInsets=Rect\(([^)]*)\)/.exec(winDump);
console.log('statusbar frame hint:', m?.[0]?.replace(/\s+/g, ' ').slice(0, 120) ?? 'n/a');

const pid = tryRun(`${A} shell pidof ${PKG}`).trim();
check('应用运行中', Boolean(pid), `pid=${pid}`);
if (!pid) process.exit(1);

tryRun(`${A} forward --remove-all`);
tryRun(`${A} forward tcp:9224 localabstract:webview_devtools_remote_${pid}`);
await new Promise((r) => setTimeout(r, 1500));

let targets = [];
try {
  targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
} catch {
  /* release build */
}
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.log('\nRELEASE 构建：无法附加 devtools。请安装 debug 包测量。');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');

const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
  return res.result?.value;
};

await new Promise((r) => setTimeout(r, 2000));

const info = await evalJs(`(() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden';
  document.body.appendChild(probe);
  const insetTop = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();

  const header = document.querySelector('header');
  const title = document.querySelector('header h1');
  const gear = document.querySelector('header button[aria-label="设置"]');
  const nav = document.querySelector('nav[aria-label="底部导航"]');
  const more = document.querySelector('nav[aria-label="底部导航"] button[aria-label="更多"]');
  const r = (el) => { if(!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };

  return {
    dpr: devicePixelRatio,
    vw: window.innerWidth,
    vh: window.innerHeight,
    insetTop,
    bodyMargin: getComputedStyle(document.body).margin,
    header: r(header),
    headerPaddingTop: header ? getComputedStyle(header).paddingTop : null,
    title: r(title),
    gear: r(gear),
    bottomNav: r(nav),
    moreBtn: r(more),
    navLabels: [...document.querySelectorAll('nav[aria-label="底部导航"] button')].map(b => b.textContent.trim() || b.getAttribute('aria-label')),
  };
})()`);

console.log('\n--- metrics ---');
console.log(JSON.stringify(info, null, 2));

// 1. body margin reset
check('body 外边距已清零', info.bodyMargin === '0px', info.bodyMargin);

// 2. Safe area is reported and the header is pushed below it.
check('设备报告安全区顶部高度', info.insetTop > 0, `${info.insetTop}px`);
check(
  '顶栏顶部内边距 = 安全区高度',
  Math.abs(parseFloat(info.headerPaddingTop) - info.insetTop) < 1,
  `padding=${info.headerPaddingTop}, inset=${info.insetTop}px`,
);
check(
  '标题文字位于状态栏之下',
  info.title && info.title.top >= info.insetTop - 1,
  `titleTop=${info.title?.top}, inset=${info.insetTop}`,
);

// 3. Settings must be reachable on mobile.
check('顶栏存在设置入口', Boolean(info.gear), info.gear ? `${info.gear.w}x${info.gear.h} @${info.gear.top}` : 'missing');
check('底部导航存在"更多"入口', Boolean(info.moreBtn));
const labels = info.navLabels.join(' / ');
check('底部导航项数不超过 5', info.navLabels.length <= 5, labels);

// 4. The gear must actually navigate.
if (info.gear) {
  const navigated = await evalJs(`(() => {
    const g = document.querySelector('header button[aria-label="设置"]');
    g.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const onSettings = await evalJs(`document.body.innerText.includes('模型连接') || document.body.innerText.includes('设置')`);
  check('点击齿轮可进入设置页', navigated && onSettings);
}

// 5. The more sheet exposes 设置 as well.
await evalJs(`(() => { const b = document.querySelector('button[aria-label="更多"]'); if (b) b.click(); })()`);
await new Promise((r) => setTimeout(r, 500));
const sheet = await evalJs(`(() => {
  const menu = document.querySelector('[role="menu"][aria-label="更多功能"]');
  if (!menu) return { open: false };
  return { open: true, items: [...menu.querySelectorAll('button')].map(b => b.textContent.trim()) };
})()`);
check('"更多"弹出菜单包含设置', sheet.open && sheet.items.includes('设置'), JSON.stringify(sheet.items ?? []));

try {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('screenshots/31-real-device-measured.png', Buffer.from(shot.data, 'base64'));
} catch {
  /* ignore */
}

ws.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
