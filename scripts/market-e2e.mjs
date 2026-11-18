/**
 * 本地商店端到端：浏览 → 详情 → 安装 → 发布。
 *
 * 前置：scripts/market-server.mjs 已启动（:8799），且 market-local/ 里已有内容
 * （可用 scripts/_market-smoke.mjs 造一条）。
 */
import { chromium } from 'playwright';

const BASE = process.env.RPNOW_E2E_BASE ?? 'http://127.0.0.1:5175/';
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

// ---- 1. 顶栏进入商店（聊天页无顶栏，先进入任一子页） ------------------
await page.evaluate(() => {
  const b =
    [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
      (e.textContent || '').includes('角色卡'),
    ) ?? [...document.querySelectorAll('button')].find((e) => /去角色卡页面/.test(e.textContent || ''));
  b?.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('button[aria-label="商店"]')?.click());
await page.waitForTimeout(2500);
const onMarket = await page.evaluate(() => ({
  hash: location.hash,
  text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
}));
check('顶栏可进入商店页', onMarket.hash.includes('market'), onMarket.text.slice(0, 80));

// ---- 2. 列表可见（来自本地商店源） ----------------------------------
await page.waitForTimeout(2000);
const listText = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '));
check('商店列表有内容', !/还没有内容/.test(listText), listText.slice(0, 120));

// ---- 3. 搜索生效 ----------------------------------------------------
await page.fill('input[placeholder*="搜索"]', '探针');
await page.waitForTimeout(1500);
const searched = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '));
check('搜索能命中', /探针/.test(searched), searched.slice(0, 120));

// ---- 4. 详情 ---------------------------------------------------------
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('main button')].find((b) => (b.textContent || '').includes('探针'));
  btn?.click();
});
await page.waitForTimeout(1200);
const detail = await page.evaluate(
  () =>
    (document.querySelector('[role="dialog"]')?.innerText ?? document.querySelector('main')?.innerText ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 300),
);
check('详情弹窗显示元数据', /许可|分类|更新/.test(detail), detail.slice(0, 160));

// ---- 5. 安装 --------------------------------------------------------
const installed = await page.evaluate(async () => {
  const before = window.__rpnowStore.getState().cards.length;
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /安装/.test(b.textContent || ''));
  btn?.click();
  await new Promise((r) => setTimeout(r, 2500));
  const after = window.__rpnowStore.getState().cards.length;
  return { before, after };
});
check('安装后角色卡数量增加', installed.after > installed.before, JSON.stringify(installed));

// ---- 6. 通过发布向导发布一个新插件包 ---------------------------------
// 直接用 store 造一张卡，再从菜单打开发布向导。
await page.evaluate(() => {
  document.querySelector('[role="dialog"] button')?.click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,[role="button"]')].find((e) => (e.textContent || '').trim() === '角色卡');
  b?.click();
});
await page.waitForTimeout(1500);
const publishEntry = await page.evaluate(() => {
  const menuBtn = document.querySelector('button[aria-label$="的更多操作"]');
  if (!menuBtn) return null;
  menuBtn.click();
  return true;
});
await page.waitForTimeout(800);
const clickedPublish = await page.evaluate(() => {
  const item = [...document.querySelectorAll('[role="menuitem"], button')].find((e) =>
    (e.textContent || '').includes('发布到商店'),
  );
  if (!item) return false;
  item.click();
  return true;
});
check('角色卡菜单提供「发布到商店」入口', Boolean(publishEntry && clickedPublish));
await page.waitForTimeout(1200);

// 填表并发布
await page.fill('#pub-name', '商店验收卡');
await page.fill('#pub-summary', '由端到端测试自动发布');
await page.fill('#pub-author', 'e2e-probe');
await page.selectOption('#pub-category', { index: 1 }).catch(() => {});
await page.fill('#pub-tags', '验收, 自动化');
await page.fill('#pub-changelog', '首次发布');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /校验并发布/.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(4000);
const published = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').replace(/\s+/g, ' '));
check('发布成功', /发布成功|已发布/.test(published), published.slice(0, 120));

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
