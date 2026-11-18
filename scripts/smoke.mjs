/**
 * Browser smoke test.
 *
 * Verifies the app boots and the critical flows work in a real Chromium:
 * theme application, card library, chat opening with swipes, prompt assembly,
 * settings, plugins, and the mobile layout. Screenshots land in ./screenshots.
 *
 * Run with the dev server on 5173:  node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.RPNOW_URL ?? 'http://127.0.0.1:5173/';
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
}


/**
 * Wait until a VISIBLE node containing `text` exists.
 *
 * `page.waitForSelector('text=X')` picks the first match even when it sits in
 * a collapsed drawer (`visibility:hidden`), so on a clean install it times out
 * forever. This helper polls for a leaf node that actually renders.
 */
async function waitForVisibleText(text, timeout = 8000) {
  await page.waitForFunction(
    (t) =>
      Array.from(document.querySelectorAll('body *')).some((e) => {
        if (e.children.length !== 0) return false;
        if (!(e.textContent || '').includes(t)) return false;
        if (!e.getClientRects().length) return false;
        const cs = getComputedStyle(e);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      }),
    text,
    { timeout },
  );
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// ---------------------------------------------------------------- 1. boot
/*
 * Wait for visible content in the main region. Text-based sync points are
 * unreliable here: with a clean install the first match lands on a node inside
 * the collapsed (visibility:hidden) drawer, so the wait can never succeed.
 */
await page.waitForSelector('main > *', { state: 'visible', timeout: 20000 });
check('应用启动并渲染导航', true);
check(
  '主题变量已应用',
  await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--rp-bg').trim().length > 0,
  ),
);
check('暗色模式已启用', await page.evaluate(() => document.documentElement.classList.contains('dark')));

