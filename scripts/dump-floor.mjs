import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(400);
const text = await page.evaluate(() => {
  const code = [...document.querySelectorAll('#chat .mes pre code')].find((c) => /<!DOCTYPE|<html/i.test(c.textContent || ''));
  const bubble = code?.closest('.mes');
  return bubble?.textContent ?? '';
});
writeFileSync('real-floor.txt', text);
console.log('saved', text.length, 'chars');
await browser.close();
