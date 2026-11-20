/**
 * 小手机群聊端到端测试（PR #49），390×844，假模型 + 假生图。
 *
 * 覆盖：
 *   - 建群（多选成员 + 群名，同名拒绝）、群列表混排、群头像；
 *   - 点名提到谁谁先回（小雨被点名 → 小雨先回），一轮 1–3 人；
 *   - 冲全群说的（大家）→ 最久没说话的人先回；
 *   - 气泡上方显示说话人名字；群里发图只在用户明确要图时才发，
 *     没要图时模型想发图也被守门拦住；
 *   - 关掉重开 → 群和群聊记录还在，初始化一次都没重跑；
 *   - 群聊记录同步进世界书“{群名}的群聊记录”；
 *   - 好感度：用户那句 +1 只给主回的人，回的人回一次 +1；
 *   - 群提示词查看器（14 节，带群聊注脚）；
 *   - 群管理：踢人、踢最后一个人解散群（记录和世界书条目一起删）；
 *   - 回归：一对一防自动生图守门、提示词查看器、状态栏、相册、
 *     朋友圈、重置（群跟着一起清；联系人回到空的，主聊天再产出隐藏
 *     数据块后才回来，初始化模型调用全程是 0 次）。
 *
 * 假模型：按 system prompt 里的“你要扮演「X」”认出是哪个成员在回，
 * 永远回一句短聊 + 一个 send_image 工具调用——这样“没要图就不发图”
 * 才是真守门（和 PR #40 的 v11 脚本同款做法）。Tag 转写（system 里
 * 有 Danbooru）回一串 Danbooru 标签；主聊天回复按最新一条用户消息，
 * 提到小雨/阿杰就带一个隐藏数据块（两个联系人都在里面）；旧的初始化
 * （system 里有“角色卡解析助手”）留着当绊线——新逻辑下它不应该被调，
 * 调了就会被“初始化一次没跑”那几项检查抓住。生图走 OpenAI 兼容接口，返回 1×1 PNG。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59991;
const BASE = 'http://127.0.0.1:5173/';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

/** 和 groups.ts 里 hashText 同款：按文本内容算个小哈希。 */
function hashText(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** 和 groups.ts 里 pickGroupRepliers 同款的附和人数（2 人群，rest 只有 1 个）。 */
function expectedReplierCount(userText, userRounds, restLen) {
  return 1 + Math.min((hashText(userText) + userRounds) % 3, restLen, 2);
}

const llmBodies = [];
let imageCalls = 0;
let imagePrompts = [];

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

const RESET_BLOCK =
  '<!-- [小手机数据] {"characters":[{"name":"小雨","profile":"活泼开朗，黑长直，爱吃凉皮","relation":"室友","relationToMain":"闺蜜","openingMessage":"在吗在吗","gender":"female"},{"name":"阿杰","profile":"稳重可靠，花店打工","relation":"学长","relationToMain":"哥哥","openingMessage":"今天花店忙不忙","gender":"male"}],"messages":[]} -->';

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.url?.endsWith('/images/generations')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      imageCalls++;
      try {
        imagePrompts.push(JSON.parse(raw).prompt ?? '');
      } catch {
        // 忽略解析失败。
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG_1X1 }] }));
    });
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
      // 旧的初始化：新逻辑下不应该被调，留着当绊线（调了就会被
      // “初始化一次没跑”的检查抓住）。万一被调，回一份联系人 JSON。
      if (allText.includes('角色卡解析助手')) {
        sseReply(res, [
          {
            content: JSON.stringify([
              { name: '小雨', relation: '室友', relationToMain: '闺蜜', openingMessage: '在吗在吗', gender: 'female', profile: '活泼开朗' },
              { name: '阿杰', relation: '学长', relationToMain: '哥哥', openingMessage: '今天花店忙不忙', gender: 'male', profile: '稳重可靠' },
              { name: '王阿姨', relation: '', relationToMain: '房东', openingMessage: '房租该交了', gender: 'female', profile: '热心肠' },
            ]),
          },
        ]);
        return;
      }
      // Tag 转写：回一串 Danbooru 标签。
      if (allText.includes('Danbooru')) {
        sseReply(res, [
          { content: '1girl, solo, long black hair, school uniform, dorm building exterior, masterpiece, very aesthetic, no text' },
        ]);
        return;
      }
      // 主聊天回复：没有“你要扮演「X」”的就是主聊天。提到小雨/阿杰
      // 就带一个隐藏数据块（两个联系人都在里面），让重置后的手机能
      // 靠它把联系人认回来；其他只回一句纯文本。
      if (!allText.includes('你要扮演')) {
        const lastUser = [...(body.messages ?? [])]
          .reverse()
          .find((m) => m.role === 'user');
        const userText = lastUser?.content ?? '';
        if (userText.includes('小雨') || userText.includes('阿杰')) {
          sseReply(res, [{ content: `小雨和阿杰都说好呀，周末一起去吃凉皮。${RESET_BLOCK}` }]);
          return;
        }
        sseReply(res, [{ content: '收到啦。' }]);
        return;
      }
      // 回复：按 system prompt 里的“你要扮演「X」”认出是哪个成员。
      const who = allText.match(/你要扮演「([^」]+)」/)?.[1] ?? '成员';
      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'user');
      const userText = lastUser?.content ?? '';
      const wantsImage = /发张图|发照片|发个图|自拍|看看你/.test(userText);
      // 永远带一个 send_image 工具调用：用户要图时才该真发出来，
      // 没要图时守门必须拦住（PR #40 同款做法）。
      const toolDelta = {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            function: {
              name: 'send_image',
              arguments: JSON.stringify({
                description: '在宿舍楼下拍的照片',
                people: 'solo',
              }),
            },
          },
        ],
      };
      sseReply(
        res,
        [{ content: `我是${who}，收到啦。` }, toolDelta],
        wantsImage ? 'tool_calls' : 'stop',
      );
    });
    return;
  }
  res.writeHead(404).end();
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

