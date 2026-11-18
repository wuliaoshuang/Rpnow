// Re-capture key screens after data settles, at both desktop and mobile widths.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[aria-label="主导航"]', { timeout: 20000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) {
    for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
    await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
  }
});
await page.waitForTimeout(800);


// Card editor
await page.getByRole('button', { name: '\u89d2\u8272\u5361' }).first().click();
await page.waitForTimeout(600);
await page.locator('[aria-label*="\u963f\u5c14\u5fb7\u91cc\u514b"]').first().hover();
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/14-cards-hover.png' });
await page.locator('[aria-label*="\u66f4\u591a\u64cd\u4f5c"]').first().click();
await page.waitForTimeout(300);
await page.getByRole('menuitem', { name: /\u7f16\u8f91/ }).click();
await page.waitForSelector('text=\u89d2\u8272\u540d\u79f0', { timeout: 10000 });
await page.waitForTimeout(900);
await page.screenshot({ path: 'screenshots/15-card-editor-identity.png' });
await page.getByRole('tab', { name: '\u4e16\u754c\u4e66' }).click();
await page.waitForTimeout(900);
// Expand an entry to show the full editor form
const rows = page.locator('button[aria-expanded]').filter({ hasText: '\u7070\u70ec\u4e4b\u57ce' });
const n = await rows.count();
console.log('lore entries:', n);
if (n > 0) {
  await rows.first().click();
  await page.waitForTimeout(900);
}
await page.screenshot({ path: 'screenshots/16-card-editor-lorebook.png' });

await browser.close();
console.log('captured');
