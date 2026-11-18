import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
await page.waitForTimeout(400);
const r = await page.evaluate(async () => {
  const out = {};
  // bundle 特征：line-scan 版本没有 "html|htm)?" 正则文本；改查新代码特征
  // line-scan 引入了 "fenceOpen" 与 "</html>" 行判断——查 "</html>" 与 fence 的邻近不可靠
  // 最可靠：直接对当前渲染器做行为测试——在页面里构造一条消息不可行（React 内部状态）
  // 改查 bundle 是否含 line-scan 特征字符串 "fenceOpen"
  const src = out.src ?? '';
  try {
    const res = await fetch('/assets/' + [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/assets/')[1]).find(Boolean), { cache: 'no-store' });
    const t = await res.text();
    out.bundleSize = t.length;
    out.hasFenceOpen = t.includes('fenceOpen');
    out.hasPairRegex = t.includes('html|htm)?');
  } catch (e) {
    out.err = String(e.message).slice(0, 100);
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
