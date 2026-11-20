/**
 * 小手机标记回复端到端测试（PR #51），390×844，假模型 + 假生图。
 *
 * 覆盖（新流程：一次普通模型调用 + `{...}` 标记解析，不再调工具）：
 *   - 回复请求里没有 tools / toolChoice（工具调用彻底没了）；
 *   - 模型回 `{chat:…}{image:描述 ||| 英文标签}{chat:…}{sticker:…}`：
 *     文字气泡、图、表情包按标记顺序出现，图真的生出来了；
 *   - tagsHint：Tag 转写回空时，标记里 `|||` 后面的英文标签直接当
 *     正面提示词，不再多调一次模型现写；
 *   - 没要图（“今天好累”）时模型回的 `{image:…}` 被守门丢掉：
 *     生图一次没调、聊天里没图，文字和表情包照常发；
 *   - 提示词查看器：还是 14 节，工具说明换成了“回复格式”；
 *   - 回归：群聊里每个成员也走标记回复、关掉重开记录还在、相册里
 *     有生的图、重置后初始化重跑。
 *
 * 假模型：按 system prompt 里的“你要扮演「X」”认出是哪个成员在回；
 * Tag 转写（system 里有 Danbooru）回一串 Danbooru 标签，描述里带
 * “空转写测试”时故意回空，验 tagsHint；初始化（system 里有
 * “角色卡解析助手”）回联系人 JSON。生图走 OpenAI 兼容接口，返回 1×1 PNG。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59993;
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
      // 初始化：返回联系人 JSON（重置后重新初始化走这里）。
      if (allText.includes('角色卡解析助手')) {
        sseReply(res, [
          {
            content: JSON.stringify([
              { name: '小雨', relation: '室友', relationToMain: '闺蜜', openingMessage: '在吗在吗', gender: 'female', profile: '活泼开朗' },
              { name: '阿杰', relation: '学长', relationToMain: '哥哥', openingMessage: '今天花店忙不忙', gender: 'male', profile: '稳重可靠' },
            ]),
          },
        ]);
        return;
      }
      // 回复：按 system prompt 里的“你要扮演「X」”认出是哪个成员。
      // 注意：回复的 system prompt 里“回复格式”那一节也提到了 Danbooru
      // 标签，所以回复判断要在 Tag 转写之前，不然回复会被当成转写调用。
      const who = allText.match(/你要扮演「([^」]+)」/)?.[1];
      if (who) {
        const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
        const userText = lastUser?.content ?? '';
        if (userText.includes('空转写')) {
          sseReply(res, [
            {
              content:
                '{chat:好呀，给你看看}{image:空转写测试，在宿舍楼下拍的照片 ||| 1girl, solo, dorm building, empty rewrite test}{sticker:happy}',
            },
          ]);
          return;
        }
        if (userText.includes('发张图')) {
          sseReply(res, [
            {
              content:
                '{chat:好呀，给你看看}{image:在宿舍楼下拍的照片 ||| 1girl, solo, dorm building}{chat:今天天气可好了}{sticker:happy}',
            },
          ]);
          return;
        }
        if (userText.includes('今天好累')) {
          // 没要图也写了 image 标记：守门必须拦住，文字和表情包照常发。
          sseReply(res, [
            { content: '{chat:累了就歇会儿}{image:在宿舍楼下拍的照片}{sticker:affectionate}' },
          ]);
          return;
        }
        sseReply(res, [{ content: `{chat:我是${who}，收到啦。}{sticker:happy}` }]);
        return;
      }
      // Tag 转写：回一串 Danbooru 标签；描述里带“空转写测试”时故意回空，验 tagsHint。
      if (allText.includes('Danbooru')) {
        sseReply(res, [
          {
            content: allText.includes('空转写测试')
              ? ''
              : '1girl, solo, long black hair, school uniform, dorm building exterior, masterpiece, very aesthetic, no text',
          },
        ]);
        return;
      }
      sseReply(res, [{ content: '收到。' }]);
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
  ]);
}, chatId);

// 读一对一聊天记录（IndexedDB）的小帮手。
async function readDmChat(contactId) {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    const chat = await idbStorage.get(`rpnow:phone:wechat:${id}`);
    return chat?.messages ?? [];
  }, contactId);
}
async function waitForDmMessages(contactId, count, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const messages = await readDmChat(contactId);
    if (messages.length >= count) return messages;
    await page.waitForTimeout(300);
  }
  return readDmChat(contactId);
}
/** 等一对一聊天里 assistant 的消息够数（文字/图/表情包都算）。 */
async function waitForDmAssistant(contactId, count, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const messages = await readDmChat(contactId);
    if (messages.filter((m) => m.role === 'assistant').length >= count) return messages;
    await page.waitForTimeout(300);
  }
  return readDmChat(contactId);
}
/** 回复里有没有工具调用：system prompt 里带“你要扮演”的那次调用。 */
function replyCalls() {
  return llmBodies.filter((b) =>
    (b.messages ?? []).some((m) => (m.content ?? '').includes('你要扮演')),
  );
}
const initCallCount = () =>
  llmBodies.filter((b) =>
    (b.messages ?? []).some((m) => (m.content ?? '').includes('角色卡解析助手')),
  ).length;

