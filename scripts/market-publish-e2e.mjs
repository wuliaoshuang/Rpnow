/**
 * 本地商店 e2e（发布，经商店内入口）：商店 → 发布内容 → 选卡片 → 填表 → 发布 → 可见。
 */
import { chromium } from 'playwright';

const BASE = process.env.RPNOW_E2E_BASE ?? 'http://127.0.0.1:5175/';
const NAME = `验收卡-${Date.now().toString(36)}`;
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// 准备一张卡（并刷新以加载最新模块图）
await page.evaluate(async (name) => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.some((c) => c.data.name === name)) {
    await s.addCard({
      id: `pub_${Date.now().toString(36)}`,
      spec: 'v2',
      specVersion: '2.0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: { name, description: '端到端发布验收', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
    });
  }
}, NAME);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

// 进子页 → 商店
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
    (e.textContent || '').includes('角色卡'),
  );
  b?.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('button[aria-label="商店"]')?.click());
await page.waitForTimeout(2200);

// 打开发布来源选择器
await page.getByRole('button', { name: '发布内容' }).click();
await page.waitForTimeout(800);

// 选择卡片（radix Select：点 trigger → 点选项）
await page.locator('[role="dialog"] button').filter({ hasText: /选择卡片/ }).first().click();
await page.waitForTimeout(700);
const picked = await page.evaluate((name) => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').trim() === name);
  if (!opt) return false;
  opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  opt.click();
  return true;
}, NAME);
check('可在商店内选择要发布的卡片', picked);
await page.waitForTimeout(800);
const nextState = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '下一步');
  if (!b) return { found: false, disabled: null };
  const disabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
  if (!disabled) b.click();
  return { found: true, disabled };
});
check('来源已选定（下一步可用）', nextState.found && !nextState.disabled, JSON.stringify(nextState));
await page.waitForTimeout(1000);

check('发布向导已打开', (await page.locator('#pub-name').count()) > 0);

await page.fill('#pub-name', NAME);
await page.fill('#pub-summary', '端到端测试自动发布');
await page.fill('#pub-author', 'publish-e2e');
await page.fill('#pub-tags', '验收, 自动化');
await page.fill('#pub-changelog', '首次发布');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /校验并发布/.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(5000);

const publishedText = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="dialog"], [data-radix-dialog-content]'))
    .map((e) => (e.innerText ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' '),
);
check('发布成功', /发布成功|已发布/.test(publishedText), publishedText.slice(0, 120));

// 回列表确认可见
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.fill('input[placeholder*="搜索"]', NAME);
await page.waitForTimeout(2000);
const listed = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '));
check('商店中可见新发布内容', listed.includes(NAME), listed.slice(0, 140));

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
