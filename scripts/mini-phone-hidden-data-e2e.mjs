/**
 * 小手机隐藏数据端到端测试（新逻辑：隐藏数据块 + 剧情正文兜底提取），390×844，假模型。
 *
 * 覆盖：
 *   (a1) 主聊天里提到的人都不在名字表里、没有任何隐藏数据块 → 打开小手机，
 *       联系人列表是空的，初始化模型调用是 0 次；
 *   (a2) 【用户实测的复现】主聊天模型只回剧情、不输出隐藏数据块，但剧情里
 *       提到了世界书里有名字的小雨和阿杰 → 打开小手机，联系人里有小雨和阿杰，
 *       他们的微信记录里有剧情里那几句话（兜底提取的证明）；全程只有主聊天
 *       那一次模型调用，没有额外的模型调用（兜底是纯解析）；
 *   (b) 主聊天模型回了一条带隐藏数据块的回复（新人阿豪 + 一条新消息）→
 *       聊天里只显示正常正文（隐藏块不显示）；主聊天的提示词检查器里能看到
 *       小手机预设的指令；打开小手机后，联系人里有阿豪，阿豪的微信记录里
 *       按顺序多了开场白和那条消息、说话人对得上；正文里那句剧情不另外贴
 *       一遍（块是权威的，同一条消息不跑兜底）；
 *   (c) 第二条主聊天回复带另一个新人（小北 + 一条新消息）→ 不用“重置”、
 *       不用重新初始化，打开手机就认出来，初始化模型调用还是 0 次；
 *   (d) 再重开一次手机 → 同一个隐藏块被重复扫描，阿杰的微信记录里消息没有重复；
 *   (e) 一条带坏掉的隐藏块的回复 → 手机不崩，联系人、微信记录都不变；
 *   (f) 提示词查看器还是 14 节；预设书照常绑到聊天上。
 *   (g) 手机开着的时候，主聊天来了一条带隐藏块的新消息 → 不用重开手机，
 *       扫描 effect 直接把新人认出来（证明扫描不只在打开时跑）；
 *   (h) 重置 → 联系人和微信记录都清掉，空状态显示新文案。
 *
 * 假模型按最新一条用户消息决定回什么：提到小雨/阿杰 → 只有剧情、没有隐藏块；
 * 提到阿豪/小北 → 带隐藏块的回复；提到“乱码” → 没闭合的坏块；其他 → 纯文本。
 * 旧的初始化请求（带“角色卡解析助手”）如果出现，会被单独记下来——新逻辑下
 * 它不应该出现。
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

const AHAO_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"阿豪","profile":"开面馆的，话不多","relation":"朋友","relationToMain":"邻居","openingMessage":"今天的面多加了个蛋","gender":"male"}],"messages":[{"character":"阿豪","role":"character","content":"今天的面多加了个蛋，趁热吃"}]} -->';
const XIAOBEI_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"小北","profile":"住楼上的邻居，爱养花","relation":"朋友","relationToMain":"邻居","openingMessage":"阳台上的花开了，要不要来看","gender":"female"}],"messages":[{"character":"小北","role":"character","content":"花开了，下来看呀"}]} -->';
const AQIANG_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"阿强","profile":"送外卖的，跑得很快","relation":"朋友","relationToMain":"邻居","openingMessage":"外卖到了，放门口了","gender":"male"}],"messages":[{"character":"阿强","role":"character","content":"外卖到了，放门口了，趁热吃"}]} -->';
// 只有剧情、没有隐藏块的回复：模型只写剧情时，兜底要从这段正文里认出小雨和阿杰。
const PLOT_ONLY_REPLY =
  '小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”小雨又补充了一句：“记得带早餐。”阿杰放下一包茶叶，说下周再来。阿杰还说茶叶不够了再找他。';
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
      // 旧的初始化请求（带“角色卡解析助手”）：新逻辑下不应该出现，出现了就记下来。
      if (allText.includes('角色卡解析助手')) {
        initBodies.push(body);
        sseReply(res, [{ content: '[]' }]);
        return;
      }
      // 主聊天回复：按最新一条用户消息决定回什么，并记下这次请求里
      // 有没有小手机预设的指令（证明预设真的注入了主聊天提示词）。
      const userMsgs = (body.messages ?? []).filter((m) => m.role === 'user');
      const lastUser = userMsgs[userMsgs.length - 1]?.content ?? '';
      mainChatRequests.push({ hasInstruction: allText.includes('小手机数据'), lastUser });
      if (lastUser.includes('小雨') || lastUser.includes('阿杰')) {
        // 只有剧情、没有隐藏块：用户实测里模型就是这么回的。
        sseReply(res, [{ content: PLOT_ONLY_REPLY }]);
        return;
      }
      if (lastUser.includes('阿豪')) {
        sseReply(res, [{ content: `阿豪今天也来了，还多加了个蛋。${AHAO_BLOCK}` }]);
        return;
      }
      if (lastUser.includes('小北')) {
        sseReply(res, [{ content: `小北今天也来了，还带了一盆花。${XIAOBEI_BLOCK}` }]);
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

// 拿到这个聊天的 chatId，往主聊天里种两句没提到任何人的对话（名字表里没人），
// 再种一本世界书：里面有小雨和阿杰两个条目（comment 就是人名），绑到聊天上。
// 兜底提取的名字表就从这本世界书里来——只读条目名字，不读条目内容。
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
    { id: 'm-seed-1', role: 'user', content: '今天酒馆打烊早。', createdAt: now + 1 },
    { id: 'm-seed-2', role: 'assistant', content: '嗯，早点休息，明天再说。', createdAt: now + 2 },
  ];
  await s.saveChat({ ...chat, messages: [...(chat.messages ?? []), ...seeded] });
}, chatId);
await page.evaluate(async (id) => {
  const s = window.__rpnowStore.getState();
  const { newEntry } = await import('/src/core/types/lorebook.ts');
  const book = {
    id: 'lb_test_chars',
    name: '测试人物',
    description: '',
    entries: [
      newEntry({ comment: '小雨', keys: ['小雨'], content: '在酒馆帮忙，想学调酒。' }),
      newEntry({ comment: '阿杰', keys: ['阿杰'], content: '常来酒馆，总爱带东西。' }),
    ],
    source: 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await s.saveLorebook(book);
  const chat = s.chats.find((c) => c.id === id);
  await s.saveChat({ ...chat, lorebookIds: [...(chat.lorebookIds ?? []), book.id] });
}, chatId);
await page.waitForTimeout(300);
await page.waitForTimeout(300);

async function readContacts() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:contacts:${id}`)) ?? [];
  }, chatId);
}

async function readWeChatChat(contactId) {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:wechat:${id}`)) ?? null;
  }, contactId);
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

async function waitForWeChatChat(contactId, pred, timeoutMs = 30000) {
  const start = Date.now();
  let chat = null;
  while (Date.now() - start < timeoutMs) {
    chat = await readWeChatChat(contactId);
    if (chat && pred(chat)) return chat;
    await page.waitForTimeout(400);
  }
  return chat;
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

// ---- (a1) 第一次打开手机：主聊天里没提到名字表里的人、没有隐藏块，联系人就是空的，初始化模型调用是 0 次 ----
await openPhone();
await page.waitForTimeout(3000);
let contacts = await readContacts();
check('没提到任何人时，联系人列表是空的', contacts.length === 0, `实际 ${contacts.map((c) => c.name).join(',')}`);
check('初始化模型调用是 0 次（旧 PR #53 逻辑已删）', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);
check('列表里没有小雨', await phone.locator('button:has-text("小雨")').count() === 0);
check('列表里没有阿杰', await phone.locator('button:has-text("阿杰")').count() === 0);
check('列表显示新空状态文案', await phone.locator('text=主聊天里聊出新人物后，这里就会出现').count() >= 1);
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
    hasMessagesSchema: (entry?.content ?? '').includes('"messages"'),
    hasConsequence: (entry?.content ?? '').includes('不输出这个块，小手机就认不出任何联系人'),
  };
}, chatId);
check('预设书绑到聊天上了', presetBound.bound === true, JSON.stringify(presetBound));
check('预设书叫“小手机·预设”', presetBound.bookName === '小手机·预设');
check('预设条目是常驻、atDepth、depth 1、system', presetBound.constant === true && presetBound.position === 4 && presetBound.depth === 1 && presetBound.role === 2, JSON.stringify(presetBound));
check('预设条目里有隐藏数据块的指令', presetBound.hasInstruction === true);
check('预设指令里写明了 messages 的结构', presetBound.hasMessagesSchema === true);
check('预设指令里写明了不输出的后果', presetBound.hasConsequence === true);
await closePhone();

// ---- (a2) 【用户实测的复现】主聊天模型只回剧情、不输出隐藏块：剧情里提到了小雨和阿杰 ----
const sentPlot = await sendMain('今天小雨来酒馆帮忙，阿杰也带了茶叶来。', '我学会了一杯新的特调');
check('主聊天只写剧情的回复流式出现了', sentPlot);
await page.waitForTimeout(800);
check('发给主聊天的请求里有小手机预设指令', mainChatRequests.some((r) => r.hasInstruction), `主聊天请求 ${mainChatRequests.length} 个`);
const storedHasNoBlock = await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === id);
  const lastAssistant = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  return !(lastAssistant?.content ?? '').includes('[小手机数据]');
}, chatId);
check('存下来的回复里确实没有隐藏数据块（模型只写了剧情）', storedHasNoBlock);
// 兜底是纯解析：打开手机、扫描剧情这个过程本身不能新增任何模型调用。
// （注意：发一条主聊天消息本身会调两次模型——一次回正文、一次提炼记忆；
// 那是主聊天自己的流程，不是兜底的调用，所以这里只量打开手机这个窗口。）
const llmCallsBeforeOpen = llmBodies.length;
await openPhone();
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '小雨') && cs.some((c) => c.name === '阿杰'));
check(
  '兜底没多调模型：打开手机、扫描剧情没有新增模型调用',
  llmBodies.length === llmCallsBeforeOpen,
  `打开前 ${llmCallsBeforeOpen} 次，打开后 ${llmBodies.length} 次`,
);
const namesAfterPlot = contacts.map((c) => c.name).sort();
check(
  '只写剧情也认得出人：联系人里有小雨和阿杰（兜底提取）',
  JSON.stringify(namesAfterPlot) === JSON.stringify(['小雨', '阿杰']),
  `实际 ${namesAfterPlot.join(',')}`,
);
const xiaoyu = contacts.find((c) => c.name === '小雨');
const ajie = contacts.find((c) => c.name === '阿杰');
check('小雨的人设没编：兜底建的联系人人设是空的', xiaoyu?.profile === undefined, `实际 ${xiaoyu?.profile}`);
check(
  '小雨的开场白是剧情里她第一次说话的那句',
  xiaoyu?.openingMessage === '小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”',
  `实际 ${xiaoyu?.openingMessage}`,
);
check(
  '阿杰的开场白是剧情里他第一次行动的那句',
  ajie?.openingMessage === '阿杰放下一包茶叶，说下周再来。',
  `实际 ${ajie?.openingMessage}`,
);
check('小雨的好感度从 0 开始', xiaoyu?.affection === 0);
check('阿杰的好感度从 0 开始', ajie?.affection === 0);
check('初始化模型调用还是 0 次', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);
check('列表里有小雨', await phone.locator('button:has-text("小雨")').count() >= 1);
check('列表里有阿杰', await phone.locator('button:has-text("阿杰")').count() >= 1);
const xiaoyuChat = await waitForWeChatChat(xiaoyu.id, (c) => c.messages.length >= 3);
const xiaoyuContents = xiaoyuChat?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '小雨的微信记录里有那几句剧情：开场白 + User 那句 + 第二句',
  JSON.stringify(xiaoyuContents) === JSON.stringify([
    'assistant:小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”',
    'user:今天小雨来酒馆帮忙，阿杰也带了茶叶来。',
    'assistant:小雨又补充了一句：“记得带早餐。”',
  ]),
  `实际 ${xiaoyuContents.join(' | ')}`,
);
const ajieChat = await waitForWeChatChat(ajie.id, (c) => c.messages.length >= 3);
const ajieContents = ajieChat?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '阿杰的微信记录里有那几句剧情：开场白 + User 那句 + 第二句',
  JSON.stringify(ajieContents) === JSON.stringify([
    'assistant:阿杰放下一包茶叶，说下周再来。',
    'user:今天小雨来酒馆帮忙，阿杰也带了茶叶来。',
    'assistant:阿杰还说茶叶不够了再找他。',
  ]),
  `实际 ${ajieContents.join(' | ')}`,
);
await closePhone();

// ---- (b) 主聊天第一条带隐藏块的回复：新人阿豪（1 个人 + 1 条新消息） ----
const sent1 = await sendMain('今天阿豪也来了。', '阿豪今天也来了');
check('主聊天第一条带隐藏块的回复流式出现了', sent1);
await page.waitForTimeout(800);
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

// 打开手机：阿豪应该已经在联系人里了，阿豪的微信记录里多了那条消息。
// 正文里“阿豪今天也来了”那句不另外贴一遍：块是权威的，同一条消息不跑兜底。
await openPhone();
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '阿豪'));
const namesAfterAhao = contacts.map((c) => c.name).sort();
check('打开手机后联系人里有阿豪（隐藏块认出来的）', JSON.stringify(namesAfterAhao) === JSON.stringify(['小雨', '阿杰', '阿豪'].sort()), `实际 ${namesAfterAhao.join(',')}`);
const ahao = contacts.find((c) => c.name === '阿豪');
check('阿豪的人设按隐藏块里的来', ahao?.profile === '开面馆的，话不多', `实际 ${ahao?.profile}`);
check('阿豪的关系按隐藏块里的来', ahao?.relation === '朋友', `实际 ${ahao?.relation}`);
check('阿豪的开场白按隐藏块里的来', ahao?.openingMessage === '今天的面多加了个蛋', `实际 ${ahao?.openingMessage}`);
check('阿豪的好感度从 0 开始', ahao?.affection === 0);
check('初始化模型调用还是 0 次', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);
check('列表里有阿豪', await phone.locator('button:has-text("阿豪")').count() >= 1);
const ahaoChat = await waitForWeChatChat(ahao.id, (c) => c.messages.length >= 2);
const ahaoContents = ahaoChat?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '阿豪的微信记录里有开场白和那条新消息，顺序和说话人对得上',
  JSON.stringify(ahaoContents) === JSON.stringify([
    'assistant:今天的面多加了个蛋',
    'assistant:今天的面多加了个蛋，趁热吃',
  ]),
  `实际 ${ahaoContents.join(' | ')}`,
);

// ---- (f) 提示词查看器还是 14 节 ----
await phone.locator('button:has-text("阿豪")').first().click();
await page.waitForTimeout(500);
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(500);
check('提示词查看器：还是 14 节', await phone.locator('text=共 14 节').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);
await closePhone();

// ---- (c) 主聊天第二条带隐藏块的回复：新人小北（1 个人 + 1 条新消息） ----
const sent2 = await sendMain('刚才小北发消息来，说她阳台上的花开了。', '小北今天也来了');
check('主聊天第二条带隐藏块的回复流式出现了', sent2);
await page.waitForTimeout(800);
await openPhone();
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '小北'));
const namesAfterXiaobei = contacts.map((c) => c.name).sort();
check('不用重置，小北也进了联系人', JSON.stringify(namesAfterXiaobei) === JSON.stringify(['小雨', '阿杰', '阿豪', '小北'].sort()), `实际 ${namesAfterXiaobei.join(',')}`);
const xiaobei = contacts.find((c) => c.name === '小北');
check('小北的人设按隐藏块里的来', xiaobei?.profile === '住楼上的邻居，爱养花', `实际 ${xiaobei?.profile}`);
check('初始化模型调用还是 0 次（第二条也没调初始化）', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);
const xiaobeiChat = await waitForWeChatChat(xiaobei.id, (c) => c.messages.length >= 2);
const xiaobeiContents = xiaobeiChat?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '小北的微信记录里有开场白和那条新消息',
  JSON.stringify(xiaobeiContents) === JSON.stringify([
    'assistant:阳台上的花开了，要不要来看',
    'assistant:花开了，下来看呀',
  ]),
  `实际 ${xiaobeiContents.join(' | ')}`,
);
await closePhone();

// ---- (d) 再重开一次手机：同一个块被重复扫描，消息不重复 ----
await openPhone();
await page.waitForTimeout(2000);
const ajieChatAgain = await readWeChatChat(ajie.id);
const ajieContentsAgain = ajieChatAgain?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '重开手机后，阿杰的微信记录没有重复消息',
  JSON.stringify(ajieContentsAgain) === JSON.stringify([
    'assistant:阿杰放下一包茶叶，说下周再来。',
    'user:今天小雨来酒馆帮忙，阿杰也带了茶叶来。',
    'assistant:阿杰还说茶叶不够了再找他。',
  ]),
  `实际 ${ajieContentsAgain.join(' | ')}`,
);
contacts = await readContacts();
check('重开手机后，联系人还是小雨、阿杰、阿豪、小北', JSON.stringify(contacts.map((c) => c.name).sort()) === JSON.stringify(['小雨', '阿杰', '阿豪', '小北'].sort()));
await closePhone();

// ---- (e) 带坏掉的隐藏块的回复：手机不崩，联系人、微信记录都不变 ----
const sent3 = await sendMain('今天聊得很开心，乱码测试一下。', '今天聊得很开心，下次再聊');
check('第三条回复流式出现了', sent3);
await page.waitForTimeout(800);
await openPhone();
await page.waitForTimeout(1500);
contacts = await readContacts();
const namesAfterBroken = contacts.map((c) => c.name).sort();
check('坏掉的隐藏块没让联系人变多', JSON.stringify(namesAfterBroken) === JSON.stringify(['小雨', '阿杰', '阿豪', '小北'].sort()), `实际 ${namesAfterBroken.join(',')}`);
check('坏掉的隐藏块没编出“坏人”', !namesAfterBroken.includes('坏人'));
const ajieChatAfterBroken = await readWeChatChat(ajie.id);
check(
  '坏掉的隐藏块没让阿杰的微信记录变多',
  (ajieChatAfterBroken?.messages.length ?? -1) === 3,
  `实际 ${ajieChatAfterBroken?.messages.length}`,
);
check('初始化模型调用还是 0 次', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);

// ---- (g) 手机开着的时候，主聊天来了一条带隐藏块的新消息：不用重开，联系人直接出现 ----
// 手机还开着（上一步 (e) 结束时没关）。直接往主聊天里追加一条带隐藏块的
// 回复（模拟主聊天模型刚回了一条），扫描 effect 订阅着主聊天变化，应该
// 不用重开手机就把新人认出来。
await page.evaluate(async (args) => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === args.id);
  await s.saveChat({
    ...chat,
    messages: [
      ...(chat.messages ?? []),
      {
        id: `m-inject-${Date.now()}`,
        role: 'assistant',
        content: `阿强今天也来了，还送了份外卖。${args.block}`,
        createdAt: Date.now(),
      },
    ],
  });
}, { id: chatId, block: AQIANG_BLOCK });
contacts = await waitForContacts((cs) => cs.some((c) => c.name === '阿强'));
check(
  '手机开着时主聊天来了新隐藏块，不用重开，阿强直接出现',
  contacts.some((c) => c.name === '阿强'),
  `实际 ${contacts.map((c) => c.name).join(',')}`,
);
check('列表里直接有阿强', await phone.locator('button:has-text("阿强")').count() >= 1);
const aqiang = contacts.find((c) => c.name === '阿强');
const aqiangChat = await waitForWeChatChat(aqiang.id, (c) => c.messages.length >= 2);
const aqiangContents = aqiangChat?.messages.map((m) => `${m.role}:${m.content}`) ?? [];
check(
  '阿强的微信记录里有开场白和那条新消息',
  JSON.stringify(aqiangContents) === JSON.stringify([
    'assistant:外卖到了，放门口了',
    'assistant:外卖到了，放门口了，趁热吃',
  ]),
  `实际 ${aqiangContents.join(' | ')}`,
);
check('初始化模型调用还是 0 次（手机开着也没调初始化）', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);

// ---- (h) 重置：联系人和微信记录都清掉，空状态显示新文案 ----
await phone.getByRole('button', { name: '清空并重置' }).click();
await phone.getByRole('button', { name: '确定重置' }).click();
await page.waitForTimeout(1500);
contacts = await readContacts();
check('重置后联系人列表是空的', contacts.length === 0, `实际 ${contacts.map((c) => c.name).join(',')}`);
check(
  '重置后空状态显示新文案',
  await phone.locator('text=主聊天里聊出新人物后，这里就会出现').count() >= 1,
);
const ajieChatAfterReset = await readWeChatChat(ajie.id);
check('重置后阿杰的微信记录清掉了', ajieChatAfterReset === null);
const xiaoyuChatAfterReset = await readWeChatChat(xiaoyu.id);
check('重置后小雨的微信记录清掉了', xiaoyuChatAfterReset === null);
const ahaoChatAfterReset = await readWeChatChat(ahao.id);
check('重置后阿豪的微信记录清掉了', ahaoChatAfterReset === null);
const xiaobeiChatAfterReset = await readWeChatChat(xiaobei.id);
check('重置后小北的微信记录清掉了', xiaobeiChatAfterReset === null);
const aqiangChatAfterReset = await readWeChatChat(aqiang.id);
check('重置后阿强的微信记录清掉了', aqiangChatAfterReset === null);
check('重置后初始化还是 0 次', initBodies.length === 0, `初始化请求 ${initBodies.length} 个`);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
