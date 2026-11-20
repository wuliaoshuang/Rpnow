/**
 * 小手机冒烟测试：390×844，假模型，跑最核心的一条通路——
 *   应用能打开 → 主聊天能发消息 → 打开小手机 → 主聊天模型只回剧情正文
 *   （没有隐藏块）时联系人能通过兜底更新 → 点开联系人能进微信聊天 →
 *   发一条微信消息角色能回。
 * 任何一步打不开、报错、白屏都算冒烟失败。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59993;
const BASE = 'http://127.0.0.1:5173/';

let failures = 0;
let passes = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passes++;
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.log(`  FAIL - ${name} ${extra}`);
  }
}

function sseReply(res, deltas, finishReason = 'stop') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  for (const d of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\n`);
  }
  res.write(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

// 只有剧情、没有隐藏块的回复：模型只写剧情时，兜底要从这段正文里认出小雨。
const PLOT_ONLY_REPLY =
  '小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”小雨又补充了一句：“记得带早餐。”';

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    return;
  }
  if (req.url?.endsWith('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const allText = (body.messages ?? []).map((m) => m.content ?? '').join('\n');
      // 小手机微信回复：带 tools 的请求，直接回一句纯文本（不调任何工具）。
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        sseReply(res, [{ content: '好呀，我带早餐过去。' }]);
        return;
      }
      // 记忆提炼：回一段空 JSON 摘要即可，主聊天流程需要它。
      if (allText.includes('下面是一段角色扮演对话的最近记录')) {
        sseReply(res, [{ content: '[]' }]);
        return;
      }
      const userMsgs = (body.messages ?? []).filter((m) => m.role === 'user');
      const lastUser = userMsgs[userMsgs.length - 1]?.content ?? '';
      if (lastUser.includes('小雨')) {
        sseReply(res, [{ content: PLOT_ONLY_REPLY }]);
        return;
      }
      sseReply(res, [{ content: '收到啦。' }]);
    });
    return;
  }
  res.writeHead(404).end();
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const phone = page.locator('.fixed.inset-0.z-\\[80\\]');

// ---- 1. 应用能打开（不是白屏） ----
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__rpnowStore, null, { timeout: 20000 });
await page.waitForTimeout(800);
check('应用能打开：store 就绪', true);
check(
  '应用能打开：页面有内容，不是白屏',
  (await page.locator('body').innerText()).trim().length > 20,
);

// Seed：卡 + 假模型连接 + 一本带小雨条目的世界书（兜底的名字表从这里来）。
await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const presets = await import('/src/core/defaults/presets.ts');
  const s = window.__rpnowStore.getState();
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
    apiKey: 'x',
    defaultModel: 'mock-model',
  });
  s.setSettings({ defaultConnectionId: id });
  s.setSettings({ onboardingCompleted: true });
  s.setSettings({ defaultPresetId: 'preset:roleplay-default' });
}, PORT);
await page.waitForTimeout(300);

await page.locator('button:has-text("阿尔德里克")').first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
await page.waitForTimeout(600);
check('主聊天能打开：输入框出现了', true);

const chatId = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const card = s.cards[0];
  const chats = s.chats.filter((c) => c.cardId === card.id);
  return chats[chats.length - 1]?.id ?? '';
});
check('拿到聊天 id', Boolean(chatId));
await page.evaluate(async (id) => {
  const s = window.__rpnowStore.getState();
  const { newEntry } = await import('/src/core/types/lorebook.ts');
  const book = {
    id: 'lb_smoke_chars',
    name: '测试人物',
    description: '',
    entries: [newEntry({ comment: '小雨', keys: ['小雨'], content: '在酒馆帮忙，想学调酒。' })],
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await s.saveLorebook(book);
  const chat = s.chats.find((c) => c.id === id);
  await s.saveChat({ ...chat, lorebookIds: [...(chat.lorebookIds ?? []), book.id] });
}, chatId);
await page.waitForTimeout(300);

async function sendMain(text, visibleText, timeoutMs = 30000) {
  const box = page.locator('textarea[aria-label="消息输入框"]').first();
  await box.fill(text);
  await box.press('Enter');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await page.locator(`text=${visibleText}`).count()) >= 1) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function readContacts() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:contacts:${id}`)) ?? [];
  }, chatId);
}

async function waitForContacts(pred, timeoutMs = 30000) {
  const start = Date.now();
  let contacts = [];
  while (Date.now() - start < timeoutMs) {
    contacts = await readContacts();
    if (pred(contacts)) return contacts;
    await page.waitForTimeout(400);
  }
  return contacts;
}

// ---- 2. 主聊天能发消息：模型只回剧情正文（没有隐藏块） ----
const sent = await sendMain('今天小雨来酒馆帮忙，她说想学调一杯新酒。', '我学会了一杯新的特调');
check('主聊天能发消息：只写剧情的回复流式出现了', sent);
const storedHasNoBlock = await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === id);
  const lastAssistant = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  return !(lastAssistant?.content ?? '').includes('[小手机数据]');
}, chatId);
check('模型只回了剧情正文，确实没有隐藏块', storedHasNoBlock);
await page.waitForTimeout(800);

// ---- 3. 打开小手机，联系人通过兜底更新 ----
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(300);
const contacts = await waitForContacts((cs) => cs.some((c) => c.name === '小雨'));
check(
  '打开小手机：只写剧情也认得出人，联系人里有小雨',
  contacts.some((c) => c.name === '小雨'),
  `实际 ${contacts.map((c) => c.name).join(',')}`,
);
check('微信列表里有小雨', await phone.locator('button:has-text("小雨")').count() >= 1);

// ---- 4. 点开联系人，能进微信聊天 ----
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(800);
check(
  '点开联系人能进微信聊天：能看到小雨的开场白',
  await phone.locator('text=我学会了一杯新的特调').count() >= 1,
);
check('微信聊天里有发消息输入框', await phone.getByPlaceholder('发消息…').count() >= 1);

// ---- 5. 发一条微信消息，角色能回 ----
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
let replied = false;
const replyStart = Date.now();
while (Date.now() - replyStart < 30000) {
  if ((await phone.locator('text=好呀，我带早餐过去。').count()) >= 1) {
    replied = true;
    break;
  }
  await page.waitForTimeout(400);
}
check('发一条微信消息，角色回了', replied);
check('自己发的那句也在聊天记录里', await phone.locator('text=今天好累').count() >= 1);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\nsmoke: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
