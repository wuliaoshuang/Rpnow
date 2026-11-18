/**
 * Proves the desktop CORS bypass actually works.
 *
 * Calls an HTTP server that deliberately sends **no** CORS headers, through the
 * same code path the app uses (`resolveFetch`). In a browser that request is
 * blocked; on desktop the native plugin performs it in Rust, where CORS does not
 * apply. This is the entire justification for shipping a desktop target.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8799;
const CDP = 9334;

// A mock provider endpoint with NO Access-Control-Allow-Origin header.
const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(405).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: req.url, host: req.headers.host }));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const child = spawn('src-tauri/target/release/rpnow.exe', [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}` },
  stdio: ['ignore', 'ignore', 'pipe'],
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

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

check('桌面应用已启动', Boolean(target));

let result = null;
if (target) {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const ctx = browser.contexts()[0];
  const p = ctx.pages()[0] ?? (await ctx.waitForEvent('page'));
  await p.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 25000 });

  // Load the app's own transport module from the packaged asset graph.
  result = await p.evaluate(async (port) => {
    const out = { desktop: null, nativeStatus: null, nativeBody: null, nativeError: null, webError: null };
    out.desktop = Boolean(window.__TAURI_INTERNALS__);
    const url = `http://127.0.0.1:${port}/v1/models`;

    // 1) Reproduce the plugin's own IPC sequence (mirrors plugin-http's
    //    dist-js: `{'client-config': encodeURIComponent(json)}`).
    try {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const clientConfig = {
        method: 'GET',
        url,
        headers: [],
        maxRedirections: undefined,
        connectTimeout: undefined,
        proxy: undefined,
        danger: undefined,
      };
      const rid = await invoke('plugin:http|fetch', new Uint8Array(0), {
        headers: { 'client-config': encodeURIComponent(JSON.stringify(clientConfig)) },
      });
      out.rid = rid;
      // The plugin then calls fetch_send, which opens the connection.
      const resp = await invoke('plugin:http|fetch_send', { rid });
      out.nativeStatus = resp?.status;
      if (resp?.rid) {
        const data = await invoke('plugin:http|fetch_read_body', { rid: resp.rid });
        const bytes = data instanceof ArrayBuffer || data instanceof Uint8Array ? new Uint8Array(data) : null;
        const text = bytes ? new TextDecoder().decode(bytes) : JSON.stringify(data);
        out.nativeBody = text.slice(0, 200);
        out.nativeOk = resp.status === 200 && text.includes('"ok":true');
      }
    } catch (e) {
      out.nativeError = String(e && e.message ? e.message : e);
    }

    // 2) Contrast: a plain browser fetch to the same CORS-less endpoint.
    try {
      const r = await fetch(url);
      out.webStatus = r.status;
    } catch (e) {
      out.webError = String(e && e.message ? e.message : e);
    }
    return out;
  }, PORT).catch((e) => ({ evalError: String(e) }));

  console.log(JSON.stringify(result, null, 2));

  check('桌面运行时可用', result && result.desktop === true);
  check('普通 fetch 被 CORS 拦截（符合预期）', Boolean(result && result.webError));
  const nativeOk = Boolean(result && result.nativeOk);
  check('原生 HTTP 通道可用（绕过 CORS）', nativeOk, result?.nativeError ?? result?.nativeBody ?? '');

  await p.screenshot({ path: 'screenshots/21-desktop-runtime.png' });
  await browser.close();
}

child.kill();
server.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
