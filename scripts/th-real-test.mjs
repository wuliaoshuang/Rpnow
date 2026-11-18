/** 用真实酒馆助手包走一遍解析 + 激活，抓真实报错。 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 300)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

const r = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/tavern-helper-real.zip');
  if (!res.ok) return { fetchFail: res.status };
  const blob = await res.blob();
  const out = { size: blob.size };
  let parsed;
  try {
    parsed = await mod.parseRpnx(blob);
    out.parsed = {
      id: parsed.manifest.id,
      name: parsed.manifest.name,
      kind: parsed.manifest.kind,
      stEntry: parsed.manifest.stEntry,
      codeLen: parsed.code.length,
      assetKeys: Object.keys(parsed.assets ?? {}),
    };
  } catch (e) {
    out.parseError = String(e.message).slice(0, 300);
    return out;
  }
  try {
    await mod.install(parsed, true);
    const { reloadInstalledPlugins } = await import('/src/boot.ts');
    await reloadInstalledPlugins();
    await new Promise((r) => setTimeout(r, 2500));
    const kernel = window.__rpnowStore.getState().kernel;
    const rec = kernel.records().find((x) => x.manifest.id.startsWith('st.'));
    out.record = rec ? { id: rec.manifest.id, state: rec.state, error: rec.error } : null;
  } catch (e) {
    out.activateError = String(e.message).slice(0, 400);
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
