import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const code = [...document.querySelectorAll('#chat .mes pre code')].find((c) => /<!DOCTYPE|<html/i.test(c.textContent || ''));
  const bubble = code?.closest('.mes');
  // 楼层原文（React 渲染前的内容在 DOM 里已是处理结果，但气泡 data 或 store 无从拿——
  // 用 code 前后文拼出真实围栏形态）
  const all = bubble?.textContent ?? '';
  const i = all.indexOf('<!DOCTYPE');
  // 向前找围栏开头（最多 400 字符）
  return {
    beforeDoc: all.slice(Math.max(0, i - 200), i),
    docHead: all.slice(i, i + 80),
    // 该层 code 元素内容开头（确认是完整文档还是片段）
    codeHead: (code?.textContent ?? '').slice(0, 60),
    codeTail: (code?.textContent ?? '').slice(-60),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
