/**
 * 真机商店验证（设备端 e2e）。
 *
 * 前置：
 *   - APK 已安装，应用已启动；
 *   - `adb reverse tcp:8799 tcp:8799`（让手机上的 127.0.0.1:8799 指向 PC 商店）；
 *   - 本地商店服务运行中，且有内容（scripts/seed-market.mjs）。
 *
 * 断言：进入商店 → 列表非空 → 搜索命中 → 详情含元数据 → 安装卡片入库。
 */
import { chromium } from 'playwright';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
let page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
await page.waitForTimeout(800);

// 清掉旧 hash，从聊天页出发（与真机使用一致）
await page.evaluate(() => {
  location.hash = '#chat';
});
await page.waitForTimeout(2500);

// 进子页 → 顶栏「商店」
const entered = await page.evaluate(() => {
  const nav = [...document.querySelectorAll('button,a,[role="button"]')].find((e) =>
    (e.textContent || '').includes('角色卡'),
  );
  nav?.click();
  return !!nav;
});
await page.waitForTimeout(1500);
const shopOpened = await page.evaluate(() => document.querySelector('button[aria-label="商店"]')?.click() ?? false);
await page.waitForTimeout(3000);

const snap = async () =>
  page.evaluate(() => ({
    hash: location.hash,
    text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '),
    dialogs: Array.from(document.querySelectorAll('[role="dialog"], [data-radix-dialog-content]'))
      .map((e) => (e.innerText ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' '),
    cards: window.__rpnowStore?.getState().cards.length ?? -1,
  }));

const s1 = await snap();
check('进入商店页', entered && shopOpened && s1.hash.includes('market'), s1.text.slice(0, 60));
check('商店列表有内容', !/还没有内容/.test(s1.text), s1.text.slice(0, 140));

// 搜索种子内容
await page.fill('input[placeholder*="搜索"]', process.env.MARKET_SEED ?? '示例');
await page.waitForTimeout(1800);
const s2 = await snap();
check('搜索命中', new RegExp(process.env.MARKET_SEED ?? '示例').test(s2.text), s2.text.slice(0, 140));

// 详情 + 安装
await page.evaluate((name) => {
  const btn = [...document.querySelectorAll('main li button')].find((b) => (b.textContent || '').includes(name));
  btn?.click();
}, process.env.MARKET_SEED ?? '示例');
await page.waitForTimeout(1200);
const s3 = await snap();
check('详情含元数据', /许可|更新于|下载/.test(s3.dialogs), s3.dialogs.slice(0, 140));

const before = s3.cards;
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /安装/.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(3000);
const s4 = await snap();
check('安装后卡片入库', s4.cards > before, `${before} -> ${s4.cards}`);

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