// 打开小手机 → 微信 → 小雨。
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
check('状态栏在（关闭按钮可见）', await phone.getByRole('button', { name: '关闭小手机' }).isVisible());
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
check('列表里有 2 个联系人', await phone.locator('button:has-text("小雨")').count() >= 1);
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);

// ---- 要图：标记回复按顺序出文字、图、文字、表情包 ----
const imageCallsBefore = imageCalls;
const dmBeforeImage = await readDmChat('c_xiaoyu');
await phone.getByPlaceholder('发消息…').fill('小雨，发张图给我看看');
await phone.getByRole('button', { name: '发送' }).click();
// 问候语（1 条）+ 这次的 4 条回复（文字、图、文字、表情包）。
const dmAfterImage = await waitForDmAssistant('c_xiaoyu', 5);
const assistantAfterImage = dmAfterImage
  .slice(dmBeforeImage.length + 1) // 去掉用户刚发的那句
  .filter((m) => m.role === 'assistant');
check(
  '要图：标记按顺序出段（文字、图、文字、表情包）',
  JSON.stringify(assistantAfterImage.map((m) => m.type)) === JSON.stringify(['text', 'image', 'text', 'sticker']),
  JSON.stringify(assistantAfterImage.map((m) => `${m.type}:${(m.content ?? '').slice(0, 12)}`)),
);
check('要图：第一条文字是标记里的第一句', assistantAfterImage[0]?.content === '好呀，给你看看');
check('要图：第二条文字是标记里的第二句', assistantAfterImage[2]?.content === '今天天气可好了');
check('要图：聊天里没有出现原始标记', !dmAfterImage.some((m) => (m.content ?? '').includes('{chat:') || (m.content ?? '').includes('{image:') || (m.content ?? '').includes('{sticker:')));
check('要图：生图接口被调了一次', imageCalls === imageCallsBefore + 1, `生图调用 ${imageCallsBefore} → ${imageCalls}`);
check('要图：生图提示词里有人数强制（1girl, solo）', imagePrompts.some((p) => p.includes('1girl, solo')));
const replies = replyCalls();
check('回复调用了一次模型', replies.length === 1, `实际 ${replies.length} 次`);
check('回复请求里没有 tools（工具调用彻底没了）', replies.every((b) => !('tools' in b) && !('toolChoice' in b)));
check(
  '回复的 system prompt 里有“回复格式”那一节、没有工具说明',
  replies[0]?.messages[0]?.content.includes('{chat:') && !replies[0]?.messages[0]?.content.includes('send_image'),
);

// ---- tagsHint：Tag 转写回空时，标记里的英文标签直接当正面提示词 ----
const imageCallsBeforeHint = imageCalls;
const imagesBeforeHint = (await readDmChat('c_xiaoyu')).filter((m) => m.type === 'image').length;
await phone.getByPlaceholder('发消息…').fill('小雨，发张图给我看看，空转写');
await phone.getByRole('button', { name: '发送' }).click();
let dmAfterHint = await readDmChat('c_xiaoyu');
{
  const start = Date.now();
  while (Date.now() - start < 30000) {
    dmAfterHint = await readDmChat('c_xiaoyu');
    if (dmAfterHint.filter((m) => m.type === 'image').length > imagesBeforeHint) break;
    await page.waitForTimeout(300);
  }
}
const newImages = dmAfterHint.slice(dmAfterImage.length).filter((m) => m.type === 'image');
check('tagsHint：图还是生出来了', newImages.length === 1, `新图 ${newImages.length} 张`);
check(
  'tagsHint：生图提示词用了标记里的英文标签',
  imagePrompts.slice(imageCallsBeforeHint).some((p) => p.includes('empty rewrite test')),
  JSON.stringify(imagePrompts.slice(imageCallsBeforeHint)),
);

// ---- 守门：没要图，模型回的 {image:…} 被丢掉 ----
const imageCallsBeforeGuard = imageCalls;
const dmBeforeGuard = await readDmChat('c_xiaoyu');
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(5000);
const dmAfterGuard = await readDmChat('c_xiaoyu');
const guardNew = dmAfterGuard.slice(dmBeforeGuard.length);
check('没要图：模型想发图也被拦住，生图一次没调', imageCalls === imageCallsBeforeGuard, `生图调用 ${imageCallsBeforeGuard} → ${imageCalls}`);
check(
  '没要图：聊天里没出现图，只有文字和表情包',
  guardNew.filter((m) => m.role === 'assistant').map((m) => m.type).join(',') === 'text,sticker',
  JSON.stringify(guardNew.map((m) => `${m.role}:${m.type}`)),
);
check('没要图：文字照常显示', guardNew.some((m) => m.role === 'assistant' && m.type === 'text' && m.content === '累了就歇会儿'));

