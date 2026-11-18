/**
 * Verifies the PWA (web fallback target): manifest, icons, service worker,
 * installability signals and offline app-shell loading.
 */
import { chromium } from 'playwright';

const URL = process.env.RPNOW_PWA ?? 'http://127.0.0.1:4181/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 25000 });
check('PWA 页面加载成功', true);

// Manifest
const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
check('存在 web manifest 链接', Boolean(manifestHref), manifestHref ?? '');

const manifest = await page.evaluate(async (href) => {
  const res = await fetch(href);
  return res.ok ? res.json() : null;
}, manifestHref);
check('manifest 可解析', Boolean(manifest));
if (manifest) {
  check('manifest 有名称与图标', Boolean(manifest.name) && Array.isArray(manifest.icons) && manifest.icons.length > 0);
  check('display 为 standalone', manifest.display === 'standalone', manifest.display);
  check('包含 maskable 图标', manifest.icons.some((i) => i.purpose === 'maskable'));
}

// Icons actually resolve
const iconStatus = await page.evaluate(async () => {
  const out = {};
  for (const p of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/icon.svg']) {
    try {
      const r = await fetch(p);
      out[p] = r.status;
    } catch {
      out[p] = 'error';
    }
  }
  return out;
});
console.log('icon statuses:', JSON.stringify(iconStatus));
check('所有图标可访问', Object.values(iconStatus).every((s) => s === 200));

// Service worker registration
const swState = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'none';
  await navigator.serviceWorker.ready;
  return reg.active ? 'active' : 'pending';
});
check('Service Worker 已激活', swState === 'active', swState);

// Offline: after SW caches the shell, a reload with the network cut must still boot.
const context = page.context();
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await context.setOffline(true);
let offlineOk = false;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('nav[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 20000 });
  offlineOk = true;
} catch {
  offlineOk = false;
}
await context.setOffline(false);
check('断网后仍可启动（离线壳）', offlineOk);

// The web target must be honest about needing a proxy (not the desktop copy).
await page.getByRole('button', { name: '\u8bbe\u7f6e' }).first().click();
await page.waitForTimeout(600);
const body = await page.evaluate(() => document.body.innerText);
check('Web 版未显示「桌面版」标识', !body.includes('\u684c\u9762\u7248\uff08\u539f\u751f\u7f51\u7edc\uff09'));

check('无页面错误', errs.length === 0, errs.slice(0, 2).join('; '));
await page.screenshot({ path: 'screenshots/23-pwa.png' });

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
