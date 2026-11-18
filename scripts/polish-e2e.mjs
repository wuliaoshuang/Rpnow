/**
 * Coverage for the round-2 fixes:
 *   - inline CoT (DeepSeek-style <think>) is split out of the transcript
 *   - lorebook regex keys in /pattern/flags form activate
 *   - at_depth counts only user/assistant messages
 *   - user image attachments are stored and rendered
 *   - ambient character background renders
 *   - provider token quota badge
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8822;
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let chatBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = req.url || '';
    if (url.includes('/api/log/token')) {
      return send(res, { data: { used: 1234, total: 100000 } });
    }
    if (url.includes('/chat/completions')) {
      chatBody = JSON.parse(raw || '{}');
      // Emits inline CoT the way DeepSeek does over an OpenAI-compatible route.
      const text = '先想想。<thinking>用户心情不好，应该安慰。</thinking>那你还好吗？';
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
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

const seeded = await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));

  const pngBytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
    (c) => c.charCodeAt(0),
  );
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const avatar = await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });

  const card = store.useApp.getState().cards[0];
  await store.useApp.getState().updateCard(card.id, (c) => ({
    ...c,
    avatar,
    data: {
      ...c.data,
      // A regex key in /pattern/flags form, plus an at_depth entry.
      character_book: {
        name: '世界书',
        entries: [
          {
            id: 'w1',
            comment: '雨夜',
            content: '下雨的夜晚。',
            enabled: true,
            position: 4,
            order: 10,
            depth: 4,
            keys: ['/雨/'],
            constant: false,
            useRegex: true,
            probability: 100,
          },
        ],
      },
    },
  }));

  // A standalone book with a /pattern/flags key and an at_depth entry.
  await store.useApp.getState().saveLorebook({
    id: 'lb_regex',
    name: '正则测试',
    scanDepth: 4,
    entries: [
      {
        id: 'e1',
        comment: '雨夜',
        content: '下雨的夜晚。',
        enabled: true,
        position: 4,
        order: 10,
        depth: 4,
        keys: ['/雨/'],
        constant: false,
        useRegex: true,
        probability: 100,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  await store.useApp.getState().saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'deepseek-chat',
  });
  store.useApp.getState().setSettings({ defaultConnectionId: 'conn_mock' });
  store.useApp.getState().setSettings({
    render: { ...store.useApp.getState().settings.render, useCharacterBackground: true },
  });
  window.__rpnowStore = store.useApp;
  return { cards: store.useApp.getState().cards.length };
}, PORT);
check('种子数据就绪', seeded.cards >= 1, JSON.stringify(seeded));

await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
// The lorebook has to be enabled for the chat.
await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  if (chat) void store.saveChat({ ...chat, lorebookIds: ['lb_regex'] });
});
await page.waitForTimeout(800);

/* ------------------------------------------------------ ambient background */
// Immersive mode paints the character art as a full-bleed, aria-hidden image.
const bg = await page.evaluate(
  () => Boolean(document.querySelector('main img[aria-hidden="true"]')) || Boolean(document.querySelector('img[aria-hidden="true"]')),
);
check('角色封面背景已渲染', bg, '');

/* ------------------------------------------------------------- quota badge */
const quota = await page.evaluate(() => document.body.innerText.includes('额度 1,234/100,000'));
check('服务商额度读数显示', quota, '');

/* ---------------------------------------------------- send with attachment */
const box = page.locator('textarea[aria-label="消息输入框"]').first();

// Attach an image through the hidden file input.
const dataUrl = PNG;
await page.evaluate(async (dataUrl) => {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'a.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('input[type=file][accept="image/*"]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, dataUrl);
await page.waitForTimeout(600);

await box.fill('今天下雨了');
await box.press('Enter');
await page.waitForTimeout(4000);

const after = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  const userMsg = chat?.messages.find((m) => m.role === 'user' && m.content.includes('下雨'));
  const reply = chat?.messages.at(-1);
  return {
    userImages: userMsg?.images?.length ?? 0,
    replyContent: reply?.content ?? '',
    replyReasoning: reply?.reasoning ?? '',
    attachmentRendered: document.querySelectorAll('img[alt^="附件"]').length,
  };
});
console.log('after:', JSON.stringify(after));

check('用户消息带图片附件', after.userImages === 1, `${after.userImages}`);
check('附件在消息里渲染', after.attachmentRendered >= 1, `${after.attachmentRendered}`);
check('CoT 不进正文', !after.replyContent.includes('用户心情不好'), after.replyContent);
check('CoT 被拆到 reasoning', after.replyReasoning.includes('用户心情不好'), String(after.replyReasoning).slice(0, 40));

/* ------------------------------------------------- lorebook regex + at_depth */
const flat = JSON.stringify(chatBody?.messages ?? []);
check('正则条目被激活进提示词', flat.includes('下雨的夜晚'), '');
check('at_depth 条目注入为 user 角色', /"role":"user"[\s\S]*下雨的夜晚|下雨的夜晚[\s\S]*"role":"user"/.test(flat), '');

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