// ---- 提示词查看器：14 节，工具说明换成了“回复格式” ----
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(500);
check('提示词查看器：还是 14 节', await phone.locator('text=共 14 节').count() >= 1);
check('提示词查看器里有“回复格式”', await phone.locator('text=回复格式').count() >= 1);
check('提示词查看器里没有“工具说明”', (await phone.locator('text=工具说明').count()) === 0);
check('提示词查看器里教了 {chat} 标记', await phone.locator('text={chat:').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);

// ---- 回归：群聊里每个成员也走标记回复 ----
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(400);
await phone.getByRole('button', { name: '新建群聊' }).click();
await phone.getByPlaceholder('群名（比如：宿舍小分队）').fill('宿舍小分队');
await phone.locator('button:has-text("小雨")').last().click();
await phone.locator('button:has-text("阿杰")').last().click();
await phone.getByRole('button', { name: '创建' }).click();
await page.waitForTimeout(500);
check('建群后打开群聊，标题是群名', await phone.locator('h2:has-text("宿舍小分队")').count() >= 1);
const repliesBeforeGroup = replyCalls().length;
await phone.getByPlaceholder('发消息…').fill('大家都在吗');
await phone.getByRole('button', { name: '发送' }).click();
const groupChat = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  const groups = (await idbStorage.get(`rpnow:phone:groups:${id}`)) ?? [];
  if (groups.length === 0) return [];
  const chat = await idbStorage.get(`rpnow:phone:groupchat:${groups[0].id}`);
  return chat?.messages ?? [];
}, chatId);
let groupMessages = groupChat;
{
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const current = await page.evaluate(async (id) => {
      const { idbStorage } = await import('/src/core/storage/index.ts');
      const groups = (await idbStorage.get(`rpnow:phone:groups:${id}`)) ?? [];
      if (groups.length === 0) return [];
      const chat = await idbStorage.get(`rpnow:phone:groupchat:${groups[0].id}`);
      return chat?.messages ?? [];
    }, chatId);
    groupMessages = current;
    if (current.filter((m) => m.role === 'assistant' && m.type === 'text').length >= 1) break;
    await page.waitForTimeout(300);
  }
}
const groupReplies = groupMessages.filter((m) => m.role === 'assistant' && m.type === 'text');
check('群聊：有人回了，文字是标记里的那句', groupReplies.length >= 1 && groupReplies[0].content.includes('收到啦'));
check(
  '群聊：回复调用还是没有 tools',
  replyCalls().slice(repliesBeforeGroup).every((b) => !('tools' in b) && !('toolChoice' in b)),
);
check('群聊：聊天里没有原始标记', !groupMessages.some((m) => (m.content ?? '').includes('{chat:')));

// ---- 回归：关掉重开记录还在，相册里有图，重置重跑初始化 ----
await phone.getByRole('button', { name: '关闭小手机' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(500);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
// 群的副标题里也有成员名（“小雨、阿杰”），所以按名字整词匹配联系人那一行，
// 不能用 :has-text("小雨")——它会先撞上排在前面的群。
await phone.locator('button:has(span:text-is("小雨"))').first().click();
await page.waitForTimeout(500);
check('重开后一对一记录还在（要图那句）', await phone.locator('text=好呀，给你看看').count() >= 1);
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '相册' }).first().click();
await page.waitForTimeout(500);
const albumImgCount = await page.evaluate(() =>
  document.querySelectorAll('[class*="z-[80]"] img').length,
);
check('回归：相册打开，生的图在相册里', albumImgCount >= 1, `相册里 img 数 ${albumImgCount}`);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(600);
const initBeforeReset = initCallCount();
await phone.getByRole('button', { name: '清空并重置' }).click();
await phone.getByRole('button', { name: '确定重置' }).click();
let initAfterReset = initBeforeReset;
{
  const start = Date.now();
  while (Date.now() - start < 15000) {
    initAfterReset = initCallCount();
    if (initAfterReset > initBeforeReset) break;
    await page.waitForTimeout(300);
  }
}
check('重置后初始化重跑了一次', initAfterReset > initBeforeReset, `初始化调用 ${initBeforeReset} → ${initAfterReset}`);
await phone.locator('button:has-text("小雨")').first().waitFor({ timeout: 15000 });
check('重置后联系人回来了', await phone.locator('button:has-text("小雨")').count() >= 1);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
