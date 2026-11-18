/**
 * Background/UI separation under the keyboard, helper-row spacing, remembered
 * chat selection, and group-chat greeting + speaker names.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8841;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '回复。' } }] })}\n\n`);
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async (port) => {
  const s = window.__rpnowStore.getState();
  for (const [id, name, fm] of [
    ['ca', '阿离', '阿离开口。'],
    ['cb', '白露', '白露开口。'],
    ['cc', '长风', '长风开口。'],
  ]) {
    await s.addCard({
      id, avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name, description: `${name}设定。`, personality: '', scenario: '', first_mes: fm, mes_example: '' },
    });
  }
  const mk = (id, cardId, title) => ({
    id, title, cardId, lorebookIds: [], useCardLorebook: true,
    messages: [{ id: `${id}m`, role: 'assistant', content: '测试。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await s.saveChat(mk('chat_old', 'ca', '旧会话'));
  await s.saveChat(mk('chat_new', 'cb', '新会话'));
  await s.saveLLMConnection({
    id: 'conn_k', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_k' });
}, PORT);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1000);

// ---- background vs UI separation under keyboard -------------------------
// Deliberately select the OLD chat so we can also test persistence below.
await page.evaluate(() => window.__rpnowStore.getState().setActiveChat('chat_old'));
await page.waitForTimeout(600);

const before = await page.evaluate(() => {
  const img = document.querySelector('main img[aria-hidden="true"]');
  const r = img.getBoundingClientRect();
  return { bgH: Math.round(r.height), bgW: Math.round(r.width), vh: window.innerHeight };
});
check('背景铺满视口（键盘未弹出）', before.bgH >= before.vh - 2, JSON.stringify(before));

await page.evaluate(() => {
  const real = window.visualViewport.height;
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => real - 340 });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(800);

const after = await page.evaluate(() => {
  const img = document.querySelector('main img[aria-hidden="true"]');
  const r = img.getBoundingClientRect();
  const h = document.querySelector('header').getBoundingClientRect();
  const row = document.querySelector('button[aria-label="插入引号"]')?.closest('div')?.parentElement;
  const rr = row?.getBoundingClientRect();
  const vvH = window.visualViewport.height;
  return {
    bgH: Math.round(r.height),
    bgW: Math.round(r.width),
    vh: window.innerHeight,
    headerTop: Math.round(h.top),
    rowBottom: rr ? Math.round(rr.bottom) : -1,
    visualH: Math.round(vvH),
  };
});
check('键盘弹出后背景高度不变（不再被顶小）', Math.abs(after.bgH - before.bgH) <= 2, `before=${before.bgH} after=${after.bgH}`);
check('背景仍铺满整个屏幕', after.bgH >= after.vh - 2, `bg=${after.bgH} vh=${after.vh}`);
check('顶栏仍在屏幕顶部', after.headerTop === 0, `top=${after.headerTop}`);
const gap = after.visualH - after.rowBottom;
check('按钮行与键盘有间距（≥12px）', gap >= 12, `gap=${gap}px`);

// ---- remembered selection -----------------------------------------------
// settingsStore JSON-encodes values, so the raw string is `"chat_old"`.
const stored = await page.evaluate(() => localStorage.getItem('rpnow:activeChatId'));
check('选中会话已持久化', (stored ?? '').includes('chat_old'), String(stored));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);
const restored = await page.evaluate(() => window.__rpnowStore.getState().activeChatId);
check('重新打开仍是上次选中的会话', restored === 'chat_old', String(restored));

// ---- group chat: greeting picker + speaker names -----------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1000);
await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 15000 });
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(900);
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="对话设置"] button[aria-label="组建群聊"]').first().click();
await page.waitForTimeout(800);

const rows = page.locator('[role="dialog"][aria-label="组建群聊"] button[aria-pressed]');
await rows.nth(0).click();
await rows.nth(1).click();
await rows.nth(2).click();
await page.waitForTimeout(500);

const openers = page.locator('[role="dialog"][aria-label="组建群聊"] button[aria-label^="用 "]');
const openerCount = await openers.count();
check('提供开场白选择（每个已选角色一项）', openerCount === 3, `count=${openerCount}`);

// Pick 白露's greeting (2nd pick) as the opener.
await openers.nth(1).click();
await page.waitForTimeout(300);
await page.locator('[role="dialog"][aria-label="组建群聊"] button', { hasText: '创建' }).first().click();
await page.waitForTimeout(1500);

const group = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId);
  return {
    members: chat?.groupCardIds?.length,
    greeting: chat?.messages?.[0]?.content,
    speaker: chat?.messages?.[0]?.speaker,
  };
});
check('开场白取自所选角色', group.greeting === '白露开口。', String(group.greeting));
check('开场白带了角色名', group.speaker === '白露', String(group.speaker));

const nameShown = await page.evaluate(() => document.body.innerText.includes('白露'));
check('气泡上方显示角色名', nameShown, '');

// A reply must also be attributed.
await page.locator('textarea[aria-label="消息输入框"]').fill('你好');
await page.locator('textarea[aria-label="消息输入框"]').press('Enter');
await page.waitForTimeout(2500);
const replied = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId);
  const last = chat?.messages?.at(-1);
  return { role: last?.role, speaker: last?.speaker };
});
check('群聊回复也标注了说话者', Boolean(replied.speaker), JSON.stringify(replied));

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
