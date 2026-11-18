import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

const r = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/th-probe.rpnx');
  const parsed = await mod.parseRpnx(await res.blob());
  await mod.install(parsed, true);
  const { reloadInstalledPlugins } = await import('/src/boot.ts');
  await reloadInstalledPlugins();
  await new Promise((r) => setTimeout(r, 3000));
  return { probe: window.__thProbe ?? null };
});
console.log('结果:', JSON.stringify(r, null, 1).slice(0, 1500));
await browser.close();
