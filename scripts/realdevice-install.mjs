/**
 * Real-device install flow: open the picker from the app, select the `.rpnx`
 * package, and confirm it activates without a reload.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const pid = tryRun(`${A} shell pidof ${PKG}`).trim();
tryRun(`${A} forward --remove-all`);
tryRun(`${A} forward tcp:9231 localabstract:webview_devtools_remote_${pid}`);
await sleep(1500);
const list = await (await fetch('http://127.0.0.1:9231/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('no page');
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

// Dismiss any overlay left open by a previous run before navigating.
await evalJs(`(() => {
  document.querySelector('button[aria-label="关闭"]')?.click();
  document.querySelector('button[aria-label="关闭连接面板"]')?.click();
})()`);
await sleep(600);

// Go to the plugins page through the bottom nav's "更多" sheet.
await evalJs(`(() => {
  const more = document.querySelector('nav[aria-label="底部导航"] button[aria-label="更多"]');
  more?.click();
})()`);
await sleep(800);
await evalJs(`(() => {
  const item = [...document.querySelectorAll('[role="menu"] button')].find(b => b.textContent.trim() === '插件');
  item?.click();
})()`);
await sleep(1200);

const onPlugins = await evalJs(`document.body.innerText.includes('已安装')`);
check('进入插件页', onPlugins);

// Press the install button; the system picker should open.
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('安装 .rpnx'));
  btn?.click();
})()`);
await sleep(3000);

// Inspect the picker: is the .rpnx file listed and selectable?
tryRun(`${A} shell uiautomator dump /sdcard/picker.xml`);
const xml = tryRun(`${A} shell cat /sdcard/picker.xml`);
const texts = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
console.log('picker texts:', texts.slice(0, 20).join(' | '));
tryRun(`${A} shell screencap -p /sdcard/picker2.png`);
tryRun(`${A} pull /sdcard/picker2.png screenshots/42-real-picker.png`);

const listed = texts.some((t) => t.includes('rpnx'));
check('选择器中能看到 .rpnx 文件', listed, texts.slice(0, 8).join(' | '));

// Try to tap it if visible.
if (listed) {
  const m = new RegExp(`text="([^"]*rpnx[^"]*)"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(xml);
  if (m) {
    const cx = Math.round((Number(m[2]) + Number(m[4])) / 2);
    const cy = Math.round((Number(m[3]) + Number(m[5])) / 2);
    tryRun(`${A} shell input tap ${cx} ${cy}`);
    await sleep(3000);
  }
}

// Back in the app: is the plugin listed and active?
const after = await evalJs(`(() => {
  const text = document.body.innerText;
  return {
    hasPluginName: text.includes('MiMo TTS'),
    hasActive: text.includes('运行中'),
    snippet: text.slice(0, 200),
  };
})()`);
console.log('after install:', JSON.stringify(after));
check('插件出现在列表', after.hasPluginName, after.snippet.slice(0, 80));
check('插件状态为运行中', after.hasActive);

tryRun(`${A} shell screencap -p /sdcard/after.png`);
tryRun(`${A} pull /sdcard/after.png screenshots/43-real-after-install.png`);

ws.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
