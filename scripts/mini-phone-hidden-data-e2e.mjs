/**
 * 小手机隐藏数据端到端测试（内置高优先级预设 → 隐藏数据块 → 联系人持续更新），390×844，假模型。
 *
 * 覆盖：
 *   (a) 主聊天模型回了一条带隐藏数据块的回复（新人物阿杰）→ 聊天里只显示
 *       正常正文（隐藏块不显示）；主聊天的提示词检查器里能看到小手机预设
 *       的指令；打开小手机后，联系人里多出阿杰（人设/关系按隐藏块里的来）；
 *   (b) 第二条主聊天回复带另一个新人（小雨）→ 不用“重置”、不用重新初始化，
 *       打开手机就认出来（初始化模型调用还是第 1 次打开的那 1 次）；
 *   (c) 一条带坏掉的隐藏块的回复 → 手机不崩，联系人不变；
 *   (d) 提示词查看器还是 14 节；PR #53 的初始化还在（小红是初始化认出来的）。
 *
 * 假模型按最新一条用户消息决定回什么：提到阿杰 → 阿杰块；提到小雨 →
 * 小雨块；提到“乱码” → 没闭合的坏块；其他 → 纯文本。初始化请求（带
 * “角色卡解析助手”）只认对话记录里出现过的小红。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59994;
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
const initBodies = [];
const mainChatRequests = [];

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

const AJIE_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"阿杰","profile":"常来酒馆，总爱带东西","relation":"朋友","relationToMain":"同事","openingMessage":"下周带一批新茶叶过来","gender":"male"}]} -->';
const XIAOYU_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"小雨","profile":"在酒馆帮忙，想学调酒","relation":"朋友","relationToMain":"同事","openingMessage":"在吗在吗，明天一早我就去开门","gender":"female"}]} -->';
const BROKEN_BLOCK = '<!-- [小手机数据] {"characters":[{"name":"坏人"';

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
      // 初始化：只认对话记录里出现过的小红。
      if (allText.includes('角色卡解析助手')) {
        initBodies.push(body);
        const found = ['小红'].filter((n) => allText.includes(n));
        const contacts = {
          小红: { name: '小红', relation: '朋友', relationToMain: '同事', openingMessage: '在吗，明天一早我就去开门', gender: 'female', profile: '在酒馆帮忙，手很稳，想学调酒' },
        };
        sseReply(res, [{ content: JSON.stringify(found.map((n) => contacts[n])) }]);
        return;
      }
      // 主聊天回复：按最新一条用户消息决定回什么，并记下这次请求里
      // 有没有小手机预设的指令（证明预设真的注入了主聊天提示词）。
      const userMsgs = (body.messages ?? []).filter((m) => m.role === 'user');
      const lastUser = userMsgs[userMsgs.length - 1]?.content ?? '';
      mainChatRequests.push({ hasInstruction: allText.includes('小手机数据'), lastUser });
      if (lastUser.includes('阿杰')) {
        sseReply(res, [{ content: `阿杰今天也来了，还带了一批新茶叶。${AJIE_BLOCK}` }]);
        return;
      }
      if (lastUser.includes('小雨')) {
        sseReply(res, [{ content: `小雨明天一早就来开门，我让她多睡会儿。${XIAOYU_BLOCK}` }]);
        return;
      }
      if (lastUser.includes('乱码')) {
        sseReply(res, [{ content: `今天聊得很开心，下次再聊。${BROKEN_BLOCK}` }]);
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

// 拿到这个聊天的 chatId，往主聊天里种对话：只有小红出现过。
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
    { id: 'm-seed-1', role: 'user', content: '今天小红来酒馆帮忙，她说想学调一杯新酒。', createdAt: now + 1 },
    { id: 'm-seed-2', role: 'assistant', content: '小红手很稳，让她先从擦杯子学起，别急。', createdAt: now + 2 },
  ];
  await s.saveChat({ ...chat, messages: [...(chat.messages ?? []), ...seeded] });
}, chatId);
await page.waitForTimeout(300);

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

async function openPhone() {
  await page.getByRole('button', { name: '打开操作面板' }).click();
  await page.getByRole('button', { name: '小手机' }).click();
  await page.waitForTimeout(600);
  await phone.getByRole('button', { name: '微信' }).first().click();
  await page.waitForTimeout(300);
}

async function closePhone() {
  await phone.getByRole('button', { name: '关闭小手机' }).click();
  await page.waitForTimeout(500);
}

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

// ---- 第一次打开手机：初始化认出小红，预设书绑上 ----
await openPhone();
let contacts = await waitForContacts((cs) => cs.length > 0);
check('初始化模型被调了一次', initBodies.length === 1, `初始化请求 ${initBodies.length} 个`);
check('初始化认出小红（PR #53 还在）', JSON.stringify(contacts.map((c) => c.name).sort()) === JSON.stringify(['小红']), `实际 ${contacts.map((c) => c.name).join(',')}`);
const presetBound = await page.evaluate(async (id) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === id);
  const book = s.lorebooks.find((b) => b.id === `phone-preset:${id}`);
  if (!chat || !book) return { bound: false };
  const entry = book.entries[0];
  return {
    bound: chat.lorebookIds.includes(`phone-preset:${id}`),
    bookName: book.name,
    entryName: entry?.comment,
    constant: entry?.constant,
    position: entry?.position,
    depth: entry?.depth,
    role: entry?.role,
    hasInstruction: (entry?.content ?? '').includes('小手机数据'),
  };
}, chatId);
check('预设书绑到聊天上了', presetBound.bound === true, JSON.stringify(presetBound));
check('预设书叫“小手机·预设”', presetBound.bookName === '小手机·预设');
check('预设条目是常驻、atDepth、depth 1、system', presetBound.constant === true && presetBound.position === 4 && presetBound.depth === 1 && presetBound.role === 2, JSON.stringify(presetBound));
check('预设条目里有隐藏数据块的指令', presetBound.hasInstruction === true);

// ---- (d) 提示词查看器还是 14 节 ----
await phone.locator('button:has-text("小红")').first().click();
await page.waitForTimeout(500);
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(500);
check('提示词查看器：还是 14 节', await phone.locator('text=共 14 节').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);
await closePhone();

// ---- (a) 主聊天第一条回复：带阿杰的隐藏块 ----
const sent1 = await sendMain('今天阿杰也来了，说下周要带一批新茶叶过来。', '阿杰今天也来了');
check('主聊天第一条回复流式出现了', sent1);
await page.waitForTimeout(800);
check('发给主聊天的请求里有小手机预设指令', mainChatRequests.some((r) => r.hasInstruction), `主聊天请求 ${mainChatRequests.length} 个`);
const storedHasBlock = await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === id);
  const lastAssistant = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  return (lastAssistant?.content ?? '').includes('[小手机数据]');
}, chatId);
check('存下来的回复里确实有隐藏数据块', storedHasBlock);
check('聊天里只显示正文，隐藏块不显示', await page.locator('text=小手机数据').count() === 0);

// 主聊天提示词检查器里能看到小手机预设的指令。
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(800);
check('主聊天提示词检查器里有小手机预设指令', await page.locator('text=小手机数据').count() >= 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 打开手机：阿杰应该已经在联系人里了（不用重置、不用重新初始化）。
await openPhone();
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '阿杰'));
const namesAfterAjie = contacts.map((c) => c.name).sort();
check('打开手机后联系人里有阿杰（隐藏块认出来的）', JSON.stringify(namesAfterAjie) === JSON.stringify(['小红', '阿杰']), `实际 ${namesAfterAjie.join(',')}`);
const ajie = contacts.find((c) => c.name === '阿杰');
check('阿杰的人设按隐藏块里的来', ajie?.profile === '常来酒馆，总爱带东西', `实际 ${ajie?.profile}`);
check('阿杰的关系按隐藏块里的来', ajie?.relation === '朋友', `实际 ${ajie?.relation}`);
check('阿杰的开场白按隐藏块里的来', ajie?.openingMessage === '下周带一批新茶叶过来', `实际 ${ajie?.openingMessage}`);
check('阿杰的好感度从 0 开始', ajie?.affection === 0);
check('初始化模型调用还是 1 次（没重新初始化）', initBodies.length === 1, `初始化请求 ${initBodies.length} 个`);
check('列表里有阿杰', await phone.locator('button:has-text("阿杰")').count() >= 1);
await closePhone();

// ---- (b) 主聊天第二条回复：带小雨的隐藏块 ----
const sent2 = await sendMain('刚才小雨发消息来，说她明天一早就来开门。', '小雨明天一早就来开门');
check('主聊天第二条回复流式出现了', sent2);
await page.waitForTimeout(800);
await openPhone();
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '小雨'));
const namesAfterXiaoyu = contacts.map((c) => c.name).sort();
check('不用重置，小雨也进了联系人', JSON.stringify(namesAfterXiaoyu) === JSON.stringify(['小红', '小雨', '阿杰']), `实际 ${namesAfterXiaoyu.join(',')}`);
const xiaoyu = contacts.find((c) => c.name === '小雨');
check('小雨的人设按隐藏块里的来', xiaoyu?.profile === '在酒馆帮忙，想学调酒', `实际 ${xiaoyu?.profile}`);
check('初始化模型调用还是 1 次（第二条也没重新初始化）', initBodies.length === 1, `初始化请求 ${initBodies.length} 个`);
await closePhone();

// ---- (c) 带坏掉的隐藏块的回复：手机不崩，联系人不变 ----
const sent3 = await sendMain('今天聊得很开心，乱码测试一下。', '今天聊得很开心，下次再聊');
check('第三条回复流式出现了', sent3);
await page.waitForTimeout(800);
await openPhone();
await page.waitForTimeout(1500);
contacts = await readContacts();
const namesAfterBroken = contacts.map((c) => c.name).sort();
check('坏掉的隐藏块没让联系人变多', JSON.stringify(namesAfterBroken) === JSON.stringify(['小红', '小雨', '阿杰']), `实际 ${namesAfterBroken.join(',')}`);
check('坏掉的隐藏块没编出“坏人”', !namesAfterBroken.includes('坏人'));
check('初始化模型调用还是 1 次', initBodies.length === 1, `初始化请求 ${initBodies.length} 个`);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
