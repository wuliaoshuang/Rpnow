/**
 * 小手机日记 + 运势端到端测试（PR #50），390×844，假模型。
 *
 * 覆盖：
 *   - 主屏幕上有微信、朋友圈、相册、日记、运势五个应用；
 *   - 日记：第一次打开是空的；手写一篇 → 出现；让小雨写一篇（假模型）
 *     → 以小雨的第一人称出现，带“小雨的日记”；删一篇 → 消失；
 *     AI 日记的提示词里有小雨的人设和主线剧情进度（先在主聊天里发一句）；
 *   - 运势：挑“爱情”占卜（假模型）→ 标题/解读/幸运色/幸运数字/口头禅
 *     都出现；挑“健康”占卜（假模型回空）→ 静态兜底解读出现，不再调模型；
 *     抽塔罗 → 牌名 + 正位/逆位 + 解读出现；
 *   - 关掉重开 → 日记和运势结果还在，初始化一次都没重跑；
 *   - 回归：重置清掉日记和运势（联系人重新初始化）；一对一没要图不发图
 *     守门；提示词查看器 14 节；状态栏；相册；朋友圈；好感度；微信记录还在。
 *
 * 假模型：按提示词里的标记认出是哪种调用——初始化（“角色卡解析助手”）
 * 回联系人 JSON；日记（“第一人称写一篇日记”）回一段日记；占星师回带标签
 * 的运势（健康那次故意回空，验静态兜底）；塔罗占卜师回一段解读；微信回复
 * 按“你要扮演「X」”认人，永远带一个 send_image 工具调用（验守门）。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59992;
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
let imageCalls = 0;

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }] }));
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
              { name: '王阿姨', relation: '', relationToMain: '房东', openingMessage: '房租该交了', gender: 'female', profile: '热心肠' },
            ]),
          },
        ]);
        return;
      }
      // 日记代写：回一段第一人称日记。
      if (allText.includes('第一人称写一篇日记')) {
        sseReply(res, [
          { content: '今天军训集合累得够呛，回来吃了凉皮才活过来。想起小林说的话，心里暖暖的，明天也要加油。' },
        ]);
        return;
      }
      // 运势占卜：回带标签的运势；健康那次故意回空，验静态兜底。
      if (allText.includes('占星师')) {
        if (allText.includes('健康运势')) {
          sseReply(res, [{ content: '' }]);
          return;
        }
        sseReply(res, [
          {
            content: '标题：心意会传到的日子\n解读：今天适合把心里的话说出口，不用铺垫太多，真诚本身就够动人。单身的话，多留意那个总在你附近出现的人。\n幸运色：粉色\n幸运数字：2\n口头禅：真诚一点点就好。',
          },
        ]);
        return;
      }
      // 塔罗：回一段解读（牌名是组件随机抽的，模型只写解读）。
      if (allText.includes('塔罗占卜师')) {
        sseReply(res, [{ content: '星星指引着你，今天适合抬头看看夜空，好运正在路上。' }]);
        return;
      }
      // Tag 转写：回一串 Danbooru 标签。
      if (allText.includes('Danbooru')) {
        sseReply(res, [
          { content: '1girl, solo, long black hair, school uniform, dorm building exterior, masterpiece, very aesthetic, no text' },
        ]);
        return;
      }
      // 微信回复：按 system prompt 里的“你要扮演「X」”认人。
      if (allText.includes('你要扮演')) {
        const who = allText.match(/你要扮演「([^」]+)」/)?.[1] ?? '成员';
        const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
        const userText = lastUser?.content ?? '';
        const wantsImage = /发张图|发照片|发个图|自拍|看看你/.test(userText);
        const toolDelta = {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              function: {
                name: 'send_image',
                arguments: JSON.stringify({ description: '在宿舍楼下拍的照片', people: 'solo' }),
              },
            },
          ],
        };
        sseReply(
          res,
          [{ content: `我是${who}，收到啦。` }, toolDelta],
          wantsImage ? 'tool_calls' : 'stop',
        );
        return;
      }
      // 主聊天：普通文字回复。
      sseReply(res, [{ content: '收到，今天军训辛苦了。' }]);
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

const initCallCount = () =>
  llmBodies.filter((b) =>
    (b.messages ?? []).some((m) => (m.content ?? '').includes('角色卡解析助手')),
  ).length;

async function readDiary() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:diary:${id}`)) ?? [];
  }, chatId);
}
async function readFortune() {
  return page.evaluate(async (id) => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    return (await idbStorage.get(`rpnow:phone:fortune:${id}`)) ?? null;
  }, chatId);
}
async function waitForDiaryCount(n, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await readDiary()).length >= n) return true;
    await page.waitForTimeout(300);
  }
  return (await readDiary()).length >= n;
}
async function waitForFortune(key, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const f = await readFortune();
    if (f?.[key]) return f;
    await page.waitForTimeout(300);
  }
  return readFortune();
}

// ---- 主聊天里先发一句（给剧情进度和日记提示词用） ----
await page.locator('textarea[aria-label="消息输入框"]').fill('今天军训集合，大家都好累');
await page.getByRole('button', { name: '发送' }).first().click();
await page.waitForTimeout(4000);
check('主聊天里发了一句，模型回了', await page.locator('text=收到，今天军训辛苦了。').count() >= 1);

// ---- 打开小手机：主屏幕上有五个应用 ----
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
check('状态栏在（关闭按钮可见）', await phone.getByRole('button', { name: '关闭小手机' }).isVisible());
for (const label of ['微信', '朋友圈', '相册', '日记', '运势']) {
  check(`主屏幕上有“${label}”`, await phone.getByRole('button', { name: label }).first().isVisible());
}

// ---- 日记：第一次打开是空的 ----
await phone.getByRole('button', { name: '日记' }).first().click();
await page.waitForTimeout(700);
check('日记第一次打开是空的', await phone.locator('text=还没有日记。').count() >= 1);

// ---- 手写一篇日记 ----
await phone.getByRole('textbox', { name: '写日记' }).fill('今天去吃了凉皮，好满足。');
await phone.getByRole('button', { name: '保存日记' }).click();
await page.waitForTimeout(500);
check('手写日记出现在列表里', await phone.locator('text=今天去吃了凉皮，好满足。').count() >= 1);
check('手写日记标着“我的日记”', await phone.locator('text=我的日记').count() >= 1);
check('手写日记存进 IndexedDB', (await readDiary()).length === 1);

// ---- 让小雨写一篇日记 ----
await phone.getByRole('button', { name: '让角色写日记' }).click();
await page.waitForTimeout(400);
await phone.locator('button:has-text("小雨")').last().click();
const aiDiaryOk = await waitForDiaryCount(2);
check('AI 日记生成了', aiDiaryOk);
const diaryEntries = await readDiary();
const aiEntry = diaryEntries.find((e) => e.characterName === '小雨');
check('AI 日记归属是小雨', Boolean(aiEntry), JSON.stringify(diaryEntries.map((e) => e.characterName)));
check('AI 日记内容是模型回的那段', aiEntry?.content.includes('军训集合') ?? false);
check('AI 日记标题是“小雨的日记”', await phone.locator('text=小雨的日记').count() >= 1);
const diaryCall = llmBodies.find((b) =>
  (b.messages ?? []).some((m) => (m.content ?? '').includes('第一人称写一篇日记')),
);
const diaryPrompt = (diaryCall?.messages ?? []).map((m) => m.content ?? '').join('\n');
check('日记提示词里有小雨的人设', diaryPrompt.includes('活泼开朗'));
check('日记提示词里有主线剧情进度（军训集合）', diaryPrompt.includes('今天军训集合'));

// ---- 删一篇日记（删手写那篇，它现在排第二） ----
await phone.getByRole('button', { name: '删除这篇日记' }).nth(1).click();
await page.waitForTimeout(500);
check('删掉手写日记后它不见了', await phone.locator('text=今天去吃了凉皮，好满足。').count() === 0);
check('AI 日记还在', await phone.locator('text=小雨的日记').count() >= 1);
check('删除后 IndexedDB 里只剩 1 篇', (await readDiary()).length === 1);

// ---- 运势：爱情占卜（假模型） ----
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '运势' }).first().click();
await page.waitForTimeout(700);
let allCategoriesVisible = true;
for (const label of ['事业', '爱情', '财运', '健康']) {
  if ((await phone.getByRole('button', { name: label, exact: true }).count()) < 1) allCategoriesVisible = false;
}
check('运势打开，四个类别都在', allCategoriesVisible);
await phone.getByRole('button', { name: '爱情', exact: true }).click();
await phone.getByRole('button', { name: '占卜今天的爱情运势' }).click();
const horo = await waitForFortune('horoscope');
check('爱情运势占卜出结果了', Boolean(horo?.horoscope));
check('运势标题出现', await phone.locator('text=心意会传到的日子').count() >= 1);
check('运势解读出现', await phone.locator('text=真诚本身就够动人').count() >= 1);
check('幸运色出现', await phone.locator('text=幸运色：粉色').count() >= 1);
check('幸运数字出现', await phone.locator('text=幸运数字：2').count() >= 1);
check('口头禅出现', await phone.locator('text=真诚一点点就好。').count() >= 1);
check('复制按钮在', await phone.getByRole('button', { name: '复制运势结果' }).count() >= 1);

// ---- 运势：健康占卜（假模型回空 → 静态兜底） ----
await phone.getByRole('button', { name: '健康', exact: true }).click();
await phone.getByRole('button', { name: '占卜今天的健康运势' }).click();
await page.waitForTimeout(3000);
const horoHealth = await readFortune();
check('健康运势也存下来了（兜底）', Boolean(horoHealth?.horoscope));
check(
  '健康运势是静态兜底解读（模型回空，没有第二轮模型调用）',
  /多喝水|睡个好觉|动一动/.test(await phone.locator('section[aria-label="运势占卜"]').innerText()),
);
const horoscopeCalls = llmBodies.filter((b) =>
  (b.messages ?? []).some((m) => (m.content ?? '').includes('占星师')),
).length;
check('健康兜底没有多调模型（占星师调用还是 2 次）', horoscopeCalls === 2, `实际 ${horoscopeCalls} 次`);

// ---- 塔罗抽牌 ----
await phone.getByRole('button', { name: '抽一张塔罗牌' }).click();
const tarotState = await waitForFortune('tarot');
check('塔罗抽牌出结果了', Boolean(tarotState?.tarot));
check('塔罗解读出现（模型回的那段）', await phone.locator('text=星星指引着你').count() >= 1);
check(
  '塔罗牌名 + 正位/逆位出现',
  /（正位|逆位）/.test(await phone.locator('section[aria-label="塔罗占卜"]').innerText()),
);
check('塔罗复制按钮在', await phone.getByRole('button', { name: '复制塔罗结果' }).count() >= 1);

// ---- 关掉重开：日记和运势还在，初始化没重跑 ----
const initBefore = initCallCount();
await phone.getByRole('button', { name: '关闭小手机' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(500);
check('重开后初始化一次没跑', initCallCount() === initBefore, `初始化调用 ${initBefore} → ${initCallCount()}`);
await phone.getByRole('button', { name: '日记' }).first().click();
await page.waitForTimeout(700);
check('重开后 AI 日记还在', await phone.locator('text=小雨的日记').count() >= 1);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '运势' }).first().click();
await page.waitForTimeout(700);
const reopenedFortune = await readFortune();
check(
  '重开后运势结果还在（健康兜底的标题还在屏幕上）',
  Boolean(reopenedFortune?.horoscope) &&
    (await phone.locator('text=' + reopenedFortune.horoscope.title).count()) >= 1,
);
check('重开后塔罗结果还在', await phone.locator('text=星星指引着你').count() >= 1);

// ---- 回归：一对一守门 + 提示词查看器 + 好感度 ----
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);
const imageCallsBeforeDm = imageCalls;
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(4000);
check('回归：一对一没要图也不发图', imageCalls === imageCallsBeforeDm);
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(400);
check('回归：提示词查看器 14 节', await phone.locator('text=共 14 节').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);
const contactsAfter = await page.evaluate(async (id) => {
  const { idbStorage } = await import('/src/core/storage/index.ts');
  return idbStorage.get(`rpnow:phone:contacts:${id}`);
}, chatId);
check('回归：小雨好感度涨到 2（一轮 +2）', contactsAfter.find((c) => c.id === 'c_xiaoyu')?.affection === 2);
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(300);

// ---- 回归：相册和朋友圈 ----
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '相册' }).first().click();
await page.waitForTimeout(500);
check('回归：相册能打开', await phone.locator('text=相册').count() >= 1);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '朋友圈' }).first().click();
await page.waitForTimeout(500);
check('回归：朋友圈能打开', await phone.locator('text=发朋友圈').count() >= 1);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);

// ---- 回归：重置清掉日记和运势，联系人重新初始化 ----
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
check('重置后日记清掉了', (await readDiary()).length === 0);
check('重置后运势清掉了', (await readFortune()) === null);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
