import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
await page.waitForTimeout(800);

const info = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const list = await mod.listInstalled();
  const kernel = window.__rpnowStore?.getState?.().kernel;
  const recs = kernel?.records().map((r) => ({
    id: r.manifest.id,
    state: r.state,
    error: r.error,
    origin: r.origin,
    version: r.manifest.version,
    name: r.manifest.name,
  }));
  return { installed: list.map((r) => ({ id: r.manifest.id, enabled: r.enabled, name: r.manifest.name })), recs };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
