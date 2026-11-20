/**
 * 小手机工具调用回复端到端测试（PR #51 回退验证），390×844，假模型 + 假生图。
 *
 * 覆盖 PR #51 回退后必须恢复的行为：
 *   (a) 回复请求里带 tools / tool_choice: 'auto'（Agent 工具调用回来了）；
 *   (b) 假模型调 send_image 工具 → 走完整生图管线（Tag 转写 + 人数强制
 *       + 画师串 + 负面提示词），图出现在聊天里和相册里；
 *   (c) 没要图时的守门还在：用户说“今天好累”，假模型照样调 send_image
 *       也生不出来图（生图调用还是 0 新增），文字和表情包照常发；
 *   (d) 提示词查看器还是 14 节，里面有“工具说明”。
 *
 * 假模型：Tag 转写（system 里有 Danbooru）回一串带辨识标签的 Danbooru 标签；
 * 回复按用户那句切换：要图时回文字 + send_image 工具调用，没要图时
 * （“今天好累”）也硬塞一个 send_image + 一个 send_sticker 工具调用，
 * 这样守门是真拦住了工具调用，不是模型本来就没调。生图走 OpenAI 兼容
 * 接口，返回 1×1 PNG。
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 59992;
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
      // 初始化：返回联系人 JSON。
      if (allText.includes('角色卡解析助手')) {
        sseReply(res, [
          {
            content: JSON.stringify([
              { name: '小雨', relation: '室友', relationToMain: '闺蜜', openingMessage: '在吗在吗', gender: 'female', profile: '活泼开朗' },
            ]),
          },
        ]);
        return;
      }
      // Tag 转写：回一串带辨识标签的 Danbooru 标签（school uniform 和
      // cherry blossom petals 只可能来自转写，证明转写真的跑了）。
      if (allText.includes('Danbooru')) {
        sseReply(res, [
          { content: '1girl, solo, long black hair, school uniform, cherry blossom petals, masterpiece, very aesthetic, no text' },
        ]);
        return;
      }
      // 回复：按用户那句切换。两种情况都带 send_image 工具调用——
      // 要图时该发出来，没要图时守门必须拦住。
      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'user');
      const userText = lastUser?.content ?? '';
      const imageToolDelta = {
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
      if (/发张图|发照片|发个图|自拍|看看你/.test(userText)) {
        sseReply(res, [{ content: '给你看看，我刚拍的照片。' }, imageToolDelta], 'tool_calls');
        return;
      }
      if (/今天好累/.test(userText)) {
        sseReply(
          res,
          [
            { content: '好累呀，抱抱我。' },
            {
              tool_calls: [
                imageToolDelta.tool_calls[0],
                {
                  index: 1,
                  id: 'call_2',
                  function: { name: 'send_sticker', arguments: JSON.stringify({ emotion: 'happy' }) },
                },
              ],
            },
          ],
          'tool_calls',
        );
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

// Seed：卡 + 假模型连接 + 假生图连接 + 小手机画师串/负面提示词。
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
  // 画师串和负面提示词用辨识 token，生图请求里能认出来。
  s.setSettings({
    phone: { imageArtistTags: 'e2e_artist_tag', imageNegativePrompt: 'e2e_negative_tag' },
  });
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
  ]);
}, chatId);

async function readWechat() {
  return page.evaluate(async () => {
    const { idbStorage } = await import('/src/core/storage/index.ts');
    const chat = await idbStorage.get('rpnow:phone:wechat:c_xiaoyu');
    return chat?.messages ?? [];
  });
}
async function waitForWechatType(type, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const msgs = await readWechat();
    if (msgs.some((m) => m.type === type)) return msgs;
    await page.waitForTimeout(400);
  }
  return readWechat();
}

// 打开小手机 → 微信 → 小雨。
await page.getByRole('button', { name: '打开操作面板' }).click();
await page.getByRole('button', { name: '小手机' }).click();
await page.waitForTimeout(600);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(800);
check('列表里有小雨', await phone.locator('button:has-text("小雨")').count() >= 1);
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);

// ---- (b) 要图：send_image 工具调用 → 完整生图管线 ----
await phone.getByPlaceholder('发消息…').fill('小雨，发张图给我看看');
await phone.getByRole('button', { name: '发送' }).click();
const afterImageRound = await waitForWechatType('image');
const imageMsg = afterImageRound.find((m) => m.type === 'image');
check('要图：聊天里出现了一张图消息', Boolean(imageMsg));
check('要图：生图接口被调了 1 次', imageCalls === 1, `生图调用 ${imageCalls}`);
const imgPrompt = imagePrompts[0] ?? '';
check('生图提示词里有 Tag 转写的辨识标签（school uniform）', imgPrompt.includes('school uniform'), imgPrompt.slice(0, 200));
check('生图提示词里有人数强制（1girl, solo）', imgPrompt.includes('1girl, solo'));
check('生图提示词后面拼了画师串（e2e_artist_tag）', imgPrompt.includes('e2e_artist_tag'));
check('生图请求里带了负面提示词（Negative: e2e_negative_tag）', imgPrompt.includes('Negative: e2e_negative_tag'));
check('要图：聊天界面里能看到图', (await phone.locator('img').count()) >= 1);

// ---- (a) 回复请求里带 tools / tool_choice ----
const replyBodies = llmBodies.filter((b) => Array.isArray(b.tools));
check('回复请求里带了 tools', replyBodies.length >= 1, `带 tools 的请求 ${replyBodies.length} 个`);
const toolNames = (replyBodies[0]?.tools ?? []).map((t) => t.function?.name);
check('tools 里有 send_image 和 send_sticker', toolNames.includes('send_image') && toolNames.includes('send_sticker'), toolNames.join(','));
check("tool_choice 是 'auto'", replyBodies[0]?.tool_choice === 'auto', `实际 ${replyBodies[0]?.tool_choice}`);

// ---- 相册：图在相册里 ----
await phone.getByRole('button', { name: '返回联系人' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '相册' }).first().click();
await page.waitForTimeout(500);
const albumImgCount = await page.evaluate(() =>
  document.querySelectorAll('[class*="z-[80]"] img').length,
);
check('相册打开，生的图在相册里', albumImgCount >= 1, `相册里 img 数 ${albumImgCount}`);
await phone.getByRole('button', { name: '返回主屏幕' }).click();
await page.waitForTimeout(300);
await phone.getByRole('button', { name: '微信' }).first().click();
await page.waitForTimeout(600);
await phone.locator('button:has-text("小雨")').first().click();
await page.waitForTimeout(500);

// ---- (c) 守门：没要图，模型硬调 send_image 也生不出来 ----
const imageCallsBeforeGuard = imageCalls;
await phone.getByPlaceholder('发消息…').fill('今天好累');
await phone.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(5000);
check('没要图：生图一次没多调（守门拦住了工具调用）', imageCalls === imageCallsBeforeGuard, `生图调用 ${imageCallsBeforeGuard} → ${imageCalls}`);
check('没要图：文字照常发出来了', await phone.locator('text=好累呀，抱抱我。').count() >= 1);
const afterGuard = await readWechat();
check('没要图：表情包照常发出来了（send_sticker 工具调用）', afterGuard.some((m) => m.type === 'sticker'));
check('没要图：聊天里还是只有第一轮那 1 张图', afterGuard.filter((m) => m.type === 'image').length === 1);

// ---- (d) 提示词查看器：14 节 + “工具说明” ----
await phone.getByRole('button', { name: '提示词构成' }).click();
await page.waitForTimeout(500);
check('提示词查看器：还是 14 节', await phone.locator('text=共 14 节').count() >= 1);
check('提示词查看器里有“工具说明”这一节', await phone.locator('text=工具说明').count() >= 1);
await phone.getByRole('button', { name: '返回聊天' }).click();
await page.waitForTimeout(300);

check('页面无报错', errors.length === 0, errors.join(' | ').slice(0, 300));

await browser.close();
mock.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
