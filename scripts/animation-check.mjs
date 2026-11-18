/** Animation smoke: every animated surface actually animates. */
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 140)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.length) {
    await s.addCard({
      id: 'an1', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name: '动画测', description: '测试。', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
    });
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1100);

// 页面入场
const pageAnim = await page.evaluate(() => {
  const m = document.querySelector('main.rp-anim-page');
  return m ? getComputedStyle(m).animationName : null;
});
check('页面切换有入场动画', pageAnim === 'rp-page-in', String(pageAnim));

// 卡片网格错落入场 + 按压类
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);
const grid = await page.evaluate(() => {
  const ul = document.querySelector('main ul.rp-anim-stagger');
  const card = document.querySelector('main article.rp-tap-card');
  return {
    stagger: ul ? getComputedStyle(ul.firstElementChild ?? ul).animationName : null,
    tapCard: card ? getComputedStyle(card).transitionProperty : null,
  };
});
check('卡片列表错落入场', grid.stagger === 'rp-fade-up', String(grid.stagger));
check('卡片有按压过渡', /transform/.test(grid.tapCard ?? ''), String(grid.tapCard));

// 详情 sheet 上滑
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => {
  const s = document.querySelector('[role="dialog"][aria-label^="角色详情"] div.rp-anim-sheet');
  return s ? getComputedStyle(s).animationName : null;
});
check('详情 sheet 上滑动画', sheet === 'rp-sheet-up', String(sheet));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 消息入场 + 发送按钮 pop
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(600);
const start = page.locator('[role="dialog"] button[aria-label^="和 "]').first();
if (await start.count()) await start.click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
await page.waitForTimeout(900);
const msg = await page.evaluate(() => {
  const m = document.querySelector('main [data-role].rp-msg-in');
  return m ? getComputedStyle(m).animationName : null;
});
check('消息入场动画', msg === 'rp-msg-in', String(msg));

await page.locator('textarea[aria-label="消息输入框"]').fill('测试');
await page.waitForTimeout(400);
const sendAnim = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="发送"]');
  return b ? { name: getComputedStyle(b).animationName, cls: b.className.includes('rp-send-ready') } : null;
});
check('发送按钮就绪时弹跳', sendAnim?.cls === true, JSON.stringify(sendAnim));

// 按压反馈类存在于设置目录
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).last().click();
await page.waitForTimeout(1000);
const hub = await page.evaluate(() => {
  const row = document.querySelector('main section button.rp-tap');
  return row ? getComputedStyle(row).transitionProperty : null;
});
check('设置目录行可按压', /transform/.test(hub ?? ''), String(hub));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
