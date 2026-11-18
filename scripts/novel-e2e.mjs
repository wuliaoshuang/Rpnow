/**
 * Novel editor end-to-end: create a book, generate a chapter from the full
 * prior context, verify the title/summary split, run regex search/replace, and
 * export the TXT layout.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { acceptWebConfirm } from './e2e-helpers.mjs';

const PORT = 8819;
const lastBody = [];

const REPLY = '雨夜归人\n雨顺着屋檐往下淌，他把手按在剑柄上。\n\n---剧情摘要---\n剑客在雨夜回到小镇。';

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      lastBody.push(JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: REPLY } }] })}\n\n`);
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
page.on('dialog', (d) => void d.accept());

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock-chat',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  window.__rpnowStore = store.useApp;
}, PORT);

await page.getByRole('button', { name: '小说' }).first().click();
// The chat-list panel is mounted eagerly, so a bare 'button' selector now
// resolves to 32 nodes — scope to the page's own buttons.
await page.locator('main button', { hasText: '新建书籍' }).first().waitFor({ timeout: 15000 });
await page.locator('main button', { hasText: '新建书籍' }).first().click();
await page.waitForTimeout(800);

const bookState = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  return { books: store.novel.books.length, active: store.novel.activeBookId };
});
check('新建书籍', bookState.books === 1 && Boolean(bookState.active), JSON.stringify(bookState));

// Fill settings + characters through the UI.
await page.locator('#nv-title').fill('雨镇');
await page.locator('#nv-world').fill('常年下雨的边陲小镇。');
await page.getByRole('button', { name: '角色', exact: true }).click();
await page.locator('button[aria-label="新建小说角色"]').click();
await page.locator('input[aria-label="角色名"]').fill('阿尔');
await page.locator('textarea[aria-label="角色描述"]').fill('银发剑士');

const settings = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const book = store.novel.books.find((b) => b.id === store.novel.activeBookId);
  return { title: book?.title, world: book?.worldView, chars: book?.characters?.length ?? 0 };
});
check('设定已保存', settings.title === '雨镇' && settings.world.includes('边陲'), JSON.stringify(settings));
check('角色已保存', settings.chars === 1, `${settings.chars}`);

// Generate a chapter.
await page.locator('button', { hasText: '提笔续写' }).click();
await page.waitForTimeout(3500);

const afterGen = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const book = store.novel.books.find((b) => b.id === store.novel.activeBookId);
  return {
    chapters: book?.chapters?.length ?? 0,
    title: book?.chapters?.[0]?.title,
    content: book?.chapters?.[0]?.content,
    summary: book?.chapters?.[0]?.summary,
    wordCount: book?.chapters?.[0]?.wordCount ?? 0,
  };
});
console.log('afterGen:', JSON.stringify(afterGen));

check('章节已生成', afterGen.chapters === 1, `${afterGen.chapters}`);
check('标题解析', afterGen.title === '雨夜归人', String(afterGen.title));
check('正文解析', /屋檐/.test(afterGen.content ?? ''), String(afterGen.content).slice(0, 30));
check('摘要解析', afterGen.summary === '剑客在雨夜回到小镇。', String(afterGen.summary));
check('字数统计', afterGen.wordCount > 0, `${afterGen.wordCount}`);

// The request must contain the whole prior book + world view + characters.
const reqText = JSON.stringify(lastBody[0]?.messages ?? []);
check('请求包含世界观', reqText.includes('常年下雨'), '');
check('请求包含角色', reqText.includes('姓名：阿尔'), '');
check('请求要求剧情摘要', reqText.includes('剧情摘要'), '');

// Search / replace.
await page.locator('button', { hasText: '查找' }).click();
await page.locator('input[aria-label="查找内容"]').fill('屋檐');
await page.locator('button', { hasText: '查找全部' }).click();
await page.waitForTimeout(500);
const found = await page.locator('li', { hasText: '第 1 章' }).count();
check('正则查找命中', found > 0, `${found} 处`);

await page.locator('input[aria-label="替换为"]').fill('窗台');
await page.locator('button', { hasText: '全部替换' }).click();
await acceptWebConfirm(page, '确定');
await page.waitForTimeout(800);
const replaced = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const book = store.novel.books.find((b) => b.id === store.novel.activeBookId);
  return book?.chapters?.[0]?.content ?? '';
});
check('全部替换生效', replaced.includes('窗台') && !replaced.includes('屋檐'), replaced.slice(0, 40));

// Export TXT.
const downloadPromise = page.waitForEvent('download');
await page.locator('button', { hasText: '导出' }).click();
const download = await downloadPromise;
const path = await download.path();
const { readFileSync } = await import('node:fs');
const txt = readFileSync(path, 'utf8');
check('导出文件名', (download.suggestedFilename() || '').endsWith('.txt'), download.suggestedFilename());
check('导出包含分隔符与章节', txt.includes('===========================') && txt.includes('第 1 章 雨夜归人'), '');
check('导出包含角色汇总', txt.includes('姓名：阿尔'), '');
check('导出包含摘要汇总', txt.includes('第 1 章摘要：'), '');

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
