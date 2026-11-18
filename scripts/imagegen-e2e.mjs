/**
 * Auto-image end-to-end.
 *
 * The chat request is answered with `image###Tag###` markers; the NAI jobs
 * endpoint is intercepted by Playwright so the whole chain (marker -> job ->
 * image -> attached message) runs without a real paid service.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8817;
let jobCalls = 0;
let lastChatBody = null;

// 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      lastChatBody = JSON.parse(raw || '{}');
      const text = '她推开门。image###1girl, smile, indoors###风铃响了。';
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404).end();
  });
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));

// Intercept the NovelAI-style jobs API.
await page.route('https://nai.sta1n.cn/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/api/jobs/')) {
    jobCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ status: 'done', imageUrl: 'https://nai.sta1n.cn/img/1.png' }),
    });
  }
  if (url.includes('/api/jobs')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ id: 'job_1' }),
    });
  }
  if (url.includes('/img/')) {
    const base64 = PNG.split(',')[1];
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: Buffer.from(base64, 'base64'),
    });
  }
  return route.continue();
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock-chat',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  s.setSettings({
    imageGen: { ...store.useApp.getState().settings.imageGen, enabled: true, key: 'test-key', autoGenerate: true },
  });
  window.__rpnowStore = store.useApp;
}, PORT);

await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(800);

const sysText = await page.evaluate(() => JSON.stringify(window.__rpnowStore.getState().settings.imageGen));
check('生图已启用', sysText.includes('"enabled":true'), '');

const box = page.locator('textarea[aria-label="消息输入框"]').first();
await box.fill('开门');
await box.press('Enter');
await page.waitForTimeout(4000);

const sysPrompt = JSON.stringify(lastChatBody?.messages ?? []);
check('请求包含生图提示', sysPrompt.includes('auto_image_gen') && sysPrompt.includes('image###'), '');
check('提交了生图任务', jobCalls > 0, `${jobCalls} 次轮询`);

const after = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  const msg = chat?.messages.at(-1);
  return {
    content: msg?.content ?? '',
    images: msg?.images?.length ?? 0,
    tags: msg?.meta?.imageTags ?? [],
    imgElements: document.querySelectorAll('img[alt^="生成图"]').length,
  };
});
console.log('after:', JSON.stringify(after));

check('正文里的标记被替换为占位', !after.content.includes('image###'), after.content);
check('图片已生成并附加', after.images === 1, `${after.images} 张`);
check('保存了 Tag 供重 roll', after.tags.length === 1 && after.tags[0].includes('1girl'), JSON.stringify(after.tags));
check('消息里渲染出图片', after.imgElements >= 1, `${after.imgElements} 个`);

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
