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

await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 4000 });
await page.waitForTimeout(600);

// Which close button does `dlg.locator('button[aria-label="关闭"]')` resolve to,
// and what covers it?
const info = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  const btns = [...dlg.querySelectorAll('button[aria-label="关闭"]')];
  return btns.map((b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      hit: hit ? `${hit.tagName}/${(hit.getAttribute('aria-label') || '').slice(0, 16)}` : 'none',
      hitIsSelf: hit === b || b.contains(hit),
      html: b.outerHTML.slice(0, 110),
    };
  });
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
