import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const code = [...document.querySelectorAll('#chat .mes pre code')].find((c) => /<!DOCTYPE|<html/i.test(c.textContent || ''));
  if (!code) return { found: false };
  const pre = code.closest('pre');
  const bubble = pre.closest('.mes');
  const all = bubble?.textContent ?? '';
  const markers = [];
  // 找出该楼层所有 ``` 出现位置前后文
  let idx = all.indexOf('```');
  while (idx >= 0 && markers.length < 3) {
    markers.push(all.slice(Math.max(0, idx - 15), idx + 25).replace(/\n/g, '\\n'));
    idx = all.indexOf('```', idx + 1);
  }
  return {
    found: true,
    fenceMarkers: markers,
    preSiblings: pre.parentElement ? [...pre.parentElement.children].map((c) => c.tagName + '.' + String(c.className).slice(0, 20)) : [],
    // 该楼层的完整 HTML 有没有 rp-html-card 占位符被 our renderer 处理过
    bubbleCardCount: bubble?.querySelectorAll('.rp-html-card').length ?? -1,
    bubbleCodeCount: bubble?.querySelectorAll('pre code').length ?? -1,
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
