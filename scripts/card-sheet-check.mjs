import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.length) {
    await s.addCard({
      id: 'sh1', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name: '详情测', description: '这是一个测试角色。', personality: '', scenario: '', first_mes: '你好。', mes_example: '', tags: ['原创', '日常'] },
    });
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1000);

await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);

// Toolbar: labeled buttons, no favorite/select toggles.
const bar = await page.evaluate(() => {
  const text = document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? '';
  return {
    hasFav: Boolean(document.querySelector('button[aria-label="只看收藏"]')),
    hasSelect: Boolean(document.querySelector('button[aria-label="批量选择"]')),
    labels: ['列表', '网格', '新建'].filter((l) => text.includes(l)),
  };
});
check('去掉了收藏/多选按钮', !bar.hasFav && !bar.hasSelect, JSON.stringify(bar));
check('顶栏按钮带文字标签', bar.labels.length >= 2, JSON.stringify(bar.labels));

// Tap a card → detail sheet (not a chat).
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(900);
const sheet = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label^="角色详情"]');
  if (!d) return { open: false };
  const start = d.querySelector('button[aria-label^="和 "]');
  return {
    open: true,
    hasImage: Boolean(d.querySelector('img')),
    hasStart: Boolean(start) && /开始新聊天/.test(start?.textContent ?? ''),
    roundedTop: getComputedStyle(d.lastElementChild).borderTopLeftRadius,
  };
});
check('点击卡片弹出详情 sheet', sheet.open, '');
check('sheet 有大图与「开始新聊天」', sheet.hasImage && sheet.hasStart, JSON.stringify(sheet));
check('sheet 顶部圆角', parseFloat(sheet.roundedTop ?? '0') >= 20, sheet.roundedTop);

// Still on the cards page (no chat created by the tap).
const route = await page.evaluate(() => document.querySelector('[data-route]')?.getAttribute('data-route'));
check('点卡片不会直接开聊（仍停在角色卡页）', route === 'cards', String(route));

// Start chat from the sheet.
await page.locator('[role="dialog"] button[aria-label^="和 "]').first().click();
await page.waitForTimeout(1200);
const chat = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  composer: Boolean(document.querySelector('textarea[aria-label="消息输入框"]')),
}));
check('sheet 内开始新聊天', chat.route === 'chat' && chat.composer, JSON.stringify(chat));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
