/**
 * Hardware-back navigation and haptics.
 *
 * - Android WebView routes the back key through page history while the page has
 *   entries, so `page.goBack()` exercises the same code path as the real key.
 * - `navigator.vibrate` is stubbed to record calls (desktop Chrome has no motor).
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8825;
let streamed = false;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      streamed = true;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '回来了。' } }] })}\n\n`);
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

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);

// Record vibration calls (again, after the reload).
await page.evaluate(() => {
  window.__buzz = [];
  navigator.vibrate = (p) => {
    window.__buzz.push(p);
    return true;
  };
});

const route = () => page.evaluate(() => document.querySelector('[data-route]')?.getAttribute('data-route'));

await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  await s.addCard({
    id: 'card_back',
    avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '返回角色', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveLLMConnection({
    id: 'conn_back', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_back' });
}, PORT);

// Reload so the UI reads the freshly written card from storage.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.evaluate(() => {
  window.__buzz = [];
  navigator.vibrate = (p) => {
    window.__buzz.push(p);
    return true;
  };
});
await page.waitForTimeout(900);

// chats → chat
await import('./e2e-helpers.mjs').then((h) => h.drawerNavigate(page, '角色卡'));
await page.waitForTimeout(900);
const diag = await page.evaluate(async () => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  return {
    cards: s.cards.length,
    ids: s.cards.map((c) => c.id),
    route: document.querySelector('[data-route]')?.getAttribute('data-route'),
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80),
  };
});
console.log('diag:', JSON.stringify(diag));
await page.waitForSelector('article button[aria-label^="查看 "]', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(900);
check('已进入聊天', (await route()) === 'chat', await route());

// Back walks the real navigation stack: home(chat) → cards → chat, so the first
// back lands on 角色卡 (where we came from).
await page.goBack();
await page.waitForTimeout(700);
check('返回键回到上一级（角色卡）', (await route()) === 'cards', await route());
await page.goBack();
await page.waitForTimeout(700);
check('再按一次回到主页（聊天）', (await route()) === 'chat', await route());

// Re-enter a chat: the left panel is the chat list now, so open the panel and
// pick the existing conversation row.
await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button[aria-label^="打开与"]').first().click({ timeout: 8000 });
await page.waitForTimeout(1000);
await page.waitForTimeout(900);
check('再次进入聊天', (await route()) === 'chat', await route());
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(600);
check('抽屉已打开', await page.locator('[role="dialog"][aria-label="聊天列表"]').isVisible().catch(() => false));
await page.goBack();
await page.waitForTimeout(700);
const afterOverlayBack = {
  route: await route(),
  drawer: await page.locator('[role="dialog"][aria-label="聊天列表"]').isVisible().catch(() => false),
};
// The panel must close; the route is allowed to stay put (closing a panel is
// its own "level" and the history step is rewound).
check('返回键优先关闭弹层', !afterOverlayBack.drawer, JSON.stringify(afterOverlayBack));

// Back again leaves the current page (whichever level is below it).
await page.goBack();
await page.waitForTimeout(700);
const afterSecondBack = await route();
check('弹层关闭后再返回才离开页面', afterSecondBack !== 'chat', afterSecondBack);

// ---- haptics ---------------------------------------------------------------
// Reload first: the back-navigation section above deliberately walks browser
// history, which leaves the document in an arbitrary state.
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);
// The back-navigation steps above can reload the document, which drops the
// stub; reinstall it against the live navigator before measuring.
await page.evaluate(() => {
  window.__buzz = window.__buzz ?? [];
  navigator.vibrate = (p) => {
    window.__buzz.push(p);
    return true;
  };
});
const buzzBefore = await page.evaluate(() => window.__buzz.length);

// Navigation tap buzzes: use whatever page-level drawer handle exists (the
// non-chat pages expose one in the AppShell header).
const handle = page.locator('button[aria-label="打开聊天列表"], button[aria-label="打开对话设置"], button[aria-label="打开导航抽屉"]');
const handleCount = await handle.count();
check('页面存在侧栏入口', handleCount > 0, `count=${handleCount} route=${await route()}`);
if (handleCount) {
  await handle.first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
}
const navBuzz = await page.evaluate(() => window.__buzz.length);
check('导航点击触发振动', navBuzz > buzzBefore, JSON.stringify(await page.evaluate(() => window.__buzz)));

// A toggle buzzes. Navigate to 角色卡 through the left panel (which may already
// be open from the step above).
const panelOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="聊天列表"]')));
if (!panelOpen) {
  await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
}
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click({ timeout: 8000 });
await page.waitForTimeout(1200);
const onCards = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  articles: document.querySelectorAll('article').length,
}));
check('已进入角色卡页', onCards.route === 'cards' && onCards.articles > 0, JSON.stringify(onCards));
const beforeToggle = await page.evaluate(() => window.__buzz.length);
// 简介 now lives in the card's ⋮ menu.
// ⋮ opens a menu (no haptic on trigger itself by design — it's a menu toggle).
await page.locator('article button[aria-label$="操作菜单"]').first().click({ timeout: 15000 });
await page.waitForTimeout(500);
// 开始对话 navigates away; the navigation tap fires the haptic.
await page.locator('[role="menuitem"]', { hasText: '开始对话' }).first().click();
await page.waitForTimeout(1200);
await page.waitForTimeout(400);
const afterToggle = await page.evaluate(() => window.__buzz.length);
check('操作按钮触发振动（菜单导航）', afterToggle > beforeToggle, `${beforeToggle} → ${afterToggle}`);

// AI reply arrival buzzes once.
const beforeReply = await page.evaluate(() => window.__buzz.length);
const box = page.locator('textarea[aria-label="消息输入框"]');
check('已进入聊天（有输入框）', (await box.count()) > 0, '');
await box.fill('你好');
await box.press('Enter');
await page.waitForTimeout(2500);
const replyBuzz = await page.evaluate(() => window.__buzz.length);
check('AI 回复到达触发振动', replyBuzz > beforeReply, `${beforeReply} → ${replyBuzz}`);

// Turning the switch off silences everything. Do it through the real UI so the
// toggle acts on the same store instance the app uses.
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__buzz = window.__buzz ?? [];
  navigator.vibrate = (p) => {
    window.__buzz.push(p);
    return true;
  };
});
// The right panel holds the per-chat settings; haptics live in 设置 → 主题.
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '主题' }).first().click({ timeout: 8000 });
await page.waitForTimeout(1100);
// Deep link lands in the appearance sub-page (no tab strip — hub rows only).
const switchEl = page.locator('#haptics-enabled').first();
if (await switchEl.count()) {
  await switchEl.click();
  await page.waitForTimeout(500);
  const enabledNow = await page.evaluate(() => document.querySelector('#haptics-enabled')?.getAttribute('aria-checked'));
  check('「按键振动」开关可关闭', enabledNow === 'false', String(enabledNow));

  // Any further tap must be silent: hop to another section via the hub row.
  const beforeOff = await page.evaluate(() => window.__buzz.length);
  await page.locator('header button[aria-label="返回上一级"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('main section button', { hasText: '模型连接' }).first().click();
  await page.waitForTimeout(500);
  const offBuzz = await page.evaluate(() => window.__buzz.length);
  check('关闭「按键振动」后不再振动', offBuzz === beforeOff, `${beforeOff} → ${offBuzz}`);
} else {
  check('「按键振动」开关可关闭', false, 'switch not found');
  check('关闭「按键振动」后不再振动', false, 'switch not found');
}

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