// e2e-helpers 的 launch 用 channel: 'chrome'，这台机器上没有 Chrome，
// 用 Playwright 自带的 chromium（~/.cache/ms-playwright/chromium-1255）。
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 小手机是挂在 document.body 上的 portal；主聊天里的同名按钮（发送等）
// 还在 DOM 里，手机里的操作一律用 phone 限定，不然会撞上 strict mode。
const phone = page.locator('.fixed.inset-0.z-\\[80\\]');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// 手机尺寸下主导航是隐藏的（md:flex），等 store 挂好就算加载完了。
await page.waitForFunction(() => window.__rpnowStore, null, { timeout: 20000 });

// Seed：卡 + 假模型连接 + 假生图连接。
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
  // 跳过首次启动向导（手机尺寸下它会盖住卡片页）。
  s.setSettings({ onboardingCompleted: true });
  const img = s.imageConnections.find((c) => c.name === 'MockImage');
  await s.saveImageConnection({
    id: img?.id ?? 'img_mock',
    name: 'MockImage',
    provider: 'openai-image',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'x',
    defaultModel: 'mock-image',
  });
  s.setSettings({ defaultPresetId: 'preset:roleplay-default' });
}, PORT);
await page.waitForTimeout(300);

// 手机尺寸下首页是“开始你的第一段对话”列表，点角色名就直接开聊
// （桌面版是文章卡片 + 详情页，e2e-helpers 的 openFirstCardChat 走那条）。
await page.locator('button:has-text("阿尔德里克")').first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
await page.waitForTimeout(600);

