import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);

const popups = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.popup, dialog, [role="dialog"], .mes_block, .drawer-content'))
    .filter((e) => e.offsetParent !== null)
    .slice(0, 6)
    .map((e) => ({
      cls: String(e.className).slice(0, 40),
      id: e.id,
      text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      buttons: Array.from(e.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).slice(0, 8),
    })),
);
console.log('visible popups:', JSON.stringify(popups, null, 1));

// 逐个尝试确认/关闭
for (let i = 0; i < 4; i++) {
  const acted = await page.evaluate(() => {
    for (const t of ['确定', 'OK', 'Confirm', '继续', 'Close', '关闭']) {
      const b = [...document.querySelectorAll('button')].find(
        (x) => (x.textContent || '').trim() === t && x.offsetParent !== null,
      );
      if (b) {
        b.click();
        return t;
      }
    }
    return null;
  });
  if (!acted) break;
  console.log('clicked:', acted);
  await page.waitForTimeout(2500);
}

await page.waitForTimeout(8000);
const state = await page.evaluate(async () => {
  const st = window.SillyTavern;
  let ctx = null;
  try {
    ctx = st?.getContext?.();
  } catch {
    /* ignore */
  }
  return {
    name1: ctx?.name1,
    characters: Array.isArray(window.characters) ? window.characters.length : typeof window.characters,
    chat: Array.isArray(window.chat) ? window.chat.length : typeof window.chat,
    hasTavernHelper: !!document.getElementById('tavern_helper'),
    thNodes: document.getElementById('tavern_helper')?.querySelectorAll('*').length ?? 0,
    extKeys: ctx?.extensionSettings ? Object.keys(ctx.extensionSettings).length : null,
    disabled: ctx?.extensionSettings?.disabledExtensions ?? null,
    mainText: (document.querySelector('mess_text, #chat, main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120),
  };
});
console.log('state:', JSON.stringify(state, null, 1));
await page.screenshot({ path: 'screenshots/st-clean.png' }).catch(() => {});
await browser.close();
