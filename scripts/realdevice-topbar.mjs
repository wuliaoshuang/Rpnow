/**
 * Real-device verification of the two UI fixes:
 *   1. connection panel button shares the top bar with the settings gear and is
 *      clear of the status bar,
 *   2. installing the `.rpnx` package activates it with no reload.
 */
import { execSync } from 'node:child_process';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const PKG = 'app.rpnow.desktop';
const SERIAL = '2c2a3c4b';
const A = `"${ADB}" -s ${SERIAL}`;
const tryRun = (c) => {
  try {
    return execSync(c, { encoding: 'utf8' });
  } catch {
    return '';
  }
};

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const pid = tryRun(`${A} shell pidof ${PKG}`).trim();
check('应用运行中', Boolean(pid), `pid=${pid}`);
if (!pid) process.exit(1);

tryRun(`${A} forward --remove-all`);
tryRun(`${A} forward tcp:9230 localabstract:webview_devtools_remote_${pid}`);
await new Promise((r) => setTimeout(r, 1500));

let targets = [];
try {
  targets = await (await fetch('http://127.0.0.1:9230/json/list')).json();
} catch {
  /* ignore */
}
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.log('无法附加（需要 debug 包）');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
});
await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');
const evalJs = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

await new Promise((r) => setTimeout(r, 2000));

/* ------------------------------------------------------- 1. top bar layout */
const layout = await evalJs(`(() => {
  const header = document.querySelector('header');
  const gear = header?.querySelector('button[aria-label="设置"]');
  const conn = header?.querySelector('button[aria-label="打开连接面板"]');
  const r = (el) => { if(!el) return null; const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }; };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return { header: r(header), gear: r(gear), conn: r(conn), inset, vw: window.innerWidth };
})()`);
console.log('layout:', JSON.stringify(layout));

check('设置按钮在顶栏内', Boolean(layout.gear), JSON.stringify(layout.gear));
check('连接面板按钮在顶栏内', Boolean(layout.conn), JSON.stringify(layout.conn));
check(
  '两个按钮同一行',
  Boolean(layout.gear && layout.conn) && Math.abs(layout.gear.top - layout.conn.top) <= 2,
  layout.gear && layout.conn ? `gear=${layout.gear.top} conn=${layout.conn.top}` : '',
);
check(
  '按钮位于状态栏之下',
  Boolean(layout.gear) && layout.gear.top >= layout.inset,
  `gear.top=${layout.gear?.top}, inset=${layout.inset}`,
);

// Panel opens below the bar.
await evalJs(`(() => { document.querySelector('button[aria-label="打开连接面板"]')?.click(); })()`);
await new Promise((r) => setTimeout(r, 800));
const panel = await evalJs(`(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="连接与货单"]');
  if (!dlg) return null;
  const b = dlg.getBoundingClientRect();
  const h = document.querySelector('header').getBoundingClientRect();
  return { top: Math.round(b.top), headerBottom: Math.round(h.bottom) };
})()`);
console.log('panel:', JSON.stringify(panel));
check('连接面板在顶栏下方展开', Boolean(panel) && panel.top >= panel.headerBottom - 4, JSON.stringify(panel));
await tryRun(`${A} shell screencap -p /sdcard/tb.png`);
await tryRun(`${A} pull /sdcard/tb.png screenshots/40-real-topbar.png`);

/* ------------------------------------------------ 2. install with no reload */
const b64 = readFileSync('release/rpnow.tts.mimo.rpnx').toString('base64');
const inst = await evalJs(`(async () => {
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const boot = await import('/src/boot.ts');
  const store = { useApp: window.__rpnowStore };
  const kernel = store.useApp.getState().kernel;

  const bin = atob(${JSON.stringify(b64)});
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const parsed = await rpnx.parseRpnx(new Blob([bytes]));
  await rpnx.install(parsed, true);
  await boot.reloadInstalledPlugins();

  const rec = kernel.record('rpnow.tts.mimo');
  return { state: rec?.state, hasTts: Boolean(kernel.get('tts')), label: kernel.get('tts')?.label ?? null };
})()`);
console.log('install:', JSON.stringify(inst));
check('安装后立即激活（真机，无刷新）', inst.state === 'active' && inst.hasTts === true, JSON.stringify(inst));

// The speaker button must appear on the current chat without a reload.
await evalJs(`(() => { document.querySelector('button[aria-label="关闭"]')?.click(); })()`);
await new Promise((r) => setTimeout(r, 500));
const speakers = await evalJs(`document.querySelectorAll('[aria-label="朗读这条消息"]').length`);
check('朗读按钮出现（无需刷新）', speakers > 0, `${speakers} 个`);

tryRun(`${A} shell screencap -p /sdcard/final.png`);
tryRun(`${A} pull /sdcard/final.png screenshots/41-real-final.png`);

ws.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
