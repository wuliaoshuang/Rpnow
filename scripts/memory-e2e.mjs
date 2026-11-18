/**
 * End-to-end memory test.
 *
 * Stands up a mock provider that answers chat, summary and embedding requests,
 * enables memory, and asserts the whole chain:
 *   turn 1  -> summary written
 *   turn 2  -> old assistant text replaced by that summary in the request
 *   enhanced -> recall block appended to the newest user message
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8813;

/** Deterministic pseudo-embedding so recall is testable without a real model. */
function fakeEmbed(text) {
  const v = new Array(8).fill(0);
  if (/约定|承诺|兑现/.test(text)) v[0] = 1;
  if (/酒馆|老板|酒杯/.test(text)) v[1] = 1;
  if (/剑|冒险|旅程/.test(text)) v[2] = 1;
  if (!v.some((x) => x)) v[7] = 1;
  return v;
}

const calls = [];
let lastChatBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const url = req.url || '';

    if (url.includes('/embeddings')) {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      calls.push({ kind: 'embed', input });
      return send(res, { data: input.map(() => ({ index: 0, embedding: fakeEmbed(String(input[0])) })) });
    }

    if (url.includes('/chat/completions')) {
      const messages = body.messages ?? [];
      const isSummary = messages.some((m) => /记忆整理器|总结/.test(m.content || ''));
      calls.push({ kind: isSummary ? 'summary' : 'chat', body });

      // RPNow always streams (`complete` forces stream:true), so the mock must
      // answer with SSE when the request asks for it.
      const text = isSummary
        ? '他答应明晚回到酒馆。'
        : '她推开门，风铃响了一声。';
      if (body.stream) {
        if (!isSummary) lastChatBody = body;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (!isSummary) lastChatBody = body;
      return send(res, {
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      });
    }

    res.writeHead(404).end();
  });
});

function send(res, json) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
}

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

// Seed a card, a persona and a mock connection, then expose the store.
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
// Let the seeded cards propagate into the library, then keep going without a
// reload (a reload would drop the test's window hook).
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 15000 });
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 15000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(800);

// Enable classic memory with a small keep-window so replacement triggers.
await page.evaluate(() => {
  const store = window.__rpnowStore;
  store.getState().setSettings({
    memory: { ...store.getState().settings.memory, mode: 'classic', keepRecentRounds: 1 },
  });
});

// Open a chat.
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 10000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start2 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start2.count()) await __start2.first().click();
await page.waitForTimeout(1500);

const sendMsg = async (text) => {
  const box = page.locator('textarea[aria-label="消息输入框"]').first();
  await box.fill(text);
  await box.press('Enter');
  await page.waitForTimeout(2500);
};

await sendMsg('今晚的约定，你还记得吗？');

const after1 = await page.evaluate(async () => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  // Drive the service directly to see its error, not just its silent catch.
  let diag = null;
  try {
    const engine = await import('/src/core/memory/engine.ts');
    const rounds = engine.buildRounds(chat?.messages ?? []);
    diag = {
      messageCount: chat?.messages?.length ?? 0,
      roles: chat?.messages?.map((m) => m.role) ?? [],
      roundCount: rounds.length,
      lastRound: rounds[rounds.length - 1]
        ? { turn: rounds[rounds.length - 1].turn, hasUser: Boolean(rounds[rounds.length - 1].user), hasAssistant: Boolean(rounds[rounds.length - 1].assistant) }
        : null,
    };
    const { MemoryService } = await import('/src/features/memory/service.ts');
    const svc = new MemoryService({
      llm: store.kernel.get('llm'),
      connections: store.llmConnections,
      settings: store.settings.memory,
      load: (id) => window.__rpnowStore.getState().memories[id] ?? [],
      save: (id, r) => window.__rpnowStore.getState().saveMemories(id, r),
    });
    const rec = await svc.summariseNewestRound({
      chat,
      card: store.cards.find((c) => c.id === chat.cardId),
      personaName: (store.personas[0]?.name) || '用户',
      fallbackConnectionId: store.settings.defaultConnectionId,
    });
    diag.result = rec ? { turn: rec.turn, summary: rec.summary } : 'returned null';
  } catch (e) {
    diag = 'ERROR: ' + (e?.message ?? String(e));
  }
  return {
    chatId: chat?.id,
    activeChatId: store.activeChatId,
    memoryKeys: Object.keys(store.memories),
    mode: store.settings.memory.mode,
    connections: store.llmConnections.map((c) => c.id),
    memories: store.memories[chat?.id] ?? [],
    chatMessages: chat?.messages.map((m) => ({ role: m.role, content: m.content })) ?? [],
    diag,
  };
});

console.log('diag:', JSON.stringify(after1.diag));
console.log('state:', JSON.stringify({ chatId: after1.chatId, active: after1.activeChatId, keys: after1.memoryKeys, mode: after1.mode, conns: after1.connections }));

check('生成了总结记忆', after1.memories.length === 1, JSON.stringify(after1.memories.map((m) => m.summary)));
// The opening message is an assistant floor, so the first user round is turn 2.
check('总结写的是第 2 轮', after1.memories[0]?.turn === 2, `turn=${after1.memories[0]?.turn}`);
check('总结请求已发出', calls.some((c) => c.kind === 'summary'), `${calls.filter((c) => c.kind === 'summary').length} 次`);
check('原始聊天记录未被改写', after1.chatMessages.some((m) => m.content.includes('风铃')), '');

// Second turn: the old assistant text must be replaced by the summary.
await sendMsg('那我们明晚在老地方见。');

const flat = (lastChatBody?.messages ?? []).map((m) => `${m.role}:${m.content}`).join('\n');
check('第二轮请求里旧正文被总结替换', flat.includes('他答应明晚回到酒馆') && !flat.includes('风铃响了一声'), '');

// Enhanced mode: recall block must appear.
await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  store.setSettings({
    memory: {
      ...store.settings.memory,
      mode: 'enhanced',
      vectorModel: 'mock-embed',
      vectorConnectionId: 'conn_mock',
      keepRecentRounds: 20,
    },
  });
});

await sendMsg('明晚的约定，地方定在哪里？');

const enhancedFlat = (lastChatBody?.messages ?? []).map((m) => m.content).join('\n');
check('增强模式注入召回块', enhancedFlat.includes('<enhanced_memory_recall>'), '');
check('召回块包含记忆编号', /id="M\d+"/.test(enhancedFlat), '');
check('召回块包含总结内容', enhancedFlat.includes('他答应明晚回到酒馆'), '');
check('向量化请求已发出', calls.some((c) => c.kind === 'embed'), `${calls.filter((c) => c.kind === 'embed').length} 次`);

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
