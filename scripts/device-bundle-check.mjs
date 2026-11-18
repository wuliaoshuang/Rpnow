/** 确认真机 bundle 版本：注入探针查 rp-html-card 逻辑是否存在于当前渲染器 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(500);

// 检查全局资源：Tauri 内嵌资产的实际 URL
const r = await page.evaluate(async () => {
  const out = {};
  out.origin = location.origin;
  // 找当前 document 里的 script 标签 src
  out.scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 6);
  // 用 fetch 拉主 bundle（相对当前 origin）
  const src = out.scripts.find((s) => s.includes('index') || s.includes('assets')) ?? '';
  if (src) {
    try {
      const res = await fetch(src, { cache: 'no-store' });
      const t = await res.text();
      out.bundleSize = t.length;
      out.hasNewFence = t.includes('html|htm)?');
      out.hasCard = t.includes('rp-html-card');
      out.hasBareFenceComment = t.includes('bare fence');
    } catch (e) {
      out.fetchErr = String(e.message).slice(0, 100);
    }
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
