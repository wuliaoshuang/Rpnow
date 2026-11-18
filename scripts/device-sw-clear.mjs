import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(500);

const r = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
  const keys = await caches?.keys?.() ?? [];
  for (const k of keys) await caches.delete(k);
  for (const reg of regs) await reg.unregister();
  return { swCount: regs.length, cachesCleared: keys, now: Date.now() };
});
console.log('SW 注销:', JSON.stringify(r));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const after = await page.evaluate(() => {
  const chat = document.getElementById('chat');
  return {
    swBack: navigator.serviceWorker?.controller ? 'yes' : 'no',
    mesCount: chat?.querySelectorAll('.mes').length ?? -1,
    htmlCards: document.querySelectorAll('#chat .rp-html-card').length,
    bareDoc: [...document.querySelectorAll('#chat .mes pre code')].filter((c) => /<!DOCTYPE|<html/i.test(c.textContent || '')).length,
  };
});
console.log('刷新后:', JSON.stringify(after));
await browser.close();