// ----------------------------------------------------- 2. seed sample data
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const presets = await import('/src/core/defaults/presets.ts');
  const s = store.useApp.getState();
  if (s.cards.length === 0) {
    for (const card of data.SAMPLE_CARDS) await s.addCard(structuredClone(card));
    await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
    for (const p of presets.BUILTIN_PRESETS) await s.savePreset(structuredClone(p));
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
/*
 * Wait for visible content in the main region. Text-based sync points are
 * unreliable here: with a clean install the first match lands on a node inside
 * the collapsed (visibility:hidden) drawer, so the wait can never succeed.
 */
await page.waitForSelector('main > *', { state: 'visible', timeout: 20000 });
await page.waitForTimeout(800);

// ------------------------------------------------------- 3. card library
await page.getByRole('button', { name: '角色卡' }).first().click();
await waitForVisibleText('阿尔德里克', 10000);
check('角色卡库显示示例角色', true);
const tiles = await page.locator('article').count();
check('角色卡数量正确', tiles >= 3, tiles + ' cards');
await page.screenshot({ path: OUT + '/01-card-library.png' });

// ------------------------------------------------------------ 4. start chat
// Tapping a card opens its detail sheet; 开始新聊天 is the way in.
await page.locator('[aria-label*="查看 阿尔德里克"]').first().click();
await page.waitForTimeout(700);
const startBtn = page.locator('[role="dialog"] button[aria-label*="和 阿尔德里克"]').first();
if (await startBtn.count()) await startBtn.click();
await waitForVisibleText('要热的，还是想要烈的？', 10000);
check('开场白已渲染', true);

// -------------------------------------------------------- 5. swipe greeting
const swipeBtn = page.getByRole('button', { name: '下一段开场白' }).first();
await swipeBtn.click();
await page.waitForTimeout(400);
check('备选开场白可切换', (await page.locator('text=楼上有个房间').count()) > 0);

// ---------------------------------------------------- 6. prompt inspector
// The composer footer is gone (entries live in the ＋ panel / right panel):
// open the right side panel → 情景设定.
await page.locator('button[aria-label="打开对话设置"]').first().click();
await page.waitForTimeout(600);
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '情景设定' }).first().click();
await waitForVisibleText('提示词构成', 8000);
check('提示词检查器可用', true);
await page.getByRole('tab', { name: '区块' }).click();
await page.waitForTimeout(300);
const blockRows = await page.locator('li, div:has-text("主提示")').count();
check('区块列表已渲染', blockRows > 0);
await page.getByRole('tab', { name: /世界书/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/02-prompt-inspector.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/03-chat.png' });

// ------------------------------------------------- 7. renderer correctness
const html = await page.evaluate(async () => {
  const r = await import('/src/core/render/renderer.ts');
  return r.defaultRenderer.render(
    '**bold** and *italic*\n\n<div class="status-bar"><span>HP 100</span></div>\n\n<style>.status-bar{color:red}</style>\n\n<script>alert(1)</script>',
  );
});
check('渲染器保留卡片 HTML', html.includes('status-bar'));
check('渲染器移除 script', !/<script/i.test(html));
check('渲染器输出作用域样式', html.includes('<style>'));

// ------------------------------------------------------ 8. settings models
await page.getByRole('button', { name: '设置' }).first().click();
// 设置 now opens the grouped hub; the connection form lives in 模型连接.
await waitForVisibleText('模型连接', 8000);
const modelRow = page.locator('main section button', { hasText: '模型连接' }).first();
if (await modelRow.count()) {
  await modelRow.click();
  await page.waitForTimeout(800);
}
await page.getByRole('button', { name: /添加连接/ }).click();
await waitForVisibleText('服务商', 5000);
check('模型设置表单可用', true);
await page.screenshot({ path: OUT + '/04-settings-models.png' });

// ------------------------------------------------------------ 9. themes
// Back to the hub, then into 主题 (formerly the 外观 tab).
await page.locator('header button[aria-label="返回上一级"]').first().click();
await page.waitForTimeout(700);
await page.locator('main section button', { hasText: '主题' }).first().click();
// 主题项是 button；直接等它可见，避免命中同名的隐藏节点。
  await page.getByRole('button', { name: /午夜玫瑰/ }).first().waitFor({ state: 'visible', timeout: 5000 });
await page.getByRole('button', { name: /纸墨/ }).click();
await page.waitForTimeout(600);
check('主题切换生效', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
await page.screenshot({ path: OUT + '/05-theme-paper.png' });
await page.getByRole('button', { name: /午夜玫瑰/ }).click();
await page.waitForTimeout(400);

// ----------------------------------------------------------- 10. plugins
// Plugins live behind the hub's 更多 section now.
await page.locator('header button[aria-label="返回上一级"]').first().click();
await page.waitForTimeout(600);
await page.locator('main section button', { hasText: '插件管理' }).first().click();
await waitForVisibleText('内置服务', 8000);
await page.getByRole('tab', { name: /内置服务/ }).click();
await page.waitForTimeout(400);
check('插件页显示内核服务', (await page.locator('li:has-text("LLM")').count()) > 0);
await page.screenshot({ path: OUT + '/06-plugins.png' });

// ----------------------------------------------------------- 11. presets
await page.getByRole('button', { name: '预设' }).first().click();
await waitForVisibleText('区块顺序', 8000);
check('预设页显示区块顺序', true);
await page.screenshot({ path: OUT + '/07-presets.png' });

// --------------------------------------------------------- 12. lorebooks
await page.getByRole('button', { name: '世界书' }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/08-lorebooks.png' });

// ------------------------------------------------------- 13. card editor
await page.getByRole('button', { name: '角色卡' }).first().click();
await waitForVisibleText('阿尔德里克', 8000);
// Pure poster cards: actions live in the corner ⋮ menu.
await page.locator('article button[aria-label$="操作菜单"]').first().click();
await page.waitForTimeout(500);
await page.getByRole('menuitem', { name: /编辑/ }).click();
await page.waitForSelector('main input, main textarea', { state: 'attached', timeout: 8000 });
check('角色卡编辑器可用', true);
await page.screenshot({ path: OUT + '/09-card-editor.png' });
await page.getByRole('tab', { name: '世界书' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/10-card-editor-lorebook.png' });
check('编辑器内嵌世界书可用', (await page.locator('text=银鹭酒馆').count()) > 0);

// ------------------------------------------------------- 14. mobile layout
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
mobile.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await mobile.goto(BASE, { waitUntil: 'domcontentloaded' });
await mobile.waitForSelector('[data-route]', { timeout: 20000 });
await mobile.waitForTimeout(900);
// Tavo 结构：底部导航已移除，导航走全局抽屉。
check('移动端底部导航已移除', !(await mobile.locator('[aria-label="底部导航"]').isVisible()));
check('移动端隐藏桌面侧栏', !(await mobile.locator('[aria-label="主导航"]').isVisible()));
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check('移动端无横向溢出', overflow <= 1, 'overflow ' + overflow + 'px');
await mobile.screenshot({ path: OUT + '/11-mobile-chat.png' });
await mobile.locator('button[aria-label="打开聊天列表"]').first().click();
await mobile.waitForTimeout(700);
await mobile.screenshot({ path: OUT + '/12-mobile-panel-left.png' });
// Tavo 结构：左栏底部三个圆钮，角色在中间。
await mobile.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).first().click();
await mobile.waitForTimeout(900);
await mobile.screenshot({ path: OUT + '/13-mobile-cards.png' });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (errors.length) {
  console.log('\nConsole errors (' + errors.length + '):');
  for (const e of errors.slice(0, 20)) console.log('  x ' + e);
}
process.exit(failed.length || errors.length ? 1 : 0);