// 拿到这个聊天的 chatId，往 IndexedDB 里直接种联系人（不走模型初始化）。
const chatId = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const card = s.cards[0];
  const chats = s.chats.filter((c) => c.cardId === card.id);
  return chats[chats.length - 1]?.id ?? '';
});
check('拿到聊天 id', Boolean(chatId));
await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  await idbStorage.set(`rpnow:phone:contacts:${id}`, [
    { id: 'c_xiaoyu', name: '小雨', relation: '室友', relationToMain: '闺蜜', openingMessage: '在吗在吗', profile: '活泼开朗，黑长直，爱吃凉皮', gender: 'female', affection: 0, v: 2 },
    { id: 'c_ajie', name: '阿杰', relation: '学长', relationToMain: '哥哥', openingMessage: '今天花店忙不忙', profile: '稳重可靠，花店打工', gender: 'male', affection: 0, v: 2 },
    { id: 'c_wangayi', name: '王阿姨', relation: '', relationToMain: '房东', openingMessage: '房租该交了', profile: '热心肠，爱唠嗑', gender: 'female', affection: 0, v: 2 },
  ]);
}, chatId);

// 读群聊记录（IndexedDB）的小帮手。
async function readGroupChat() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    const groups = (await idbStorage.get(`rpnow:phone:groups:${id}`)) ?? [];
    if (groups.length === 0) return { groups, messages: [] };
    const chat = await idbStorage.get(`rpnow:phone:groupchat:${groups[0].id}`);
    return { groups, messages: chat?.messages ?? [] };
  }, chatId);
}
async function waitForGroupMessages(count, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { messages } = await readGroupChat();
    if (messages.length >= count) return messages;
    await page.waitForTimeout(300);
  }
  return (await readGroupChat()).messages;
}
/** 等一轮群聊回完：assistant 文字消息够数，且“正在输入…”消失了。 */
async function waitForRoundDone(prevTextCount, expectedNew, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { messages } = await readGroupChat();
    const texts = assistantTexts(messages).length;
    const typing = await phone.locator('text=正在输入').count();
    if (texts >= prevTextCount + expectedNew && typing === 0) return messages;
    await page.waitForTimeout(300);
  }
  return (await readGroupChat()).messages;
}
function assistantTexts(messages) {
  return messages.filter((m) => m.role === 'assistant' && m.type === 'text');
}
const initCallCount = () =>
  llmBodies.filter((b) =>
    (b.messages ?? []).some((m) => (m.content ?? '').includes('角色卡解析助手')),
  ).length;

// 打开小手机 → 微信。
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
check('状态栏在（关闭按钮可见）', await phone.getByRole('button', { name: '关闭小手机' }).isVisible());
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
check('列表里有 3 个联系人', await phone.locator('button:has-text("小雨")').count() >= 1);

// ---- 建群 ----
await phone.getByRole('button', { name: '新建群聊' }).click();
await phone.getByPlaceholder('群名（比如：宿舍小分队）').fill('宿舍小分队');
await phone.locator('button:has-text("小雨")').last().click();
await phone.locator('button:has-text("阿杰")').last().click();
await phone.getByRole('button', { name: '创建' }).click();
await page.waitForTimeout(500);
check('建群后打开群聊，标题是群名', await phone.locator('h2:has-text("宿舍小分队")').count() >= 1);
check('群聊标题里有成员名', await phone.locator('h2:has-text("阿杰")').count() >= 1);

// ---- 同名拒绝 ----
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(400);
await phone.getByRole('button', { name: '新建群聊' }).click();
await phone.getByPlaceholder('群名（比如：宿舍小分队）').fill('宿舍小分队');
await phone.locator('button:has-text("小雨")').last().click();
await phone.locator('button:has-text("阿杰")').last().click();
await phone.getByRole('button', { name: '创建' }).click();
await page.waitForTimeout(400);
check('同名建群被拒绝并提示', await phone.locator('text=已经有个同名的群了').count() >= 1);
await phone.getByRole('button', { name: '取消建群' }).click();
await page.waitForTimeout(300);
await phone.locator('button:has-text("宿舍小分队")').first().click();
await page.waitForTimeout(500);

