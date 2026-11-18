/**
 * 本地商店 e2e（浏览 / 搜索 / 详情 / 安装）。
 * 前置：scripts/market-server.mjs 运行中，且至少有一条内容。
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

/** 保证本地商店有可浏览内容（没有就写一条种子）。 */
function ensureSeed() {
  try {
    const list = JSON.parse(
      execFileSync(
        process.execPath,
        ['-e', 'fetch("http://127.0.0.1:8799/v1/items?kind=card").then(r=>r.text()).then(t=>console.log(t))'],
        { encoding: 'utf8', timeout: 5000 },
      ),
    );
    if (!list.items?.length) {
      execFileSync(process.execPath, ['scripts/seed-market.mjs'], { stdio: 'ignore', timeout: 30000 });
    }
  } catch {
    /* 商店未启动时由后面的用例报错 */
  }
}
ensureSeed();

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

// 进子页 → 顶栏商店
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

const state = () =>
  page.evaluate(() => ({
    hash: location.hash,
    text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '),
    dialog: Array.from(document.querySelectorAll('[role="dialog"], [data-radix-dialog-content]'))
      .map((e) => (e.innerText ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' '),
  }));

const s1 = await state();
check('进入商店页', s1.hash.includes('market'), s1.text.slice(0, 60));
check('列表/分类/排序可见', /全部分类/.test(s1.text) && /排序/.test(s1.text), s1.text.slice(0, 120));

// 搜索（种子数据名可用环境变量覆盖）
const seedName = process.env.MARKET_SEED ?? '示例';
await page.fill('input[placeholder*="搜索"]', seedName);
await page.waitForTimeout(1800);
const s2 = await state();
check('搜索命中', new RegExp(seedName).test(s2.text), s2.text.slice(0, 140));

// 详情
await page.evaluate((name) => {
  const btn = [...document.querySelectorAll('main li button')].find((b) => (b.textContent || '').includes(name));
  btn?.click();
}, seedName);
await page.waitForTimeout(1200);
const dialogInfo = await page.evaluate(() => ({
  dialogCount: document.querySelectorAll('[role="dialog"], [data-radix-dialog-content]').length,
  allText: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(-220),
}));
const s3 = await state();
check(
  '详情显示元数据',
  /许可|更新于|作者/.test(s3.dialog) || /许可|更新于/.test(dialogInfo.allText),
  `dialogs=${dialogInfo.dialogCount} dialog="${s3.dialog.slice(0, 80)}" tail="${dialogInfo.allText.slice(-90)}"`,
);

// 安装
const before = await page.evaluate(() => window.__rpnowStore.getState().cards.length);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /安装/.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(3000);
const after = await page.evaluate(() => window.__rpnowStore.getState().cards.length);
check('安装后角色卡增加', after > before, `${before} -> ${after}`);

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
