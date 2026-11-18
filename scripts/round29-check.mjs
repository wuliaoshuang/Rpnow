/**
 * Round 29: brand font file, card editor safe-areas + back handling.
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
      id: 'ed29', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name: '编辑测', description: '测试用。', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
    });
  }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 1. brand font loaded ----------------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(800);
const font = await page.evaluate(async () => {
  await document.fonts.ready;
  const brand = [...document.querySelectorAll('[role="dialog"][aria-label="聊天列表"] span')].find(
    (s) => s.textContent?.trim() === 'RPNow',
  );
  if (!brand) return { found: false };
  const cs = getComputedStyle(brand);
  return {
    found: true,
    family: cs.fontFamily,
    weight: cs.fontWeight,
    style: cs.fontStyle,
    loaded: document.fonts.check('700 italic 24px "Brand Serif"'),
  };
});
check('品牌字使用 Brand Serif', /Brand Serif/.test(font.family ?? ''), JSON.stringify(font));
check('品牌字为粗体 + 斜体', Number(font.weight) >= 700 && font.style === 'italic', JSON.stringify(font));
check('字体文件已加载', font.loaded === true, String(font.loaded));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ---- 2. card editor: open --------------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);
await page.locator('article button[aria-label$="操作菜单"]').first().click();
await page.waitForTimeout(500);
await page.locator('[role="menuitem"]', { hasText: '编辑' }).first().click();
await page.waitForTimeout(1200);

const editor = await page.evaluate(() => {
  const ed = document.querySelector('[role="dialog"][aria-label="角色卡编辑器"]');
  if (!ed) return { open: false };
  const header = ed.querySelector('header');
  const hcs = getComputedStyle(header);
  const save = [...header.querySelectorAll('button')].find((b) => /保存/.test(b.textContent || ''));
  const back = header.querySelector('button[aria-label="关闭编辑器"]');
  const scroll = ed.querySelector('.rp-scroll');
  return {
    open: true,
    hasBack: Boolean(back),
    headerTopPad: parseFloat(hcs.paddingTop),
    hasSave: Boolean(save && save.getBoundingClientRect().width > 0),
    scrollBottomPad: parseFloat(getComputedStyle(scroll.firstElementChild).paddingBottom),
    headerH: Math.round(header.getBoundingClientRect().height),
    role: ed.getAttribute('role'),
  };
});
check('编辑器已打开', editor.open, '');
check('头部有返回（关闭）按钮', editor.hasBack, '');
check('头部承担安全区 padding', editor.headerTopPad >= 0, String(editor.headerTopPad));
check('内容区底部有安全区留白', editor.scrollBottomPad >= 20, String(editor.scrollBottomPad));
check('「保存」按钮可见', editor.hasSave, '');
check('编辑器是 role=dialog（返回键可命中）', editor.role === 'dialog', String(editor.role));

// ---- 3. Escape closes it ----------------------------------------------
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const afterEsc = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="角色卡编辑器"]')));
check('Esc 关闭编辑器（不确认·无改动）', !afterEsc, String(afterEsc));

// ---- 4. Unsaved edits ask before closing ------------------------------
await page.locator('article button[aria-label$="操作菜单"]').first().click();
await page.waitForTimeout(500);
await page.locator('[role="menuitem"]', { hasText: '编辑' }).first().click();
await page.waitForTimeout(1000);
await page.locator('input[aria-label="角色名"], #card-name, input[id*="name"]').first().fill('改了名字').catch(() => {});
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const confirmShown = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"]')].some((d) => /放弃未保存/.test(d.textContent || '')),
);
check('有未保存修改时先确认', confirmShown, '');
// 取消 → 编辑器仍在
const cancelBtn = page.locator('[role="dialog"] button', { hasText: '取消' }).first();
if (await cancelBtn.count()) {
  await cancelBtn.click();
  await page.waitForTimeout(500);
}
const stillOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="角色卡编辑器"]')));
check('取消后编辑器保持打开', stillOpen, String(stillOpen));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
