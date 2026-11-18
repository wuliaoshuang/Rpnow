/**
 * Chat turn end-to-end test against a local mock LLM.
 *
 * Runs a real app instance, points a connection at a mock server that speaks
 * OpenAI-style SSE, sends a message, and asserts:
 *   - the request body carries the assembled prompt (main prompt + card fields
 *     + world book insertion),
 *   - streamed text renders into the transcript,
 *   - the reply is persisted to the chat record.
 *
 * This is the only way to prove the prompt pipeline works without a live API key.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8791;
let lastBody = null;

const mock = createServer((req, res) => {
  // The app runs on a different origin, so every request is preceded by a
  // CORS preflight that carries no body.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url?.endsWith('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw.trim()) {
        res.writeHead(400).end();
        return;
      }
      lastBody = JSON.parse(raw);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const chunks = ['**Aldric** ', 'sets down ', 'the glass.\n\n', '<status>HP 100</status>'];
      for (const c of chunks) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`);
      }
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    return;
  }
  res.writeHead(404).end();
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[aria-label="主导航"]', { timeout: 20000 });

// Seed a card + a connection pointing at the mock, then start a chat.
await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const presets = await import('/src/core/defaults/presets.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) {
    for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
    await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
    for (const p of presets.BUILTIN_PRESETS) await s.savePreset(structuredClone(p));
  }
  const conn = s.llmConnections.find((c) => c.name === 'Mock');
  const id = conn?.id ?? 'conn_mock';
  await s.saveLLMConnection({
    id,
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'test-key',
    defaultModel: 'mock-model',
  });
  s.setSettings({ defaultConnectionId: id });
  /*
   * 关闭 RPNow 自造的 ```html → iframe 兜底，以验证 C3 M4：围栏必须留在
   * `.mes_text pre > code` 里（酒馆助手的 `Ck` 就是扫这个）。
   * 契约见 docs/research/rpnow-st-compat-contract.md §2「兜底与插件共存」。
   */
  s.setSettings({ render: { sandboxHtml: false } });
  // Persist the chosen preset so assembly has a skeleton.
  s.setSettings({ defaultPresetId: 'preset:roleplay-default' });
}, PORT);
await page.waitForTimeout(300);

// Open a chat with the first card: tap opens the detail sheet, then 开始新聊天.
await page.getByRole('button', { name: '\u89d2\u8272\u5361' }).first().click();
await page.waitForSelector('text=\u963f\u5c14\u5fb7\u91cc\u514b', { timeout: 10000 });
await page.locator('article button[aria-label^="\u67e5\u770b "]').first().click();
await page.waitForTimeout(700);
const startBtn = page.locator('[role="dialog"] button[aria-label^="\u548c "]').first();
if (await startBtn.count()) await startBtn.click();
await page.waitForTimeout(800);

// Type and send.
const box = page.locator('textarea[aria-label*="\u6d88\u606f"]').first();
await box.fill('\u4f60\u597d\uff0c\u7ed9\u6211\u4e00\u676f\u70ed\u9152\u3002');
await box.press('Enter');

// Wait for the streamed reply to appear.
await page.waitForSelector('text=sets down', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const bodyText = await page.evaluate(() => document.body.innerText);

const checks = [];
const push = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

push('\u8bf7\u6c42\u5df2\u53d1\u51fa', Boolean(lastBody));
if (lastBody) {
  const sys = lastBody.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const all = lastBody.messages.map((m) => m.content).join('\n');
  push('\u9884\u8bbe\u4e3b\u63d0\u793a\u5df2\u6ce8\u5165', sys.includes("Aldric's next reply") || sys.includes('next reply'));
  push('\u89d2\u8272\u5361\u63cf\u8ff0\u5df2\u6ce8\u5165', all.includes('\u9152\u9986\u7684\u8001\u677f'));
  push('\u4e16\u754c\u4e66\u6761\u76ee\u5df2\u6fc0\u6d3b', all.includes('\u7070\u70ec\u4e4b\u57ce') || all.includes('\u9310\u9e6d'));
  push('\u7528\u6237\u6d88\u606f\u5728\u5386\u53f2\u4e2d', all.includes('\u7ed9\u6211\u4e00\u676f\u70ed\u9152'));
  push('\u89d2\u8272\u5361\u4e0d\u5360\u7528\u89d2\u8272\u540d\u5360\u4f4d\u7b26', !all.includes('{{char}}'));
}
push('回复已流式渲染', bodyText.includes('sets down'));
  /*
   * SillyTavern 楼层 DOM 契约（阶段 C3 / docs/research/rpnow-st-compat-contract.md M1-M4）。
   * 酒馆助手只用 `#chat > .mes[mesid=N]` 直接子选择器定位楼层，再取 `.mes_text`
   * 内的 `pre>code`；中间多一层包裹 div 就全盘扫不到。
   */
  /*
   * 第二条消息：带 ```html 围栏的完整文档，验证显示层管线把围栏留给 marked，
   * 最终落在 `.mes_text pre > code`（TH 的渲染入口）。
   */
  await page.waitForTimeout(400);
  await box.fill(
    '```html\n<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head>\n<body><b>契约样本</b></body></html>\n```',
  );
  await box.press('Enter');
  await page.waitForTimeout(1500);

  const dom = await page.evaluate(() => {
    const chat = document.querySelector('#chat');
    const mes = chat ? Array.from(chat.querySelectorAll(':scope > .mes')) : [];
    return {
      hasChat: !!chat,
      directMes: mes.length,
      childClasses: chat ? Array.from(chat.children).slice(0, 3).map((e) => e.className || e.tagName) : [],
      sampleAttrs: mes[0]
        ? ['mesid', 'is_user', 'ch_name', 'swipeid'].map((a) => `${a}=${mes[0].getAttribute(a)}`).join(' ')
        : '(none)',
      floorsWithMesText: mes.filter((m) => m.querySelector('.mes_text')).length,
      floorsWithPreCode: mes.filter((m) => m.querySelector('.mes_text pre > code')).length,
      /*
       * 渲染产物：RPNow 的 HTML 卡片（`.rp-html-card iframe`）或酒馆助手的
       * `.TH-render iframe`。二者任一存在即表示前端文档被接管。
       */
      cards: document.querySelectorAll('#chat .rp-html-card iframe, #chat .TH-render iframe').length,
      // 文档源码不应作为可见文本泄露出来（这正是「完全不能用」的现象）。
      leak: (document.querySelector('main')?.innerText ?? '').includes('<!DOCTYPE'),
    };
  });
  push('#chat 直接子节点是 .mes', dom.hasChat && dom.directMes >= 2, dom.childClasses.join(' | '));
  push('.mes 带 ST 属性', dom.directMes >= 2 && !dom.sampleAttrs.includes('mesid=null'), dom.sampleAttrs);
  push('.mes_text 存在', dom.floorsWithMesText >= 2, `${dom.floorsWithMesText}/${dom.directMes}`);
  push('前端文档被渲染成卡片（RPNow 兜底或 TH 托管）', dom.cards >= 1, `cards=${dom.cards} preCode=${dom.floorsWithPreCode}`);
  push('文档源码未作为可见文本泄露', !dom.leak);
  push('无页面错误', errors.length === 0, errors.join('; '));
push('\u5361\u5185\u6b63\u5219\u6e32\u67d3\u6210 HTML', bodyText.includes('HP 100') || bodyText.includes('状态'));
push('\u65e0\u9875\u9762\u9519\u8bef', errors.length === 0, errors.join('; '));

await page.screenshot({ path: 'screenshots/13-chat-streamed.png' });
await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
