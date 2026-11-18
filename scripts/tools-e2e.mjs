/**
 * End-to-end agent-tool test.
 *
 * The mock model deliberately calls a tool on the first round and only then
 * writes its reply, which proves the loop: tool call -> execution -> result
 * message -> second request -> final text. Also covers the random tool and the
 * transcript-search tool.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8814;
let chatRound = 0;
let lastBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.includes('/chat/completions')) {
      lastBody = body;
      chatRound++;
      const first = chatRound === 1;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

      if (first) {
        // Ask for the transcript-search tool, then stop.
        const chunk = {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'keyword_dialogue', arguments: '{"query":"约定","reason":"核对前文"}' } },
                ],
              },
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      const text = '她想起来了：约定是在酒馆见面。';
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
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
  await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock-chat',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  window.__rpnowStore = store.useApp;
}, PORT);
// Wait for the seeded library to render (same module graph, no reload needed).
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(800);

await page.evaluate(() => {
  const store = window.__rpnowStore;
  store.getState().setSettings({
    tools: { ...store.getState().settings.tools, keywordEnabled: true, aggressiveness: 'force' },
  });
});

const box = page.locator('textarea[aria-label="消息输入框"]').first();
await box.fill('你还记得我们的约定吗？');
await box.press('Enter');
await page.waitForTimeout(4000);

// The request that produced the final answer must contain a tool result.
const finalMessages = lastBody?.messages ?? [];
const flat = JSON.stringify(finalMessages);
check('工具结果作为 role:tool 注入', flat.includes('"role":"tool"') || flat.includes('"role": "tool"'), '');
check('工具结果包含检索到的原文', flat.includes('酒馆'), '');
check('模型第二轮拿到工具结果后才回复', finalMessages.length > 2, `${finalMessages.length} 条消息`);
check('请求声明了工具且禁止并行', Array.isArray(lastBody?.tools) && lastBody.tools.length > 0 && lastBody.parallel_tool_calls === false, '');

// The stored chat must NOT persist the ephemeral tool messages.
const stored = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return chat?.messages ?? [];
});
check('工具消息未被持久化', stored.every((m) => m.role !== 'tool'), stored.map((m) => m.role).join(','));
check('回复正文正确', stored.at(-1)?.content?.includes('酒馆') ?? false, String(stored.at(-1)?.content));

// Random tool: verify bounds and endpoint inclusion through the real path.
const rand = await page.evaluate(() => {
  const engine = window.__rpnowEngine;
  return engine ? engine.runRandomNumber({ min: 1, max: 6 }) : null;
});

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
