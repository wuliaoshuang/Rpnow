/**
 * End-to-end test of the MiMo TTS plugin.
 *
 * Stands up a mock server that speaks MiMo's actual protocol (TTS via
 * /v1/chat/completions with an `audio` field, base64 in
 * `choices[0].message.audio.data`), installs the real `.rpnx` package, checks the
 * speaker button appears, drives it, and asserts on the request the plugin sent.
 *
 * This validates the integration contract, not the audio itself (a synthesised
 * WAV is returned so playback has something real to play).
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const PORT = 8811;
const CDP_APP = 'http://127.0.0.1:5173/';

/* ------------------------------------------------------------------ mock */
/** A tiny valid 8-bit mono WAV of 0.2s silence, built by hand. */
function silentWav() {
  const sampleRate = 8000;
  const numSamples = 1600;
  const dataSize = numSamples;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44); // silence for unsigned 8-bit
  return buf.toString('base64');
}

let lastRequest = null;
let requestCount = 0;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, api-key');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requestCount++;
      lastRequest = {
        body: JSON.parse(raw || '{}'),
        headers: req.headers,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '', audio: { data: silentWav() } },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      );
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

/* ----------------------------------------------------------------- helper */
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
// --autoplay-policy allows Audio.play() without a gesture in headless Chrome.
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: [],
  args: [],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(CDP_APP, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 25000 });
await page.waitForTimeout(800);

/* ------------------------------------------- install the real .rpnx package */
const rpnxB64 = readFileSync('release/rpnow.tts.mimo.rpnx').toString('base64');
const installed = await page.evaluate(async (b64) => {
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const store = { useApp: window.__rpnowStore };
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/zip' });

  const parsed = await rpnx.parseRpnx(blob);
  await rpnx.install(parsed, true);

  // Register + activate through the real module path.
  const { toModuleUrl } = rpnx;
  const { url } = toModuleUrl(parsed.code);
  const mod = await import(/* @vite-ignore */ url);
  const kernel = store.useApp.getState().kernel;
  kernel.register(parsed.manifest, async () => ({ manifest: parsed.manifest, apply: mod.apply }), 'installed');
  await kernel.sync();
  return {
    id: parsed.manifest.id,
    state: kernel.record(parsed.manifest.id)?.state,
    hasTts: Boolean(kernel.get('tts')),
  };
}, rpnxB64);

check('插件解析并安装', installed.id === 'rpnow.tts.mimo');
check('插件激活', installed.state === 'active', installed.state);
check('tts 服务已注册', installed.hasTts === true);

/* ------------------------------------------------- configure via the plugin */
await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  s.setSettings({
    pluginConfig: {
      ...s.settings.pluginConfig,
      'rpnow.tts.mimo': {
        apiKey: 'tp-test-key-123',
        baseURL: `http://127.0.0.1:${port}/v1`,
        model: 'mimo-v2.5-tts',
        voice: '冰糖',
        format: 'wav',
        instruction: '语气温柔',
      },
    },
  });
}, PORT);

/* --------------------------------------------- speaker button on messages */
// Seed a message and open a chat so a bubble exists.
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 25000 });
await page.waitForTimeout(1000);

// After reload the kernel re-registers installed plugins itself, so only
// register manually if it is not already known.
await page.evaluate(async (b64) => {
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const store = { useApp: window.__rpnowStore };
  const kernel = store.useApp.getState().kernel;
  if (kernel.record('rpnow.tts.mimo') && kernel.get('tts')) return;

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const parsed = await rpnx.parseRpnx(new Blob([bytes]));
  const { toModuleUrl } = rpnx;
  const { url } = toModuleUrl(parsed.code);
  const mod = await import(/* @vite-ignore */ url);
  try {
    kernel.register(parsed.manifest, async () => ({ manifest: parsed.manifest, apply: mod.apply }), 'installed');
  } catch {
    /* already registered */
  }
  await kernel.sync();
}, rpnxB64);
await page.waitForTimeout(500);

const ttsAfterReload = await page.evaluate(async () => {
  const store = { useApp: window.__rpnowStore };
  const kernel = store.useApp.getState().kernel;
  return { hasTts: Boolean(kernel.get('tts')), state: kernel.record('rpnow.tts.mimo')?.state };
});
check('重载后插件仍生效', ttsAfterReload.hasTts === true, ttsAfterReload.state);

// Open the first chat.
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 10000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForTimeout(1500);

const speakerCount = await page.locator('[aria-label="朗读这条消息"]').count();
check('消息上出现朗读按钮', speakerCount > 0, `${speakerCount} 个`);

/* ---------------------------------------------------------- speak a message */
if (speakerCount > 0) {
  await page.locator('[aria-label="朗读这条消息"]').first().click();
  await page.waitForTimeout(2500);
}

check('已向 MiMo 接口发起请求', requestCount > 0, `${requestCount} 次`);

if (lastRequest) {
  const b = lastRequest.body;
  check('使用 chat/completions 协议', true);
  check('模型正确', b.model === 'mimo-v2.5-tts', b.model);
  check('包含 audio.voice', b.audio?.voice === '冰糖', String(b.audio?.voice));
  check('包含 audio.format', b.audio?.format === 'wav', String(b.audio?.format));
  const roles = (b.messages ?? []).map((m) => m.role);
  check('风格指令作为 user 消息', roles[0] === 'user', roles.join(','));
  const spoken = (b.messages ?? []).filter((m) => m.role === 'assistant').map((m) => m.content).join('');
  check('正文放在 assistant 消息', spoken.length > 0, spoken.slice(0, 60));
  check('朗读内容不含 HTML 标签', !/<[a-z/][^>]*>/i.test(spoken), spoken.slice(0, 60));
  check('朗读内容不含 CSS', !/color|font-/.test(spoken));
  const auth = lastRequest.headers['api-key'] ?? lastRequest.headers['authorization'];
  check('携带鉴权头', Boolean(auth), String(auth).slice(0, 20));
}

check('无 JS 报错', errors.filter((e) => !/ServiceWorker|sw\.js/.test(e)).length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'screenshots/27-tts-plugin.png' });
await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