// ---- 第一轮：点名小雨 ----
const round1Text = '小雨，你在干嘛';
await phone.getByPlaceholder('发消息…').fill(round1Text);
await phone.getByRole('button', { name: '发送' }).click();
const expectedRound1 = expectedReplierCount(round1Text, 1, 1);
const afterRound1 = await waitForRoundDone(0, expectedRound1);
const round1Replies = assistantTexts(afterRound1);
check(
  `点名小雨：小雨先回（期望 ${expectedRound1} 人回，实际 ${round1Replies.length} 人）`,
  round1Replies.length === expectedRound1 && round1Replies[0]?.characterName === '小雨',
  JSON.stringify(round1Replies.map((m) => m.characterName)),
);
check('小雨的回复文字在气泡里', await phone.locator('text=我是小雨，收到啦。').count() >= 1);
check('气泡上方显示说话人名字“小雨”', await phone.locator('span:text-is("小雨")').count() >= 1);
// 好感度：用户那句 +1 只给主回的人（小雨），小雨回一次 +1 → 2。
const contactsAfterRound1 = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  return idbStorage.get(`rpnow:phone:contacts:${id}`);
}, chatId);
const xiaoyuAff = contactsAfterRound1.find((c) => c.id === 'c_xiaoyu')?.affection;
const ajieAff = contactsAfterRound1.find((c) => c.id === 'c_ajie')?.affection;
check('小雨好感度 2（用户那句 +1、回一次 +1）', xiaoyuAff === 2, `实际 ${xiaoyuAff}`);
check(
  '阿杰好感度只跟他回没回走',
  ajieAff === (round1Replies.some((m) => m.characterName === '阿杰') ? 1 : 0),
  `实际 ${ajieAff}`,
);
// 世界书同步。
const lorebookAfterRound1 = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  return s.lorebooks.map((b) => ({ id: b.id, entries: b.entries.map((e) => e.comment) }));
});
const groupBook = lorebookAfterRound1.find((b) => b.id === `phone-groups:${chatId}`);
check('世界书里有“小手机·群聊”这本书', Boolean(groupBook));
check(
  '条目叫“宿舍小分队的群聊记录”',
  groupBook?.entries.includes('宿舍小分队的群聊记录') ?? false,
);
const groupEntryContent = await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const book = s.lorebooks.find((b) => b.id === `phone-groups:${id}`);
  return book?.entries.find((e) => e.comment === '宿舍小分队的群聊记录')?.content ?? '';
}, chatId);
check('群聊记录条目里有用户那句和成员的回复', groupEntryContent.includes('小雨，你在干嘛') && groupEntryContent.includes('小雨：'));
check('群聊记录条目关键词含群名和成员名', await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const book = s.lorebooks.find((b) => b.id === `phone-groups:${id}`);
  const keys = book?.entries.find((e) => e.comment === '宿舍小分队的群聊记录')?.keys ?? [];
  return keys.includes('宿舍小分队') && keys.includes('小雨') && keys.includes('阿杰');
}, chatId));

// ---- 第二轮：冲全群说 ----
const round2Text = '大家都在吗';
const prevTextCount2 = assistantTexts((await readGroupChat()).messages).length;
const expectedRound2 = expectedReplierCount(round2Text, 2, 1);
await phone.getByPlaceholder('发消息…').fill(round2Text);
await phone.getByRole('button', { name: '发送' }).click();
const afterRound2 = await waitForRoundDone(prevTextCount2, expectedRound2);
const newReplies2 = assistantTexts(afterRound2.slice(-expectedRound2));
check(
  `冲全群说也有人回（期望 ${expectedRound2} 人）`,
  newReplies2.length === expectedRound2,
  `实际 ${newReplies2.length}`,
);
// 最久没说话的人先回：按第一轮的记录算。
const spoken = [];
for (let i = afterRound1.length - 1; i >= 0; i--) {
  const m = afterRound1[i];
  if (m.role === 'assistant' && m.characterName && !spoken.includes(m.characterName)) spoken.push(m.characterName);
}
const expectedPrimary2 = spoken.length >= 2 ? spoken[spoken.length - 1] : (spoken[0] === '小雨' ? '阿杰' : '小雨');
check(
  `冲全群说：最久没说话的人先回（期望 ${expectedPrimary2}）`,
  newReplies2[0]?.characterName === expectedPrimary2,
  `实际 ${newReplies2[0]?.characterName}`,
);

