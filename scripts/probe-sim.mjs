import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const s = window.__rpnowStore.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// === replicate the audit probe sequence ===
await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 4000 });
await page.waitForTimeout(450);
for (let i = 0; i < 3; i++) {
  const pe = await page.evaluate(() => getComputedStyle(document.body).pointerEvents);
  if (pe === 'auto') break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
const dlg = page.locator('[role="dialog"]').first();
const visible = await dlg.isVisible().catch(() => false);
console.log('dialog visible after click:', visible, '| label:', await dlg.getAttribute('aria-label').catch(() => '?'));
if (visible) {
  const closeBtn = dlg.locator('button[aria-label="关闭"], button[aria-label="取消"]').first();
  console.log('close btn count:', await closeBtn.count());
  await closeBtn.click({ timeout: 2000 }).catch((e) => console.log('close click err:', e.message.split('\n')[0]));
  await page.waitForTimeout(600);
  console.log('still visible:', await dlg.isVisible().catch(() => false));
}
await browser.close();
