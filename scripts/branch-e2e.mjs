/**
 * Real-UI branch test: fork from an assistant message, continue on the branch,
 * switch back to the main line, and delete.
 *
 * No mocks — the fork/switch logic is UI-driven and the store is inspected.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { acceptWebConfirm } from './e2e-helpers.mjs';

const PORT = 8815;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.includes('/chat/completions')) {
      const text = body.messages?.some((m) => /分支/.test(m.content ?? '')) ? '这是分支里的回复。' : '这是主线的回复。';
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
// Branch deletion confirms through a native dialog.
page.on('dialog', (d) => void d.accept());

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

const box = page.locator('textarea[aria-label="消息输入框"]').first();
await box.fill('主线第一句');
await box.press('Enter');
await page.waitForTimeout(2500);

const mainMessages = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return { count: chat?.messages.length ?? 0, active: chat?.activeBranchId };
});
// Greeting + one user round = 3 floors (the sample card ships a first message).
check('主线有 3 层（开场白 + 一轮）', mainMessages.count === 3, JSON.stringify(mainMessages));

// Fork from an assistant message: the action now lives behind "更多操作".
const moreBtn = page.locator('div[data-role="assistant"] button[aria-label="更多操作"]').first();
await moreBtn.click();
await page.waitForTimeout(500);
await page.locator('[role="menu"] [role="menuitem"], [role="menuitem"]', { hasText: '从这里分支' }).first().click();
await page.waitForTimeout(1200);

const forked = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return {
    active: chat?.activeBranchId,
    branches: chat?.branches?.length ?? 0,
    mainCount: chat?.mainMessages?.length ?? chat?.messages.length ?? 0,
    viewCount: chat?.messages.length ?? 0,
  };
});
check('分支已创建并激活', forked.active !== 'main' && forked.active !== undefined, JSON.stringify(forked));
check('主线消息被保留', forked.mainCount === 3, `mainCount=${forked.mainCount}`);

// The header should show the branch badge.
const badge = await page.locator('text=/分支 \\d+/').count();
check('顶栏显示分支徽章', badge > 0, `${badge}`);

// Continue on the branch.
await box.fill('分支里的问题');
await box.press('Enter');
await page.waitForTimeout(2500);

// Messages are saved back to the branch lazily on switch, so assert on the
// in-view array here and on the stored branch after switching away.
const onBranch = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return { view: chat?.messages.length ?? 0, text: chat?.messages.at(-1)?.content ?? '' };
});
// Plates live only on the newest floor now, so the fork starts from there —
// the branch inherits the full current view (3 floors).
check('分支内消息增加', onBranch.view === 5, JSON.stringify(onBranch));
check('分支回复内容正确', onBranch.text.includes('分支'), onBranch.text);

// Switch back to the main line via the panel.
// The header ⋯ menu is gone; the right side panel holds 剧情分支 now.
const openBranchPanel = async () => {
  await page.locator('button[aria-label="打开对话设置"]').first().click();
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '剧情分支' }).first().click();
  await page.waitForTimeout(900);
};
await openBranchPanel();
await page.waitForSelector('[role="dialog"][aria-label="剧情分支"]', { timeout: 8000 });
const mainRow = page.locator('[role="dialog"] button', { hasText: '主线' }).first();
await mainRow.hover();
await mainRow.click();
await page.waitForTimeout(1200);

// The branch should now hold the message sent while it was active.
const storedBranch = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return {
    active: chat?.activeBranchId,
    view: chat?.messages.length ?? 0,
    text: chat?.messages.at(-1)?.content ?? '',
    branchCount: chat?.branches?.[0]?.messages.length ?? 0,
  };
});
check('切回主线', storedBranch.active === 'main' || storedBranch.active === undefined, JSON.stringify(storedBranch));
check('主线消息恢复（不含分支消息）', storedBranch.view === 3 && storedBranch.text.includes('主线'), JSON.stringify(storedBranch));
check('分支消息已保存回分支', storedBranch.branchCount === 5, `branchCount=${storedBranch.branchCount}`);

// Delete the branch (the panel is still open from the switch).
const delBtn = page.locator('button[aria-label="删除分支"]').first();
await delBtn.hover();
await delBtn.click();
await acceptWebConfirm(page, '确定');
await page.waitForTimeout(1200);

const afterDelete = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return { branches: chat?.branches?.length ?? 0, active: chat?.activeBranchId };
});
check('分支已删除', afterDelete.branches === 0, JSON.stringify(afterDelete));

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
