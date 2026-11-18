/**
 * Two-level settings: hub with grouped rows (showing current values), tap to
 * drill into a section, back chevron returns to the hub; other sub-pages show a
 * back chevron in the shell header too.
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
    id: 'cs', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '设置测试', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatset', title: '设置测试', cardId: 'cs', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- cards page is a sub-page: back chevron in the shell header ----------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);
const cardsHeader = await page.evaluate(() => ({
  back: Boolean(document.querySelector('header button[aria-label="返回上一级"]')),
  title: document.querySelector('header h1')?.textContent,
}));
check('角色卡子页有返回按钮', cardsHeader.back, JSON.stringify(cardsHeader));
await page.locator('header button[aria-label="返回上一级"]').click();
await page.waitForTimeout(700);
check('返回按钮回到上一页', (await page.evaluate(() => document.querySelector('[data-route]')?.getAttribute('data-route'))) === 'chat', '');

// ---- settings hub --------------------------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).last().click();
await page.waitForTimeout(1100);

const hub = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main section button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim());
  return { rows, groups: [...document.querySelectorAll('main section h2')].map((h) => h.textContent) };
});
check('设置目录按组展示', hub.groups.includes('聊天') && hub.groups.includes('生图'), JSON.stringify(hub.groups));
check('目录行显示当前值', hub.rows.some((r) => r.includes('主题') && r.includes('午夜玫瑰')), JSON.stringify(hub.rows.slice(0, 6)));

// Drill into 主题 (appearance).
await page.locator('main section button', { hasText: '主题' }).first().click();
await page.waitForTimeout(900);
const appearance = await page.evaluate(() => ({
  hasBack: Boolean(document.querySelector('header button[aria-label="返回上一级"]')),
  title: document.querySelector('header h1')?.textContent,
  themes: document.body.innerText.includes('午夜玫瑰'),
}));
check('进入主题子页', appearance.hasBack && appearance.title === '主题' && appearance.themes, JSON.stringify(appearance));
await page.locator('header button[aria-label="返回上一级"]').click();
await page.waitForTimeout(700);
check('子页返回到目录', (await page.evaluate(() => document.body.innerText.includes('全部聊天') || Boolean(document.querySelector('main section')))), '');

// ---- shell-level back: settings → back → previous page -------------------
// Deep link from the chat drawer straight into a section. We are on the hub —
// climb back to the chat page first (the hub has no ☰ by design).
const toChat = page.locator('header button[aria-label="返回上一级"]');
if (await toChat.count()) {
  await toChat.first().click();
  await page.waitForTimeout(800);
}
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1000);
await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 15000 });
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(1000);
await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: 'API 连接' }).first().click();
await page.waitForTimeout(1000);
const deep = await page.evaluate(() => ({
  route: document.querySelector('[data-route]')?.getAttribute('data-route'),
  back: Boolean(document.querySelector('header button[aria-label="返回上一级"]')),
  hasTabs: Boolean(document.querySelector('[role="tablist"]')),
}));
check('聊天侧栏可深链进模型设置', deep.route === 'settings' && deep.back, JSON.stringify(deep));
// The user rejected the nested tab strip: a deep-linked sub-page shows only
// its own section forms (no [role=tab] strip inside).
check('子页不嵌页签条（只渲染该区块）', !deep.hasTabs, '');

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
