/**
 * Seeds a character card on the device, opens a chat, and verifies the mobile
 * composer hint. Cards must exist for the composer to render.
 */
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const PKG = 'app.rpnow.desktop';
const SERIAL = process.env.ADB_SERIAL ?? '2c2a3c4b';
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
tryRun(`${A} forward --remove-all`);
tryRun(`${A} forward tcp:9227 localabstract:webview_devtools_remote_${pid}`);
await new Promise((r) => setTimeout(r, 1200));
const list = await (await fetch('http://127.0.0.1:9227/json/list')).json();
const page = list.find((t) => t.type === 'page');
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

// Create a card through the real UI (identity tab only needs a name).
const made = await evalJs(`(async () => {
  const nav = [...document.querySelectorAll('nav[aria-label="底部导航"] button')];
  nav.find(b => b.textContent.trim() === '角色卡')?.click();
  await new Promise(r => setTimeout(r, 900));
  if (document.querySelectorAll('article').length > 0) return { existing: true };

  const newBtn = [...document.querySelectorAll('button')].find(b => /新建角色/.test(b.textContent));
  if (!newBtn) return { error: 'no new button' };
  newBtn.click();
  await new Promise(r => setTimeout(r, 900));
  const input = document.querySelector('input#card-name');
  if (!input) return { error: 'no name input' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '真机测试角色');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存')?.click();
  await new Promise(r => setTimeout(r, 1500));
  return { created: true, tiles: document.querySelectorAll('article').length };
})()`);
console.log('seed:', JSON.stringify(made));

// Open the first card -> chat.
await evalJs(`(() => { const a = document.querySelector('article button'); if (a) a.click(); })()`);
await new Promise((r) => setTimeout(r, 2500));

const info = await evalJs(`(() => {
  const ta = document.querySelector('textarea[aria-label="消息输入框"]');
  return {
    hasTextarea: Boolean(ta),
    placeholder: ta ? ta.placeholder : null,
    url: location.href,
    bodyLen: document.body.innerText.length,
  };
})()`);
console.log(JSON.stringify(info, null, 2));

check('对话页渲染出输入框', info.hasTextarea, info.placeholder ?? '');
check('移动端不显示 Enter/Shift+Enter 提示', Boolean(info.placeholder) && !/Enter|Shift/.test(info.placeholder ?? ''), info.placeholder ?? '');
check('仍显示身份引导文案', /说点什么/.test(info.placeholder ?? ''));

// Screenshot from the device itself (CDP frames can be stale on this phone).
tryRun(`${A} shell screencap -p /sdcard/chat.png`);
tryRun(`${A} pull /sdcard/chat.png screenshots/36-real-chat-composer.png`);

ws.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
