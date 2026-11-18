import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const code = [...document.querySelectorAll('#chat .mes pre code')].find((c) => /<!DOCTYPE|<html/i.test(c.textContent || ''));
  const bubble = code?.closest('.mes');
  const all = bubble?.textContent ?? '';
  // 找所有 ``` 的位置与前后 12 字符（真实围栏形态）
  const marks = [];
  let idx = all.indexOf('```');
  while (idx >= 0 && marks.length < 6) {
    marks.push({ at: idx, ctx: all.slice(Math.max(0, idx - 14), idx + 14).replace(/\n/g, '⏎') });
    idx = all.indexOf('```', idx + 3);
  }
  return { marks, totalLen: all.length };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
