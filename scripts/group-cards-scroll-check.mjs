/**
 * Round 18: group identity (& title + diagonal avatar), card library views,
 * jump-button direction logic on short vs tall transcripts, and windowing.
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
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  const av = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  for (const [id, name] of [['g1', '阿离'], ['g2', '白露'], ['g3', '长风']]) {
    await s.addCard({
      id, avatar: av, spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: {
        name, description: `${name}的简介。`, personality: '', scenario: '',
        first_mes: `${name}开口。`, mes_example: '',
        tags: ['原创', '日常'], creator: 'Tester', character_version: '1.0',
      },
    });
  }
  // Short chat.
  await s.saveChat({
    id: 'short', title: '短会话', cardId: 'g1', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 's1', role: 'assistant', content: '短。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  // Tall chat: 200 floors.
  const many = [];
  for (let i = 0; i < 200; i++) {
    many.push({
      id: `t${i}`, role: i % 2 === 0 ? 'assistant' : 'user',
      content: `第 ${i + 1} 条。`.repeat(8), createdAt: Date.now() + i,
    });
  }
  await s.saveChat({
    id: 'tall', title: '长会话', cardId: 'g2', lorebookIds: [], useCardLorebook: true,
    messages: many, variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('short');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 1. short transcript: no jump button ------------------------------
const jump = () => page.evaluate(() => {
  const b = document.querySelector('button[aria-label="回到顶部"], button[aria-label="回到底部"]');
  return b ? b.getAttribute('aria-label') : null;
});
check('短会话不显示跳转按钮', (await jump()) === null, String(await jump()));

// ---- 2. tall transcript: windowing ------------------------------------
await page.evaluate(() => window.__rpnowStore.getState().setActiveChat('tall'));
await page.waitForTimeout(1200);
const w = await page.evaluate(() => ({
  total: window.__rpnowStore.getState().chats.find((c) => c.id === 'tall').messages.length,
  bubbles: document.querySelectorAll('div[data-role]').length,
}));
check('长会话只渲染窗口内的楼层', w.bubbles < w.total && w.bubbles > 0, `rendered=${w.bubbles} total=${w.total}`);
check('窗口上限为 60 条', w.bubbles <= 62, `rendered=${w.bubbles}`);
const loadMore = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /加载更早/.test(x.textContent || ''));
  return b ? b.textContent.trim() : null;
});
check('提供「加载更早」入口', Boolean(loadMore), String(loadMore));

// ---- 3. jump button follows scroll direction --------------------------
const scrollBy = (dy) =>
  page.evaluate((d) => {
    const el = [...document.querySelectorAll('main div')].find((x) => {
      const cs = getComputedStyle(x);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && x.scrollHeight > x.clientHeight + 50;
    });
    if (!el) return null;
    el.scrollTop += d;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    return el.scrollTop;
  }, dy);

// Start at bottom, scroll UP → 回到顶部
await scrollBy(-1500);
await page.waitForTimeout(300);
const up = await jump();
check('向上翻看时显示「回到顶部」', up === '回到顶部', String(up));

// Scroll DOWN → 回到底部
await scrollBy(400);
await page.waitForTimeout(300);
const down = await jump();
check('向下翻看时显示「回到底部」', down === '回到底部', String(down));

// ---- 4. card library: grid + list views -------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1000);

const gridCols = await page.evaluate(() => {
  const ul = document.querySelector('main ul.grid');
  return ul ? getComputedStyle(ul).gridTemplateColumns.split(' ').length : -1;
});
check('网格视图为多列', gridCols === 2, `cols=${gridCols}`);

await page.locator('button[aria-label="切换为列表视图"]').click();
await page.waitForTimeout(600);
const list = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main ul li')];
  const first = rows[0];
  const text = first ? first.innerText.replace(/\s+/g, ' ') : '';
  const avatarRound = first?.querySelector('span.rounded-full');
  return { rows: rows.length, text, hasRound: Boolean(avatarRound) };
});
check('列表视图渲染为行', list.rows >= 3, `rows=${list.rows}`);
check('列表行显示角色名与元信息', /原创|Tester|1\.0/.test(list.text), list.text.slice(0, 70));
check('列表头像为圆形', list.hasRound, '');

await page.locator('button[aria-label="切换为网格视图"]').click();
await page.waitForTimeout(500);
check('可切回网格视图', (await page.locator('main ul.grid').count()) > 0, '');

// ---- 5. group title uses & and diagonal avatar ------------------------
await page.locator('main article button[aria-label^="查看 "]').first().click({ timeout: 15000 });
await page.waitForTimeout(700);
const __s = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __s.count()) await __s.first().click();
await page.waitForTimeout(900);
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="对话设置"] button[aria-label="组建群聊"]').first().click();
await page.waitForTimeout(800);
const rows2 = page.locator('[role="dialog"][aria-label="组建群聊"] button[aria-pressed]');
await rows2.nth(0).click();
await rows2.nth(1).click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"][aria-label="组建群聊"] button', { hasText: '创建' }).first().click();
await page.waitForTimeout(1500);

const group = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId);
  return { title: chat?.title, members: chat?.groupCardIds?.length };
});
check('群聊名用 & 连接', /&/.test(group.title ?? ''), String(group.title));
check('群聊名形如 A & B', (group.title ?? '').split('&').length >= 2, String(group.title));

// Diagonal avatar present in the chat list panel.
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(800);
const diag = await page.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-label="聊天列表"]');
  if (!panel) return null;
  // The group row's avatar holds more than one <img>.
  const rows = [...panel.querySelectorAll('button[aria-label^="打开与"]')];
  for (const r of rows) {
    const imgs = r.querySelectorAll('img');
    if (imgs.length >= 2) {
      const rects = [...imgs].map((i) => i.getBoundingClientRect());
      const first = rects[0];
      const second = rects[1];
      return { count: imgs.length, diagonal: first.left < second.left && first.top < second.top };
    }
  }
  return { count: 0, diagonal: false };
});
check('群聊头像包含多个头像', diag && diag.count >= 2, JSON.stringify(diag));
check('头像按对角线排布', diag && diag.diagonal, JSON.stringify(diag));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
