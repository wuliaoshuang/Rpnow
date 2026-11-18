/**
 * Gemini anti-truncation end-to-end.
 *
 * The mock model submits its body through the `output_reply` tool on the first
 * attempt and returns an empty tool payload on the second, proving both the
 * tool path and the retry.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8820;
let attempts = 0;
let lastBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      lastBody = JSON.parse(raw || '{}');
      attempts++;
      const content = attempts === 1 ? '' : '她把伞递了过来，说：「一起走吧。」';
      const chunk =
        content === ''
          ? { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'output_reply', arguments: '{}' } }] } }] }
          : {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'c1',
                        type: 'function',
                        function: { name: 'output_reply', arguments: JSON.stringify({ content }) },
                      },
                    ],
                  },
                },
              ],
            };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404).end();
  });
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'gemini-2.5-pro',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  s.setSettings({ chat: { ...store.useApp.getState().settings.chat, preventTruncation: true } });
  window.__rpnowStore = store.useApp;
}, PORT);

await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(800);

const box = page.locator('textarea[aria-label="消息输入框"]').first();
await box.fill('雨下得很大');
await box.press('Enter');
await page.waitForTimeout(5000);

check('模型是 Gemini（触发抗截断）', /gemini/i.test(lastBody?.model ?? ''), String(lastBody?.model));
check('请求强制调用工具', lastBody?.tool_choice === 'required', String(lastBody?.tool_choice));
const toolText = JSON.stringify(lastBody?.tools ?? []);
check('声明了 output_reply', toolText.includes('output_reply'), toolText.slice(0, 80));
check('空回触发了重试', attempts >= 2, `${attempts} 次请求`);

const stored = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return chat?.messages.at(-1)?.content ?? '';
});
check('最终正文来自工具', stored.includes('一起走吧'), stored.slice(0, 40));

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
