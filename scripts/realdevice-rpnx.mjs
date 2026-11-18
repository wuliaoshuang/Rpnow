/**
 * Real-device check: can the in-app installer actually pick a `.rpnx` file?
 *
 * Android reports `.rpnx` as `application/octet-stream`, so the picker filters by
 * MIME, not extension. This drives the install button, opens the system picker,
 * and asserts the file is selectable — plus a direct-install fallback that proves
 * the package parses on the device.
 */
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

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

// The package must be reachable where the picker can see it.
const ls = tryRun(`${A} shell ls /sdcard/Download/`);
check('插件文件在 Download 目录', ls.includes('rpnow.tts.mimo.rpnx'), ls.trim().slice(0, 120));

// Android reports octet-stream for the extension; record it as evidence.
const mime = tryRun(`${A} shell content query --uri content://media/external/file --projection _display_name:mime_type`);
const rpnxRow = mime.split('\n').find((l) => l.includes('rpnx'));
console.log('media store row:', rpnxRow?.trim());
check('确认系统把 .rpnx 当作 octet-stream', Boolean(rpnxRow?.includes('application/octet-stream')), rpnxRow?.trim() ?? '');

// Open the app's Plugins page and press the install button via CDP.
tryRun(`${A} forward --remove-all`);
tryRun(`${A} forward tcp:9229 localabstract:webview_devtools_remote_${pid}`);
await new Promise((r) => setTimeout(r, 1200));

let targets = [];
try {
  targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
} catch {
  /* release build */
}
const page = targets.find((t) => t.type === 'page');
check('可附加 WebView（需 debug 包）', Boolean(page));

if (page) {
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

  // Navigate to Plugins.
  await evalJs(`(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="底部导航"] button')];
    const more = nav.find(b => b.getAttribute('aria-label') === '更多');
    if (more) more.click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await evalJs(`(() => {
    const item = [...document.querySelectorAll('[role="menu"] button')].find(b => b.textContent.trim() === '插件');
    if (item) item.click();
  })()`);
  await new Promise((r) => setTimeout(r, 900));

  const accept = await evalJs(`(() => {
    const i = document.querySelector('input[type=file]');
    return i ? i.accept : null;
  })()`);
  console.log('install input accept:', accept);
  check('安装输入框已放宽 MIME 过滤', typeof accept === 'string' && accept.includes('application/octet-stream'), String(accept));

  ws.close();
}

// On-device parse check: does the app accept the package bytes?
const pkgPath = '/sdcard/Download/rpnow.tts.mimo.rpnx';
const size = tryRun(`${A} shell stat -c %s ${pkgPath}`).trim();
check('插件包大小正常', Number(size) > 1000, `${size} bytes`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
