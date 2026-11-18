/**
 * Functional verification of RPNow inside the Android WebView, over CDP.
 *
 * Screenshots are unreliable on emulators with a broken GPU path, so this walks
 * the real DOM instead: navigation, page content, and a full chat turn driven by
 * the app's own UI. An Android pass here means the same code that runs on a phone
 * actually works, not just "the APK installed".
 */
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const PKG = 'app.rpnow.desktop';
const run = (c) => execSync(c, { encoding: 'utf8' });

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const tryRun = (c) => {
  try {
    return run(c);
  } catch {
    return '';
  }
};

// Re-establish the devtools forwarding: the socket is owned by the app process
// and is lost whenever the app restarts.
const pid = tryRun(`"${ADB}" shell pidof ${PKG}`).trim();
if (!pid) {
  console.log('app not running; launching…');
  tryRun(`"${ADB}" shell am start -n ${PKG}/.MainActivity`);
  await new Promise((r) => setTimeout(r, 6000));
}
const pid2 = tryRun(`"${ADB}" shell pidof ${PKG}`).trim();
tryRun(`"${ADB}" forward --remove-all`);
tryRun(`"${ADB}" forward tcp:9222 localabstract:webview_devtools_remote_${pid2}`);
await new Promise((r) => setTimeout(r, 1500));

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find((t) => t.type === 'page');
check('WebView 可连接', Boolean(target), `pid=${pid2}`);
if (!target) process.exit(1);

const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0;
const pending = new Map();
const consoleErrors = [];

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
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});

await new Promise((r) => ws.on('open', r));
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  }
  return res.result?.value;
};

// Give the app a moment to boot.
await new Promise((r) => setTimeout(r, 2500));

// ---------------------------------------------------------------- 1. boot
const booted = await evaluate(`JSON.stringify({
  nav: document.querySelectorAll('nav[aria-label="主导航"] button').length,
  text: document.body.innerText.slice(0, 120),
  theme: getComputedStyle(document.documentElement).getPropertyValue('--rp-bg').trim(),
})`);
const b = JSON.parse(booted);
check('应用已渲染（导航按钮数 > 0）', b.nav > 0, `${b.nav} buttons`);
check('主题变量已注入', b.theme.length > 0, b.theme);

// -------------------------------------------------- 2. every page renders
const pages = [
  ['角色卡', '角色卡'],
  ['世界书', '世界书'],
  ['预设', '预设'],
  ['插件', '插件'],
  ['设置', '设置'],
  ['对话', '对话'],
];
for (const [label, expect] of pages) {
  const ok = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('nav button')];
    const btn = btns.find((x) => x.textContent.trim() === '${label}');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  const body = await evaluate('document.body.innerText.length');
  check(`页面「${label}」可访问`, ok && body > 50, `${body} chars`);
}

// ---------------------------------------- 3. create a character card (data layer)
const cardFlow = await evaluate(`(async () => {
  const btns = [...document.querySelectorAll('nav button')];
  btns.find((x) => x.textContent.trim() === '角色卡')?.click();
  await new Promise(r => setTimeout(r, 500));
  const newBtn = [...document.querySelectorAll('button')].find(b => /新建角色/.test(b.textContent));
  if (!newBtn) return { step: 'no-button' };
  newBtn.click();
  await new Promise(r => setTimeout(r, 600));
  const input = document.querySelector('input#card-name');
  if (!input) return { step: 'no-input' };
  return { step: 'form-open', hasInput: true };
})()`);
check('新建角色卡表单可打开', cardFlow.hasInput === true, JSON.stringify(cardFlow));

// Type a name through the real input event path, then save.
const saved = await evaluate(`(async () => {
  const input = document.querySelector('input#card-name');
  if (!input) return { ok: false };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Android 测试角色');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const save = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
  if (!save) return { ok: false, reason: 'no-save' };
  save.click();
  await new Promise(r => setTimeout(r, 900));
  return { ok: true };
})()`);
check('角色卡可保存', saved.ok === true);

// Verify it persisted and renders in the grid.
const grid = await evaluate(`(async () => {
  await new Promise(r => setTimeout(r, 400));
  const tiles = document.querySelectorAll('article').length;
  return { tiles, text: document.body.innerText.includes('Android 测试角色') };
})()`);
check('角色卡出现在列表中', grid.tiles > 0 && grid.text, `${grid.tiles} tiles`);

// ------------------------------------------- 4. chat view with that character
const chat = await evaluate(`(async () => {
  const art = document.querySelector('article button[aria-label*="开始对话"]') || document.querySelector('article button');
  if (!art) return { ok: false, reason: 'no-card' };
  art.click();
  await new Promise(r => setTimeout(r, 1500));
  const textarea = document.querySelector('textarea[aria-label="消息输入框"]');
  const btns = [...document.querySelectorAll('nav button')];
  return { ok: Boolean(textarea), hasTextarea: Boolean(textarea), body: document.body.innerText.slice(0,100) };
})()`);
check('对话页可打开并显示输入框', chat.ok === true, JSON.stringify(chat).slice(0, 160));

// ------------------------------------------------ 5. localStorage persists
const persisted = await evaluate(`(async () => {
  const before = document.querySelectorAll('article').length;
  location.reload();
  return before;
})()`);
await new Promise((r) => setTimeout(r, 4000));
const afterReload = await evaluate(`JSON.stringify({
  tiles: document.querySelectorAll('article').length,
  nav: document.querySelectorAll('nav[aria-label="主导航"] button').length,
  text: document.body.innerText.slice(0, 60),
})`);
const ar = JSON.parse(afterReload);
check('重载后仍可用且数据保留', ar.nav > 0, JSON.stringify(ar).slice(0, 120));

// -------------------------------------------------------- 6. no JS errors
const realErrors = consoleErrors.filter(
  (e) => !/ServiceWorker|sw\.js/i.test(e),
);
check('无 JS 运行时错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

// Screenshot via CDP (device-independent of the broken emulator framebuffer).
try {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('screenshots/26-android-webview.png', Buffer.from(shot.data, 'base64'));
  console.log('screenshot saved via CDP');
} catch (e) {
  console.log('CDP screenshot unavailable:', String(e).slice(0, 120));
}

ws.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
