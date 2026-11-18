import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/aihorde|horde|500 \(Internal/.test(t)) errors.push(t.slice(0, 200));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const info = await page.evaluate(() => {
  const st = window.SillyTavern;
  let ctx = null;
  try {
    ctx = st?.getContext?.();
  } catch (e) {
    ctx = { error: String(e) };
  }
  return {
    hasSillyTavernGlobal: !!st,
    hasGetContext: typeof st?.getContext,
    extensionSettingsKeys: ctx?.extensionSettings ? Object.keys(ctx.extensionSettings) : null,
    disabledExtensions: ctx?.extensionSettings?.disabledExtensions ?? null,
    extContainerChildren: document.getElementById('extensions_settings')?.children.length ?? null,
    tavernHelperNode: !!document.getElementById('tavern_helper'),
    chatLen: Array.isArray(window.chat) ? window.chat.length : null,
    characters: Array.isArray(window.characters) ? window.characters.length : null,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 10)));
await browser.close();
