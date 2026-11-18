/**
 * Tavo-style redesign checks: chat list home, immersive chat chrome,
 * drawer with current values, and per-script regex toggles inside the drawer.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8824;
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
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '抽屉检查。' } }] })}\n\n`);
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

// 聊天即主页：启动直接是 chat 视图；聊天列表在全局抽屉里。
const home = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  title: document.body.innerText.slice(0, 40),
}));
check('首页是聊天视图', home.route === 'chat', JSON.stringify(home));

await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  await s.addCard({
    id: 'card_drawer',
    avatar:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: {
      name: '抽屉角色',
      description: '测试抽屉。',
      personality: '',
      scenario: '',
      first_mes: '你好。',
      mes_example: '',
      extensions: {
        regex_scripts: [
          { id: 'rx1', scriptName: '脚本甲', findRegex: '/抽屉/', replaceString: '★', placement: [2], disabled: false, markdownOnly: true, promptOnly: false },
          { id: 'rx2', scriptName: '脚本乙', findRegex: '/你好/', replaceString: '嗨', placement: [2], disabled: true, markdownOnly: true, promptOnly: false },
        ],
      },
    },
  });
  await s.saveLLMConnection({
    id: 'conn_drawer', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_drawer' });
  window.__store = store.useApp;
}, PORT);

// A chat has to exist for the list row to show; create one from the card.
await import('./e2e-helpers.mjs').then((h) => h.drawerNavigate(page, '角色卡'));
await page.waitForTimeout(800);
await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(900);

// The chat list lives in the drawer's 聊天 pane now.
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(600);

const list = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  rows: document.querySelectorAll('[role="dialog"] button[aria-label^="打开与"]').length,
  snippet: (document.querySelector('[role="dialog"][aria-label="导航抽屉"]')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 60),
}));
check('抽屉聊天列表显示会话', list.rows >= 1, JSON.stringify(list));

// Open the chat from the list.
await page.locator('[role="dialog"] button[aria-label^="打开与"]').first().click();
await page.waitForTimeout(1000);

const chat = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  immersive: Boolean(document.querySelector('main img[aria-hidden="true"]')),
  hasMenuBtn: Boolean(document.querySelector('button[aria-label="打开聊天列表"]')),
  hasSend: Boolean(document.querySelector('button[aria-label="发送"]')),
  bottomNav: Boolean(document.querySelector('nav[aria-label="底部导航"]')),
}));
check('沉浸式聊天：全屏角色背景', chat.immersive, JSON.stringify(chat));
check('沉浸式聊天：隐藏全局底栏', !chat.bottomNav, '');
check('沉浸式聊天：抽屉按钮 + 圆形发送键', chat.hasMenuBtn && chat.hasSend, '');

// Geometry: the art must actually cover the viewport, and the send key must be
// a circle — class names alone don't prove the layout.
const geometry = await page.evaluate(() => {
  const art = document.querySelector('main img[aria-hidden="true"]');
  const send = document.querySelector('button[aria-label="发送"]');
  const bubble = document.querySelector('div[data-role="assistant"] > div');
  const ar = art?.getBoundingClientRect();
  const sr = send?.getBoundingClientRect();
  const bs = bubble ? getComputedStyle(bubble) : null;
  return {
    artCovers: ar ? ar.width >= window.innerWidth - 1 && ar.height >= window.innerHeight - 1 : false,
    sendSquare: sr ? Math.abs(sr.width - sr.height) < 2 && sr.width >= 36 : false,
    bubbleAlpha: bs ? /rgba\(/.test(bs.backgroundColor) || bs.backdropFilter.includes('blur') : false,
  };
});
check('角色背景铺满视口', geometry.artCovers, JSON.stringify(geometry));
check('发送键为圆形且够大（≥36px 触达）', geometry.sendSquare, '');
check('消息气泡为半透明（沉浸感）', geometry.bubbleAlpha, '');

// The transcript shows no avatars and no speaker names — the width goes to prose.
const transcript = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('div[data-role]')];
  return {
    withAvatar: rows.filter((r) => r.querySelector('img')).length,
    withName: rows.filter((r) => /^(你|User)$/.test((r.querySelector('.text-\\[10\\.5px\\]')?.textContent || '').trim())).length,
    metaTexts: rows.slice(0, 4).map((r) => (r.firstChild?.textContent || '').trim().slice(0, 24)),
  };
});
check('消息不再显示头像', transcript.withAvatar === 0, JSON.stringify(transcript));
check('消息不再显示用户名字', transcript.withName === 0, JSON.stringify(transcript.metaTexts));

// ＋ opens the bottom action sheet; the send-side upload button is gone.
const plus = page.locator('button[aria-label="打开操作面板"]');
check('composer 有加号按钮', (await plus.count()) === 1, `count=${await plus.count()}`);
check('发送侧不再有图片上传按钮', (await page.locator('button[aria-label="从相册添加图片"], button[aria-label="添加图片附件"]').count()) === 0, '');
// The ＋ plate collapses while the composer is focused (focus morph) — blur first.
await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
await page.waitForTimeout(500);
// The ＋ plate collapses on focus; use a native click so Playwright's\n// actionability probe can't race with the morph transition.
await page.evaluate(() => document.querySelector('button[aria-label="打开操作面板"]').click());
await page.waitForTimeout(1200);
const sheet = await page.locator('[role="dialog"][aria-label="操作面板"]').isVisible().catch(() => false);
check('点击加号弹出操作面板', sheet, '');
const sheetItems = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"][aria-label="操作面板"] button')].map((b) => b.textContent?.trim()).filter(Boolean),
);
check('面板含添加图片/出图/提示词', sheetItems.some((t) => t.includes('添加图片')) && sheetItems.some((t) => t.includes('生成场景图')), JSON.stringify(sheetItems));
await page.locator('[role="dialog"][aria-label="操作面板"] button[aria-label="关闭"]').first().click();
await page.waitForTimeout(500);
check('操作面板可关闭', !(await page.locator('[role="dialog"][aria-label="操作面板"]').isVisible().catch(() => false)), '');

// Right panel shows the per-chat settings with current values.
await page.locator('button[aria-label="打开对话设置"]').first().click();
await page.waitForTimeout(700);
const drawer = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="对话设置"]');
  if (!dlg) return { open: false };
  const rows = [...dlg.querySelectorAll('button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim());
  return { open: true, rows: rows.filter(Boolean).slice(0, 16) };
});
check('右栏打开并列出当前值', drawer.open && drawer.rows.some((r) => r.includes('正则')), JSON.stringify(drawer.rows));
check('正则行显示启用数', drawer.rows.some((r) => /正则\s+1\/2/.test(r)), JSON.stringify(drawer.rows));

// The regex switches live inside that row.
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '正则' }).first().click();
await page.waitForTimeout(600);
const toggles = await page.locator('[role="dialog"][aria-label="对话设置"] button[role="switch"]').count();
check('右栏内可逐条开关正则', toggles >= 2, 'toggles=' + toggles);

const before = await page.evaluate(() => {
  const card = window.__store.getState().cards.find((c) => c.id === 'card_drawer');
  return (card.data.extensions.regex_scripts ?? []).map((s) => [s.id, s.disabled]);
});
await page.locator('[role="dialog"][aria-label="对话设置"] button[role="switch"]').first().click();
await page.waitForTimeout(700);
const after = await page.evaluate(() => {
  const card = window.__store.getState().cards.find((c) => c.id === 'card_drawer');
  return (card.data.extensions.regex_scripts ?? []).map((s) => [s.id, s.disabled]);
});
check('开关立即写入卡片', JSON.stringify(before) !== JSON.stringify(after), JSON.stringify(before) + ' -> ' + JSON.stringify(after));

// Esc closes the right panel.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
// 面板现在常驻预挂载；「已关闭」= aria-hidden 为 true。`ncheck('Esc 关闭右栏', (await page.getAttribute('[role="dialog"][aria-label="对话设置"]', 'aria-hidden')) === 'true', '' );

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
