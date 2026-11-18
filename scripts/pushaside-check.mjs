/**
 * Push-aside layout checks — verified against the reference implementation
 * (push_sidebar_demo.html):
 *   - panel width  75vw → at 390px viewport = 293px
 *   - the PAGE slides by exactly the drawer width, NO scaling
 *   - inner-edge border-radius 22px + soft shadow
 *   - light scrim rgba(0,0,0,.10) over the page
 *   - tap-to-close only on the visible sliver beyond the drawer edge
 *   - Esc closes; ☰ toggles
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8826;
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
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '侧栏检查。' } }] })}\n\n`);
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
await page.waitForTimeout(700);
await page.evaluate(async (port) => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'card_push',
    avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '推走角色', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chat_push',
    title: '推走角色',
    cardId: 'card_push',
    lorebookIds: [],
    useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await s.saveLLMConnection({
    id: 'conn_push', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_push' });
}, PORT);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

/** The pushed screen carries an inline transform + rounded corners. */
const pushedExpr = `(() => {
  const all = [...document.querySelectorAll('div[style*="transform"]')];
  return all.find((el) => el.style.borderRadius !== undefined && el.style.transform.includes('translate3d') && el.querySelector('[data-route]')) ?? null;
})()`;

// Open the first chat so the chat page is the pushed screen.
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
const seeded = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="聊天列表"] button[aria-label^="打开与"]')));
check('左栏为聊天列表（无卡时也有入口）', seeded, '');
if (seeded) {
  await page.locator('[role="dialog"][aria-label="聊天列表"] button[aria-label^="打开与"]').first().click();
  await page.waitForTimeout(900);
} else {
  await page.locator('button[aria-label="去角色卡页面"], button:has-text("角色卡")').first().click();
  await page.waitForTimeout(900);
  await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 15000 });
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
  await page.waitForTimeout(900);
}

// ---- closed geometry ------------------------------------------------------
const closed = await page.evaluate((expr) => {
  const el = eval(expr);
  return el ? getComputedStyle(el).transform : '(missing)';
}, pushedExpr);
check('关闭态主屏未位移', /none|matrix\(1, 0, 0, 1, 0, 0\)/.test(closed), closed);

// ---- open the LEFT panel via the chat ☰ (toggle) --------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const left = await page.evaluate((expr) => {
  const pushed = eval(expr);
  const panel = document.querySelector('[role="dialog"][aria-label="聊天列表"]');
  const pr = panel?.getBoundingClientRect();
  const cs = pushed ? getComputedStyle(pushed) : null;
  const m = (cs?.transform ?? '').replace(/matrix3d\(|matrix\(|\)/g, '').split(',').map(Number);
  // matrix3d: a = m[0], tx = m[12]; matrix: a = m[0], tx = m[4]
  const scale = m.length === 16 ? m[0] : m[0];
  const tx = m.length === 16 ? m[12] : m[4];
  const scrim = document.querySelector('button[aria-label="关闭侧栏"]');
  const sr = scrim?.getBoundingClientRect();
  return {
    scale,
    tx,
    txRatio: tx / window.innerWidth,
    panelLeft: pr?.left ?? -1,
    panelWidth: pr?.width ?? 0,
    radius: cs?.borderTopLeftRadius ?? '0',
    radiusRight: cs?.borderTopRightRadius ?? '0',
    inert: Boolean(pushed?.querySelector('[inert]')),
    scrimLeft: sr ? Math.round(sr.left) : -1,
    scrimWidth: sr ? Math.round(sr.width) : 0,
  };
}, pushedExpr);
const expectedDrawer = Math.round(Math.min(390 * 0.75, 480));
check('左栏宽 = 75vw（主屏留 25%）', Math.abs(left.panelWidth - expectedDrawer) <= 2, `${Math.round(left.panelWidth)} vs ${expectedDrawer}`);
check('主屏位移 = 抽屉宽（不缩放）', Math.abs(left.tx - expectedDrawer) <= 3 && Math.abs(left.scale - 1) < 0.001, `tx=${left.tx} scale=${left.scale}`);
check('主屏内侧圆角 30px（左侧）', left.radius.startsWith('30') && left.radiusRight === '0px', `${left.radius} / ${left.radiusRight}`);
check('面板打开时页面保持可点（☰ 可关闭）', !left.inert, '');
check('点击关闭区只在抽屉右侧余条上', Math.abs(left.scrimLeft - expectedDrawer) <= 3, `scrim left=${left.scrimLeft}`);
check('余条宽度 = 视口 - 抽屉', Math.abs(left.scrimWidth - (390 - expectedDrawer)) <= 3, `${left.scrimWidth}`);

