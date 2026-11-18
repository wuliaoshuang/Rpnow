/** 真机逐步导航验证 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(600);

const s1 = await page.evaluate(() => ({
  route: location.href.slice(-30),
  mainText: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 150),
}));
console.log('当前页:', JSON.stringify(s1));

// 设置 hub → 插件管理
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main button, main [role="button"]')];
  const t = rows.find((b) => (b.textContent || '').includes('插件'));
  console.log('click plugin row:', Boolean(t));
  if (t) t.click();
});
await page.waitForTimeout(1500);
const s2 = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400));
console.log('插件页:', s2);

// 返回主界面 → 进入聊天
await page.evaluate(() => history.back());
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const chat = btns.find((b) => (b.getAttribute('aria-label') || '').includes('聊天'));
  if (chat) chat.click();
});
await page.waitForTimeout(1800);

const dom = await page.evaluate(() => ({
  chatEl: Boolean(document.getElementById('chat')),
  mesCount: document.querySelectorAll('#chat > .mes').length,
  firstMesid: document.querySelector('#chat > .mes')?.getAttribute('mesid') ?? null,
  preCode: document.querySelectorAll('#chat .mes pre code').length,
}));
console.log('DOM 映射:', JSON.stringify(dom, null, 1));
await browser.close();
