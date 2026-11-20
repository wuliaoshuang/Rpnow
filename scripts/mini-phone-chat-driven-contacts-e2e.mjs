/**
 * 小手机聊天驱动联系人端到端测试（聊天驱动联系人），390×844，假模型。
 *
 * 覆盖：联系人从主聊天的对话记录里来，不是世界书/卡里找来的——
 *   (a) 主聊天里提到小雨/阿杰 → 联系人里有小雨/阿杰；
 *   (b) 王阿姨只在世界书里、主聊天里没出现过 → 联系人里没有王阿姨；
 *   (c) 发给初始化模型的请求里有对话记录，没有世界书内容（王阿姨、
 *       每周三来收租），也没有卡的字段内容（银鹭酒馆）；
 *   (d) 主角名只在请求里出现一次（用来排除主角），联系人里没有主角。
 *
 * 假模型模拟“真的按聊天认人”：初始化请求里出现哪个名字，就返回哪个
 * 人的联系人——请求里没提到的名字，它也不会返回。所以 (b) 能成立，
 * 是因为初始化根本没把世界书内容发给模型，而不是因为假模型手下留情。
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

const llmBodies = [];
let initBodies = [];

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
      llmBodies.push(body);
      const allText = (body.messages ?? []).map((m) => m.content ?? '').join('\n');
      // 初始化：只认对话记录里出现过的名字，返回他们的联系人。
      if (allText.includes('角色卡解析助手')) {
        initBodies.push(body);
        const found = ['小雨', '阿杰', '王阿姨'].filter((n) => allText.includes(n));
        const contacts = {
          小雨: { name: '小雨', relation: '朋友', relationToMain: '同事', openingMessage: '在吗在吗，明天一早我就去开门', gender: 'female', profile: '在酒馆帮忙，手很稳，想学调酒' },
          阿杰: { name: '阿杰', relation: '朋友', relationToMain: '', openingMessage: '下周带一批新茶叶过来', gender: 'male', profile: '常来酒馆，总爱带东西' },
          王阿姨: { name: '王阿姨', relation: '', relationToMain: '房东', openingMessage: '房租该交了', gender: 'female', profile: '酒馆的房东' },
        };
        sseReply(res, [{ content: JSON.stringify(found.map((n) => contacts[n])) }]);
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

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__rpnowStore, null, { timeout: 20000 });

// Seed：卡 + 假模型连接。
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

// 拿到这个聊天的 chatId，往主聊天里种对话：小雨和阿杰出现过，王阿姨没有。
const chatId = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const card = s.cards[0];
  const chats = s.chats.filter((c) => c.cardId === card.id);
  return chats[chats.length - 1]?.id ?? '';
});
check('拿到聊天 id', Boolean(chatId));
await page.evaluate(async (id) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === id);
  const now = Date.now();
  const seeded = [
    { id: 'm-seed-1', role: 'user', content: '今天小雨来酒馆帮忙，她说想学调一杯新酒。', createdAt: now + 1 },
    { id: 'm-seed-2', role: 'assistant', content: '小雨手很稳，让她先从擦杯子学起，别急。', createdAt: now + 2 },
    { id: 'm-seed-3', role: 'user', content: '阿杰刚才也来了，说下周要带一批新茶叶过来。', createdAt: now + 3 },
    { id: 'm-seed-4', role: 'assistant', content: '阿杰每次来都带东西，让他别破费了。', createdAt: now + 4 },
    { id: 'm-seed-5', role: 'user', content: '小雨说明天一早就来开门，我让她多睡会儿。', createdAt: now + 5 },
  ];
  await s.saveChat({ ...chat, messages: [...(chat.messages ?? []), ...seeded] });
  // 世界书里放一个王阿姨：只在世界书里出现，主聊天里没提过她。
  // 注意：saveChat 之后 store 的 state 是新对象，这里直接在同一份
  // chat 对象上把 lorebookIds 也带上、一次存好，不要用旧的 s 再取一次
  // chat（取回来的是没种对话的旧对象，会把刚种的消息盖掉）。
  const { newEntry } = await import('/src/core/types/lorebook.ts');
  await s.saveLorebook({
    id: 'book-e2e-wang',
    name: '测试世界书',
    entries: [
      newEntry({
        comment: '王阿姨',
        keys: ['王阿姨'],
        content: '王阿姨是酒馆的房东，每周三来收租，喜欢喝热茶。',
      }),
    ],
    createdAt: now,
    updatedAt: now,
  });
  await s.saveChat({
    ...chat,
    messages: [...(chat.messages ?? []), ...seeded],
    lorebookIds: [...(chat.lorebookIds ?? []), 'book-e2e-wang'],
  });
}, chatId);
await page.waitForTimeout(300);

// 打开小手机 → 微信，等初始化跑完（联系人写进 IndexedDB）。
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
await phone.getByRole('button', { name: '微信' }).first().click();

async function readContacts() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:contacts:${id}`)) ?? [];
  }, chatId);
}
let contacts = [];
{
  const start = Date.now();
  while (Date.now() - start < 30000) {
    contacts = await readContacts();
    if (contacts.length > 0) break;
    await page.waitForTimeout(400);
  }
}

// ---- (c) 发给初始化模型的请求：有对话记录，没有世界书、没有卡的字段 ----
check('初始化模型被调了一次', initBodies.length >= 1, `初始化请求 ${initBodies.length} 个`);
const initText = (initBodies[0]?.messages ?? []).map((m) => m.content ?? '').join('\n');
check('初始化请求里有对话记录（小雨来酒馆帮忙）', initText.includes('小雨来酒馆帮忙'));
check('初始化请求里有对话记录（阿杰带茶叶）', initText.includes('阿杰刚才也来了'));
check('初始化请求里没有世界书里的人（王阿姨）', !initText.includes('王阿姨'));
check('初始化请求里没有世界书内容（每周三来收租）', !initText.includes('每周三来收租'));
check('初始化请求里没有卡的字段内容（银鹭酒馆）', !initText.includes('银鹭酒馆'));
check('初始化请求里有主角名（只用来排除主角）', initText.includes('阿尔德里克'));

// ---- (a)(b)(d) 联系人只来自对话：小雨/阿杰在，王阿姨和主角不在 ----
const names = contacts.map((c) => c.name).sort();
check('联系人是小雨和阿杰（只来自对话）', JSON.stringify(names) === JSON.stringify(['小雨', '阿杰']), `实际 ${names.join(',')}`);
check('联系人里没有王阿姨（只在世界书里的人不进联系人）', !names.includes('王阿姨'));
check('联系人里没有主角本人（阿尔德里克）', !names.includes('阿尔德里克'));
check('联系人好感度都从 0 开始', contacts.every((c) => c.affection === 0));
await page.waitForTimeout(500);
check('列表里有小雨', await phone.locator('button:has-text("小雨")').count() >= 1);
check('列表里有阿杰', await phone.locator('button:has-text("阿杰")').count() >= 1);
check('列表里没有王阿姨', await phone.locator('button:has-text("王阿姨")').count() === 0);

// 打开小雨：开场白是按对话写的短消息，回复能正常回。
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);
check('小雨的开场白是按对话写的（明天一早就来开门）', await phone.locator('text=在吗在吗，明天一早我就去开门').count() >= 1);
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(4000);
check('小雨能正常回消息', await phone.locator('text=收到啦。').count() >= 1);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