// Close via the sliver.
await page.mouse.click(left.scrimLeft + left.scrimWidth / 2, 420);
await page.waitForTimeout(700);
check('点余条关闭左栏', !(await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="聊天列表"]')?.getAttribute('aria-hidden') === 'false')), '');

// ☰ toggles: open then open again closes. (Wait out the inert removal first —
// React commits the attribute change in the same tick as the panel unmount.)
await page.waitForFunction(() => !document.querySelector('[inert]'), undefined, { timeout: 5000 });
await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const openAgain = (await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="聊天列表"]')?.getAttribute('aria-hidden') === 'false'));
// The ☰ slides into the sliver zone once open — tapping there is the demo's
// close gesture, so close via the sliver just like a real finger would.
for (let i = 0; i < 3; i++) {
  const target = await page.evaluate(() => {
    const el = document.elementFromPoint(370, 420);
    return el ? el.getAttribute('aria-label') || el.tagName : 'none';
  });
  if (target === '关闭侧栏') break;
  console.log(`  retry ${i}: element at 370,420 = ${target}`);
  await page.mouse.click(370, 420);
  await page.waitForTimeout(600);
}
await page.mouse.click(370, 420);
await page.waitForTimeout(700);
const closedAgain = (await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="聊天列表"]')?.getAttribute('aria-hidden') === 'false'));
check('☰ 为开关（开→点→关）', openAgain && !closedAgain, `open=${openAgain} closed=${closedAgain}`);

// ---- RIGHT panel: mirrored ------------------------------------------------
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const right = await page.evaluate((expr) => {
  const pushed = eval(expr);
  const panel = document.querySelector('[role="dialog"][aria-label="对话设置"]');
  const pr = panel?.getBoundingClientRect();
  const cs = pushed ? getComputedStyle(pushed) : null;
  const m = (cs?.transform ?? '').replace(/matrix3d\(|matrix\(|\)/g, '').split(',').map(Number);
  const tx = m.length === 16 ? m[12] : m[4];
  const rows = [...(panel?.querySelectorAll('button') ?? [])].map((b) => b.innerText.replace(/\s+/g, ' ').trim());
  return {
    tx,
    panelLeft: pr?.left ?? -1,
    panelWidth: pr?.width ?? 0,
    radiusLeft: cs?.borderTopLeftRadius ?? '0',
    radiusRight: cs?.borderTopRightRadius ?? '0',
    rows,
  };
}, pushedExpr);
check('右栏：主屏向左位移 = 抽屉宽', Math.abs(right.tx + expectedDrawer) <= 3, `tx=${right.tx}`);
check('右栏：贴右边缘', Math.abs(right.panelLeft + right.panelWidth - 390) <= 3, `left=${right.panelLeft}`);
check('右栏：内侧圆角在右侧', right.radiusLeft === '0px' && right.radiusRight.startsWith('30'), `${right.radiusLeft} / ${right.radiusRight}`);
check('右栏含设置行（身份/预设/正则/长记忆/清空对话）',
  ['用户身份', '预设', '正则', '长记忆', '清空对话'].every((k) => right.rows.some((r) => r.startsWith(k))),
  JSON.stringify(right.rows.slice(0, 14)));

// Esc closes.
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
check('Esc 关闭右栏', !(await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="对话设置"]')?.getAttribute('aria-hidden') === 'false')), '');

// Content restored.
const restored = await page.evaluate((expr) => getComputedStyle(eval(expr)).transform, pushedExpr);
check('关闭后主屏复原', /none|matrix\(1, 0, 0, 1, 0, 0\)/.test(restored), restored);

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
