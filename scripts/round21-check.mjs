/**
 * Round 21: composer bottom margin, settings sub-page WITHOUT nested tabs,
 * tighter hub padding, page canvas matching drawer bg + bigger corner radius.
 */
import { chromium } from 'playwright';

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
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'r21', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '修测', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatr21', title: '修测', cardId: 'r21', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 1. composer bottom margin ------------------------------------------
const margin = await page.evaluate(() => {
  const pill = document.querySelector('textarea[aria-label="消息输入框"]')?.closest('div.rounded-2xl');
  if (!pill) return null;
  const pr = pill.getBoundingClientRect();
  return { gap: Math.round(window.innerHeight - pr.bottom) };
});
check('输入胶囊距底边 ≥ 20px', margin && margin.gap >= 20, JSON.stringify(margin));

// ---- 2. settings sub-page: no nested tabs strip -------------------------
await page.evaluate(() => window.__rpnowStore.getState().setActiveChat('chatr21'));
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '主题' }).first().click();
await page.waitForTimeout(1000);
const sub = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  h1: document.querySelector('header h1')?.textContent,
  tabs: document.querySelectorAll('[role="tab"]').length,
  themesGrid: document.body.innerText.includes('午夜玫瑰'),
  hubRows: document.querySelectorAll('main section button').length,
}));
check('子页只渲染该区块（无标签条）', sub.tabs === 0, `tabs=${sub.tabs}`);
check('子页标题为主题', sub.h1 === '主题', String(sub.h1));
check('子页内容为主题选择', sub.themesGrid, '');
// 8 = the eight theme cards; hub rows would say 模型连接/生图 API/…
const hubLeak = await page.evaluate(() =>
  [...document.querySelectorAll('main section button')].some((b) => /模型连接|生图 API|用户身份|数据管理/.test(b.textContent || '')),
);
check('子页没有嵌目录行', !hubLeak, '');

// Back to hub via the in-page chevron.
await page.locator('header button[aria-label="返回上一级"]').click();
await page.waitForTimeout(800);
const hub = await page.evaluate(() => ({
  rows: document.querySelectorAll('main section button').length,
  firstGroup: document.querySelector('main section h2')?.textContent,
}));
check('返回后是目录页', hub.rows >= 10 && hub.firstGroup === '聊天', JSON.stringify(hub));

// ---- 3. hub horizontal padding ≤ 20px -----------------------------------
const pad = await page.evaluate(() => {
  const row = document.querySelector('main section button');
  if (!row) return null;
  const rr = row.getBoundingClientRect();
  return { left: Math.round(rr.left), right: Math.round(window.innerWidth - rr.right) };
});
check('目录卡片距屏幕边 ≤ 20px', pad && pad.left <= 20 && pad.right <= 20, JSON.stringify(pad));

// ---- 4. page canvas = drawer bg + bigger radius --------------------------
// We are on the settings hub (no ☰) — climb back to the chat page first.
const backHome = page.locator('header button[aria-label="返回上一级"]');
if (await backHome.count()) {
  await backHome.first().click();
  await page.waitForTimeout(800);
}
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(800);
const canvas = await page.evaluate(() => {
  const pushed = [...document.querySelectorAll('div[style*="translate3d"]')].find((d) => d.querySelector('[data-route]'));
  if (!pushed) return null;
  const cs = getComputedStyle(pushed);
  const drawer = document.querySelector('aside');
  return {
    bg: cs.backgroundColor,
    drawerBg: drawer ? getComputedStyle(drawer).backgroundColor : null,
    radius: cs.borderRadius,
  };
});
check('页面画布色 = 侧栏背景色', canvas && canvas.bg === canvas.drawerBg, JSON.stringify(canvas));
check('圆角 ≥ 28px', canvas && parseFloat(canvas.radius) >= 28, canvas?.radius);

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