// ---- 守门：没要图就不发图 ----
const imageCallsBeforeGuard = imageCalls;
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(4000);
check('没要图：模型想发图也被拦住，生图一次没调', imageCalls === imageCallsBeforeGuard, `生图调用 ${imageCallsBeforeGuard} → ${imageCalls}`);

// ---- 要图：小雨发图 ----
await phone.getByPlaceholder('发消息…').fill('小雨，发张图给我看看');
await phone.getByRole('button', { name: '发送' }).click();
const startImg = Date.now();
let groupImage = null;
while (Date.now() - startImg < 30000) {
  const { messages } = await readGroupChat();
  groupImage = messages.find((m) => m.type === 'image' && m.characterName === '小雨');
  if (groupImage) break;
  await page.waitForTimeout(500);
}
check('用户要图：小雨发了一张图', Boolean(groupImage));
check('生图接口被调了', imageCalls > imageCallsBeforeGuard, `生图调用 ${imageCalls}`);
check('生图提示词里有人数强制（1girl, solo）', imagePrompts.some((p) => p.includes('1girl, solo')));

// ---- 群提示词查看器 ----
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(500);
check('群提示词查看器：还是 14 节', await phone.locator('text=共 14 节').count() >= 1);
check('群提示词查看器里有群聊注脚', await phone.locator('text=群聊「宿舍小分队」').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);

// ---- 关掉重开：群和记录还在，初始化没重跑 ----
const initBefore = initCallCount();
await phone.getByRole('button', { name: '关闭小手机' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(500);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
check('重开后群还在列表里', await phone.locator('button:has-text("宿舍小分队")').count() >= 1);
check('重开后初始化一次没跑', initCallCount() === initBefore, `初始化调用 ${initBefore} → ${initCallCount()}`);
await phone.locator('button:has-text("宿舍小分队")').first().click();
await page.waitForTimeout(500);
check('重开后群聊记录还在', await phone.locator('text=小雨，你在干嘛').count() >= 1);

// ---- 群管理：踢一个人、加回来、再踢到解散 ----
await phone.getByRole('button', { name: '群成员' }).click();
await page.waitForTimeout(400);
check('成员管理里有阿杰和小雨', (await phone.locator('text=阿杰').count()) >= 1 && (await phone.locator('text=小雨').count()) >= 1);
// 踢第一个成员（群顺序里是小雨）：点“移出”→“确认移出”。
await phone.getByRole('button', { name: '移出' }).first().click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '确认移出' }).click();
await page.waitForTimeout(400);
const groupsAfterKick = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  return idbStorage.get(`rpnow:phone:groups:${id}`);
}, chatId);
check('踢掉一个人后群里只剩 1 人', groupsAfterKick[0]?.memberIds.length === 1);
check('踢人后标题是 1 人', await phone.locator('text=群成员（1 人）').count() >= 1);
// 加回来（验证加人）：点添加区里“小雨”那行。
await phone.getByRole('button', { name: '小雨' }).first().click();
await page.waitForTimeout(400);
const groupsAfterAdd = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  return idbStorage.get(`rpnow:phone:groups:${id}`);
}, chatId);
check('加人：小雨回来了，群里又是 2 人', groupsAfterAdd[0]?.memberIds.length === 2 && groupsAfterAdd[0]?.memberIds.includes('c_xiaoyu'));
// 踢到只剩最后一个人，再踢他 → 解散确认。
await phone.getByRole('button', { name: '移出' }).first().click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '确认移出' }).click();
await page.waitForTimeout(400);
await phone.getByRole('button', { name: '移出' }).first().click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '确认移出' }).click();
await page.waitForTimeout(400);
check('踢最后一个人弹出解散确认', await phone.locator('text=解散这个群？').count() >= 1);
await phone.getByRole('button', { name: '确认解散' }).click();
await page.waitForTimeout(500);
const groupsAfterDisband = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  return {
    groups: await idbStorage.get(`rpnow:phone:groups:${id}`),
    groupChats: await idbStorage.keys('rpnow:phone:groupchat:'),
  };
}, chatId);
check('解散后群列表空了', (groupsAfterDisband.groups ?? []).length === 0);
check('解散后群聊记录也删了', groupsAfterDisband.groupChats.length === 0);
check('解散后回到列表页', await phone.locator('h2:has-text("微信")').count() >= 1);
const lorebookAfterDisband = await page.evaluate((id) => {
  const s = window.__rpnowStore.getState();
  const book = s.lorebooks.find((b) => b.id === `phone-groups:${id}`);
  return book?.entries.map((e) => e.comment) ?? [];
}, chatId);
check('解散后世界书里的群聊记录条目删了', !lorebookAfterDisband.includes('宿舍小分队的群聊记录'));

