/** 真机：读取插件内核记录（通过 UI 文本，release 无法 import 源码） */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(600);

// 进插件页
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main button')];
  const t = rows.find((b) => (b.textContent || '').includes('插件管理'));
  if (t) t.click();
});
await page.waitForTimeout(1500);
const txt = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' '));
const i = txt.indexOf('已安装');
console.log(txt.slice(i, i + 500));
await browser.close();
