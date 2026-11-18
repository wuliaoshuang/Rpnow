/**
 * Round 32: no stray text above the chat, card sheet portaled (scrim + no
 * clipping), single ＋ entry → 创建角色 sub-page, edit-sheet focus sticks.
 */
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
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.length) {
    await s.addCard({
      id: 'r32', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name: '回归测', description: '测试。', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
    });
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1100);

// ---- 1. chat area starts at y=0 (no stray text before it) --------------
const chatTop = await page.evaluate(() => {
  const main = document.querySelector('main');
  const shell = main?.firstElementChild;
  // Any raw text node directly inside <main> would render as spare characters.
  let strayText = '';
  for (const n of main?.childNodes ?? []) {
    if (n.nodeType === 3 && n.textContent?.trim()) strayText += n.textContent.trim();
  }
  return {
    mainTop: Math.round(main.getBoundingClientRect().top),
    shellTop: shell ? Math.round(shell.getBoundingClientRect().top) : null,
    strayText,
    mainText: (main?.innerText ?? '').trim().slice(0, 24),
  };
});
check('聊天区顶到视口顶部（无多余字符撑开）', chatTop.mainTop === 0 && chatTop.shellTop === 0, JSON.stringify(chatTop));
check('主区没有游离文本节点', chatTop.strayText === '', JSON.stringify(chatTop.strayText));
check('聊天正文首字符正常', /^[^\n]/.test(chatTop.mainText) && !chatTop.mainText.startsWith('n'), chatTop.mainText);

// ---- 2. card sheet: portaled to body, has scrim, not clipped -----------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(800);
const sheet = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label^="角色详情"]');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const panel = d.lastElementChild;
  const pr = panel.getBoundingClientRect();
  return {
    open: true,
    parentIsBody: d.parentElement === document.body,
    coversViewport: Math.round(r.width) >= window.innerWidth && Math.round(r.height) >= window.innerHeight,
    hasScrim: cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
    panelInsideViewport: pr.left >= -1 && pr.right <= window.innerWidth + 1 && pr.bottom <= window.innerHeight + 1,
    panelW: Math.round(pr.width),
    vw: window.innerWidth,
  };
});
check('sheet 挂到 body 上（不再被推拉层裁切）', sheet.parentIsBody, JSON.stringify(sheet));
check('sheet 铺满视口且有遮罩', sheet.coversViewport && sheet.hasScrim, JSON.stringify(sheet));
check('面板完整落在视口内（无裁切）', sheet.panelInsideViewport, JSON.stringify(sheet));
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// ---- 3. single ＋ → 创建角色 sub-page ---------------------------------
const toolbar = await page.evaluate(() => ({
  importBtn: Boolean(document.querySelector('button[aria-label="导入角色卡"]')),
  aiBtn: Boolean(document.querySelector('button[aria-label="AI 生成角色卡"]')),
  newBtn: Boolean(document.querySelector('button[aria-label="新建角色"]')),
}));
check('工具栏只保留「新建」', toolbar.newBtn && !toolbar.importBtn && !toolbar.aiBtn, JSON.stringify(toolbar));

await page.locator('button[aria-label="新建角色"]').click();
await page.waitForTimeout(800);
const createPage = await page.evaluate(() => {
  const text = document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? '';
  return {
    hasTitle: text.includes('创建角色'),
    rows: ['新建角色', '从文件导入角色卡', '从URL导入角色卡'].filter((t) => text.includes(t)),
    hasBack: Boolean(document.querySelector('main button[aria-label="返回角色卡"]')),
  };
});
check('＋ 进入创建角色子页', createPage.hasTitle && createPage.rows.length === 3, JSON.stringify(createPage));
check('子页有返回', createPage.hasBack, '');
await page.locator('main button[aria-label="返回角色卡"]').click();
await page.waitForTimeout(600);
check('返回后回到角色卡列表', await page.evaluate(() => Boolean(document.querySelector('article'))), '');

// ---- 4. edit sheet: focus sticks --------------------------------------
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const start = page.locator('[role="dialog"] button[aria-label^="和 "]').first();
if (await start.count()) await start.click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(900);
await page.locator('button[aria-label="更多操作"]').last().click();
await page.waitForTimeout(500);
await page.locator('[role="menuitem"]', { hasText: '编辑消息' }).first().click();
await page.waitForTimeout(1200);
const focus1 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
await page.waitForTimeout(900);
const focus2 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
check('编辑 sheet 打开后输入框获得焦点', focus1 === '编辑消息内容', String(focus1));
check('焦点不会立刻丢失（等待后仍在）', focus2 === '编辑消息内容', String(focus2));

// Typing still lands in the textarea.
await page.keyboard.type('追加文字');
await page.waitForTimeout(400);
const typed = await page.evaluate(() => document.querySelector('textarea[aria-label="编辑消息内容"]')?.value ?? '');
check('输入内容写入编辑框', typed.includes('追加文字'), typed.slice(-14));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