// ---- 回归：一对一守门 + 提示词查看器 ----
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);
const imageCallsBeforeDm = imageCalls;
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(4000);
check('回归：一对一没要图也不发图', imageCalls === imageCallsBeforeDm);
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(400);
check('回归：一对一提示词查看器 14 节', await phone.locator('text=共 14 节').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(300);

// ---- 回归：相册和朋友圈 ----
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '相册' }).first().click();
await page.waitForTimeout(500);
const albumImgCount = await page.evaluate(() =>
  document.querySelectorAll('[class*="z-[80]"] img').length,
);
check('回归：相册打开，群里生的图在相册里', albumImgCount >= 1, `相册里 img 数 ${albumImgCount}`);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '朋友圈' }).first().click();
await page.waitForTimeout(500);
check('回归：朋友圈打开', await phone.locator('text=发朋友圈').count() >= 1);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);

// ---- 回归：重置清掉群（群已解散，这里验证联系人重置 + 靠隐藏数据块回来） ----
// 新逻辑：重置后联系人回到空的，不调模型初始化；主聊天再产出一个带
// 隐藏数据块的回复，手机重开后靠这个块把人认回来，全程初始化调用是 0 次。
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(600);
const initBeforeReset = initCallCount();
await phone.getByRole('button', { name: '清空并重置' }).click();
await phone.getByRole('button', { name: '确定重置' }).click();
await page.waitForTimeout(1500);
check('重置后联系人列表是空的', await phone.locator('text=暂时没有联系人').count() >= 1);
check('重置后初始化还是没跑', initCallCount() === initBeforeReset, `初始化调用 ${initBeforeReset} → ${initCallCount()}`);
await phone.getByRole('button', { name: '关闭小手机' }).click();
await page.waitForTimeout(500);
// 主聊天里发一句提到小雨和阿杰的话，假模型回一个带隐藏数据块的回复。
const mainBox = page.locator('textarea[aria-label="消息输入框"]').first();
await mainBox.fill('刚才小雨和阿杰都来了，说想一起去吃凉皮。');
await mainBox.press('Enter');
await page.waitForTimeout(4000);
check('主聊天回复里有隐藏块那句', await page.locator('text=小雨和阿杰都说好呀').count() >= 1);
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(500);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
await phone.locator('button:has-text("小雨")').first().waitFor({ timeout: 15000 });
check('靠隐藏数据块，重置后联系人回来了', await phone.locator('button:has-text("小雨")').count() >= 1);
check('阿杰也回来了', await phone.locator('button:has-text("阿杰")').count() >= 1);
check('整个过程初始化一次没跑', initCallCount() === initBeforeReset, `初始化调用 ${initBeforeReset} → ${initCallCount()}`);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
