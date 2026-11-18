/**
 * Jump-button threshold + keyboard viewport clamping.
 *
 * 1. 回到顶部/回到底部 only appears after a deliberate scroll past a dead zone.
 * 2. When the soft keyboard opens, the chat header must stay on screen — the
 *    transcript shrinks, the chrome does not slide out.
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
await page.waitForTimeout(800);

// Seed a long transcript so the scroll container actually scrolls.
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'cl', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '滚动测试', description: '', personality: '', scenario: '', first_mes: '第一句。', mes_example: '' },
  });
  const messages = [];
  for (let i = 0; i < 40; i++) {
    messages.push({
      id: `m${i}`,
      role: i % 2 === 0 ? 'assistant' : 'user',
      content: `第 ${i + 1} 段消息。`.repeat(6),
      createdAt: Date.now() + i,
    });
  }
  await s.saveChat({
    id: 'chatl', title: '滚动测试', cardId: 'cl', lorebookIds: [], useCardLorebook: true,
    messages, variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const scrollEl = () => page.evaluate(() => {
  // The transcript is the only large overflow-y-auto inside main.
  const all = [...document.querySelectorAll('main div')];
  const el = all.find((d) => {
    const cs = getComputedStyle(d);
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 50;
  });
  return el ? { top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight } : null;
});

const jump = () =>
  page.evaluate(() => {
    const b = document.querySelector('button[aria-label="回到顶部"], button[aria-label="回到底部"]');
    return b ? b.getAttribute('aria-label') : null;
  });

const lastTop = { v: 0 };
/** Scroll with real direction: steps from the previous position to `top`. */
const setScroll = async (top) => {
  const from = lastTop.v;
  const r = await page.evaluate(([t, f]) => {
    const all = [...document.querySelectorAll('main div')];
    const el = all.find((d) => {
      const cs = getComputedStyle(d);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 50;
    });
    if (!el) return null;
    // Drive the scroll in steps so the direction heuristic sees movement.
    const steps = 6;
    const stepSize = (t - f) / steps;
    for (let i = 1; i <= steps; i++) {
      el.scrollTop = f + stepSize * i;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    el.scrollTop = t;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    return el.scrollTop;
  }, [top, from]);
  lastTop.v = r ?? top;
  return r;
};

const info = await scrollEl();
check('聊天区可滚动', Boolean(info) && info.sh > info.ch, info ? `sh=${info.sh} ch=${info.ch}` : 'not scrollable');

// ---- dead zone at the top: no button ------------------------------------
await setScroll(0);
await page.waitForTimeout(250);
check('停在顶部时不显示按钮', (await jump()) === null, String(await jump()));

await setScroll(80);
await page.waitForTimeout(250);
check('向下滚 80px 显示「回到底部」（方向逻辑）', (await jump()) === '回到底部', String(await jump()));

await setScroll(200);
await page.waitForTimeout(250);
check('向下滚 200px 仍显示「回到底部」', (await jump()) === '回到底部', String(await jump()));

// ---- past the threshold: 回到顶部 ---------------------------------------
await setScroll(400);
await page.waitForTimeout(250);
const mid = await jump();
check('继续向下滚仍显示「回到底部」（向下=去最新）', mid === '回到底部', String(mid));

// ---- near the bottom with a small upward scroll -------------------------
const max = info ? info.sh - info.ch : 0;
// Walk up in two hops so each hop is a genuine upward scroll.
await setScroll(max - 400);
await page.waitForTimeout(200);
await setScroll(max - 700);
await page.waitForTimeout(250);
check('向上翻看旧内容显示「回到顶部」', (await jump()) === '回到顶部', String(await jump()));

await setScroll(max - 1500);
await page.waitForTimeout(250);
const up = await jump();
check('继续向上翻仍显示「回到顶部」', up === '回到顶部', String(up));

// Clicking it returns to the bottom and hides the button.
if (up === '回到底部') {
  await page.locator('button[aria-label="回到底部"]').click();
  await page.waitForTimeout(900);
  const after = await scrollEl();
  const btn = await jump();
  check('点「回到底部」滚到末尾', after && Math.abs(after.sh - after.ch - after.top) < 20, after ? `gap=${Math.round(after.sh - after.ch - after.top)}` : '');
  check('回到底部后按钮消失', btn === null || btn === '回到顶部', String(btn));
}

// ---- keyboard: header stays visible -------------------------------------
const headerBefore = await page.evaluate(() => {
  const h = document.querySelector('header');
  const r = h.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= -1 };
});
check('键盘未弹出时顶栏在视口内', headerBefore.inView && headerBefore.top <= 2, JSON.stringify(headerBefore));

// Simulate the soft keyboard shrinking the visual viewport by 340px.
await page.evaluate(() => {
  const real = window.visualViewport.height;
  Object.defineProperty(window.visualViewport, 'height', {
    configurable: true,
    get: () => real - 340,
  });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(700);

const afterKb = await page.evaluate(() => {
  const h = document.querySelector('header');
  const r = h.getBoundingClientRect();
  const shell = h.parentElement;
  const sr = shell.getBoundingClientRect();
  return {
    headerTop: Math.round(r.top),
    headerBottom: Math.round(r.bottom),
    headerInView: r.top >= -1 && r.bottom > 0,
    shellHeight: Math.round(sr.height),
    viewportH: window.innerHeight,
    visualH: window.visualViewport.height,
  };
});
check('键盘弹出后顶栏仍在视口内', afterKb.headerInView, JSON.stringify(afterKb));
check('顶栏没有被顶出屏幕（top >= 0）', afterKb.headerTop >= 0, `top=${afterKb.headerTop}`);
check(
  '聊天容器高度收缩到可视区之内',
  afterKb.shellHeight <= afterKb.visualH + 4,
  `shell=${afterKb.shellHeight} visual=${Math.round(afterKb.visualH)}`,
);

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
