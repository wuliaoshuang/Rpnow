/**
 * Round 23: settings hub regains the plugins entry, bubbles clamp card HTML
 * (no horizontal overflow), and multi-line typing keeps the last floor pinned
 * above the keyboard.
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
    id: 'ov', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '溢出测', description: '', personality: '', scenario: '', first_mes: '开场。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatov', title: '溢出测', cardId: 'ov', lorebookIds: [], useCardLorebook: true,
    messages: [
      { id: 'o1', role: 'user', content: '第一条。', createdAt: Date.now() },
      {
        id: 'o2', role: 'assistant', createdAt: Date.now() + 1,
        // Character-card HTML with a fixed 600px width — the classic overflow.
        content: '<div style="width:600px;font-size:14px">这一段故意用 600px 宽的卡片 HTML，里面还有一段非常长的连续英文字符串 supercalifragilisticexpialidociousandthenmoretextwithoutspaces 更加收工！</div>',
      },
    ],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('chatov');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

// ---- 1. no horizontal overflow in bubbles -------------------------------
const overflow = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('main .rp-md')];
  const worst = bubbles.map((b) => {
    const cs = getComputedStyle(b);
    const inner = [...b.querySelectorAll('*')].reduce((m, el) => Math.max(m, el.scrollWidth), b.scrollWidth);
    return {
      own: b.scrollWidth - b.clientWidth,
      childMax: inner - b.clientWidth,
      ox: cs.overflowX,
      parentW: Math.round(b.getBoundingClientRect().width),
      parentRight: Math.round(b.getBoundingClientRect().right),
      vw: window.innerWidth,
    };
  });
  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return { worst, docOverflow };
});
check(
  '卡片 HTML 不撑破气泡（每气泡 0 横向溢出）',
  overflow.worst.every((w) => w.own <= 2 && w.parentRight <= w.vw + 1),
  JSON.stringify(overflow.worst.map((w) => ({ own: w.own, right: w.parentRight }))),
);
check('页面无横向滚动', overflow.docOverflow <= 1, `doc=${overflow.docOverflow}px`);

// ---- 2. multi-line typing keeps the last floor pinned -------------------
await page.locator('textarea[aria-label="消息输入框"]').click();
await page.evaluate(() => {
  const real = window.visualViewport.height;
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => real - 340 });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(600);
await page.locator('textarea[aria-label="消息输入框"]').fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行');
await page.waitForTimeout(700);

const pinned = await page.evaluate(() => {
  const shell = document.querySelector('header')?.parentElement.getBoundingClientRect();
  const regen = [...document.querySelectorAll('button[aria-label="重新生成这条回复"]')].at(-1);
  if (!regen) return { found: false };
  const r = regen.getBoundingClientRect();
  return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), shellBottom: Math.round(shell.bottom), visible: r.top >= -2 && r.bottom <= shell.bottom + 2 };
});
check('多行输入后最后楼层的按钮仍可见', pinned.found && pinned.visible, JSON.stringify(pinned));

// ---- 3. plugins entry back in the settings hub --------------------------
await page.evaluate(() => {
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(400);
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).last().click();
await page.waitForTimeout(1100);
const hubRow = page.locator('main section button', { hasText: '插件管理' });
check('设置目录里有插件管理行', (await hubRow.count()) > 0, '');
await hubRow.first().click();
await page.waitForTimeout(1200);
const plugins = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  title: document.querySelector('header h1')?.textContent,
  install: document.body.innerText.includes('安装 .rpnx'),
}));
check('插件管理直达插件页', plugins.route === 'plugins' && plugins.title === '插件' && plugins.install, JSON.stringify(plugins));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
